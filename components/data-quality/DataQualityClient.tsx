"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NonConformingTransitLink } from "@/lib/transitLinks";
import type { DevicePositionConflict } from "@/lib/deviceCircuits";
import { mergeDeviceInto, ignoreDevicePair, type DeviceDupCandidate } from "@/lib/deviceDedup";
import { syncDevicePositionMapNames } from "@/lib/devicePositionMap";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { TrunkCircuitMissingDeviceMirror } from "@/lib/reverseDeviceTrunkAudit";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";
import TrunkMissingDeviceMirrorTab from "@/components/data-quality/TrunkMissingDeviceMirrorTab";

type Tab = "transit" | "devices" | "positions" | "trunkMissingDevice";

export default function DataQualityClient({
  transitItems,
  dupCandidates,
  positionConflicts,
  trunkMissingDeviceItems,
}: {
  transitItems: NonConformingTransitLink[];
  dupCandidates: DeviceDupCandidate[];
  positionConflicts: DevicePositionConflict[];
  trunkMissingDeviceItems: TrunkCircuitMissingDeviceMirror[];
}) {
  const [tab, setTab] = useState<Tab>(
    transitItems.length > 0
      ? "transit"
      : dupCandidates.length > 0
        ? "devices"
        : positionConflicts.length > 0
          ? "positions"
          : "trunkMissingDevice"
  );

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Tổng: {transitItems.length} chuyển tiếp chưa chuẩn · {dupCandidates.length} thiết bị nghi trùng ·{" "}
        {positionConflicts.length} vị trí xung đột · {trunkMissingDeviceItems.length} luồng trung kế thiếu bên thiết bị
      </p>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        <TabButton active={tab === "transit"} onClick={() => setTab("transit")} count={transitItems.length}>
          Chuyển tiếp chưa chuẩn
        </TabButton>
        <TabButton active={tab === "devices"} onClick={() => setTab("devices")} count={dupCandidates.length}>
          Thiết bị trùng gần đúng
        </TabButton>
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")} count={positionConflicts.length}>
          Xung đột vị trí
        </TabButton>
        <TabButton active={tab === "trunkMissingDevice"} onClick={() => setTab("trunkMissingDevice")} count={trunkMissingDeviceItems.length}>
          Trung kế thiếu bên thiết bị
        </TabButton>
      </div>

      {tab === "transit" &&
        (transitItems.length === 0 ? (
          <EmptyState text="Không có dòng &quot;Chuyển tiếp&quot; nào chưa chuẩn form." />
        ) : (
          <TransitFormatWarning items={transitItems} />
        ))}
      {tab === "devices" && <DeviceDupTab candidates={dupCandidates} />}
      {tab === "positions" && <PositionConflictsTab conflicts={positionConflicts} />}
      {tab === "trunkMissingDevice" && <TrunkMissingDeviceMirrorTab items={trunkMissingDeviceItems} />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "-mb-px border-b-2 px-3 py-2 text-sm font-medium " +
        (active ? "border-primary-600 text-primary-700" : "border-transparent text-slate-500 hover:text-slate-700")
      }
    >
      {children} ({count})
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}

// ============================================================================
// Tab "Thiết bị trùng gần đúng" (mới, yêu cầu người dùng 2026-07-29)
// ============================================================================
function DeviceDupTab({ candidates }: { candidates: DeviceDupCandidate[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => c.deviceA.name.toLowerCase().includes(q) || c.deviceB.name.toLowerCase().includes(q));
  }, [candidates, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  function keyOf(c: DeviceDupCandidate) {
    return `${c.deviceA.id}|${c.deviceB.id}`;
  }

  // "Gộp vào X" — xóa thiết bị Y (nguồn), chuyển toàn bộ luồng của Y sang X
  // (đích, GIỮ NGUYÊN tên X, khác DeviceCategoryClient.tsx vốn cho đổi tên
  // đích — ở đây đích đã xác định rõ ràng, không cần đổi tên). Rủi ro thật
  // (xóa hẳn 1 thiết bị + chuyển luồng) nên bắt buộc confirm() nêu rõ hậu quả,
  // đúng tinh thần DeleteRackButton.tsx/applyBulkRename đã làm.
  async function merge(candidate: DeviceDupCandidate, keep: "a" | "b") {
    const target = keep === "a" ? candidate.deviceA : candidate.deviceB;
    const source = keep === "a" ? candidate.deviceB : candidate.deviceA;
    const ok = confirm(
      `Gộp "${source.name}" (${source.circuitCount} luồng) vào "${target.name}"?\n\n` +
        `Thiết bị "${source.name}" sẽ bị XÓA HẲN, toàn bộ luồng của nó chuyển sang "${target.name}". Không thể hoàn tác.`
    );
    if (!ok) return;
    setBusyKey(keyOf(candidate));
    setError(null);
    try {
      await mergeDeviceInto(source.id, target.id);
      try {
        await syncDevicePositionMapNames([source.name], target.name);
      } catch (syncErr) {
        setError(
          `Đã gộp xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          }`
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function ignore(candidate: DeviceDupCandidate) {
    setBusyKey(keyOf(candidate));
    setError(null);
    try {
      await ignoreDevicePair(candidate.deviceA.id, candidate.deviceB.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  if (candidates.length === 0) {
    return <EmptyState text="Không phát hiện cặp thiết bị nào nghi trùng tên." />;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-800">Phát hiện {candidates.length} cặp thiết bị tên gần giống nhau</h2>
      <p className="mt-1 text-xs text-amber-700">
        So khớp gần đúng trên tên đã chuẩn hóa (khoảng cách chỉnh sửa ≤ 2 ký tự) — KHÔNG tự gộp, vì tên gần giống có thể
        vẫn là 2 thiết bị thật khác nhau. Bấm &quot;Gộp vào...&quot; nếu đúng là 1 thiết bị bị ghi 2 kiểu, hoặc
        &quot;Bỏ qua&quot; nếu là 2 thiết bị khác nhau thật — bỏ qua rồi sẽ không hiện lại cặp này nữa.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">Lỗi: {error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-amber-300"
          placeholder="Lọc theo tên thiết bị..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span className="text-xs text-amber-600">
          {filtered.length}/{candidates.length} cặp
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-amber-700">
          Số dòng/trang:
          <select
            className="input w-auto py-1"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {[5, 10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mt-2 space-y-2 text-sm text-amber-800">
        {paged.map((c) => {
          const busy = busyKey === keyOf(c);
          return (
            <li key={keyOf(c)} className="rounded-md border border-amber-200 bg-white p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{c.deviceA.name}</span> ({c.deviceA.circuitCount} luồng) &nbsp;↔&nbsp;{" "}
                  <span className="font-medium">{c.deviceB.name}</span> ({c.deviceB.circuitCount} luồng)
                  <span className="ml-2 text-xs text-amber-500">khoảng cách {c.editDistance}</span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => merge(c, "a")} disabled={busy}>
                    {busy ? "Đang xử lý..." : `Gộp vào "${c.deviceA.name}"`}
                  </button>
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => merge(c, "b")} disabled={busy}>
                    {busy ? "Đang xử lý..." : `Gộp vào "${c.deviceB.name}"`}
                  </button>
                  <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => ignore(c)} disabled={busy}>
                    Bỏ qua
                  </button>
                </span>
              </div>
              {(c.deviceA.circuits.length > 0 || c.deviceB.circuits.length > 0) && (
                <div className="mt-1 flex flex-col gap-0.5 text-xs text-amber-600">
                  <CircuitLinkList label={c.deviceA.name} circuits={c.deviceA.circuits} />
                  <CircuitLinkList label={c.deviceB.name} circuits={c.deviceB.circuits} />
                </div>
              )}
            </li>
          );
        })}
        {paged.length === 0 && <li className="text-amber-400">Không có cặp nào khớp bộ lọc.</li>}
      </ul>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={pageClamped === 0}
          >
            ← Trước
          </button>
          <span>
            Trang {pageClamped + 1}/{pageCount}
          </span>
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageClamped >= pageCount - 1}
          >
            Sau →
          </button>
        </div>
      )}
    </div>
  );
}

// Liệt kê link nhảy thẳng tới từng luồng (domain=device, KHÔNG gán port nào
// nên không thể nằm ở bất kỳ Rack ODF trung kế nào — chỉ có thể tìm thấy ở
// "Hồ sơ đấu nối" /odf-device/sua-luong) đang gắn 1 thiết bị trong cặp nghi
// trùng — thêm 2026-07-30 sau khi người dùng gặp khó không biết "2 luồng"
// nằm ở đâu để kiểm tra trước khi quyết định gộp.
function CircuitLinkList({ label, circuits }: { label: string; circuits: { id: string; name: string }[] }) {
  if (circuits.length === 0) return null;
  return (
    <span>
      {label}:{" "}
      {circuits.map((c, i) => (
        <span key={c.id}>
          {i > 0 && "; "}
          <a href={`/odf-device/sua-luong#${rowAnchor(c.id)}`} className="underline hover:text-amber-900">
            {c.name || "(chưa đặt tên)"}
          </a>
        </span>
      ))}
    </span>
  );
}

// ============================================================================
// Tab "Xung đột vị trí" — dữ liệu từ findDevicePositionConflicts() (đã tách
// khỏi DeviceCircuitList.tsx, xem lib/deviceCircuits.ts), hiển thị đơn giản
// hơn bản gốc (bỏ phần bôi đỏ dòng trong bảng — chỉ có ý nghĩa tại chính bảng
// DeviceCircuitList, không áp dụng ở đây).
// ============================================================================
function PositionConflictsTab({ conflicts }: { conflicts: DevicePositionConflict[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conflicts;
    return conflicts.filter(
      (c) =>
        c.positionText.toLowerCase().includes(q) ||
        c.entries.some((e) => e.deviceName.toLowerCase().includes(q) || e.circuitName.toLowerCase().includes(q))
    );
  }, [conflicts, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  if (conflicts.length === 0) {
    return <EmptyState text="Không có vị trí ODF/DDF thiết bị nào bị gán cho nhiều hơn 1 thiết bị." />;
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <h2 className="font-semibold text-red-800">Phát hiện {conflicts.length} vị trí DDF/ODF bị gán cho nhiều hơn 1 thiết bị</h2>
      <p className="mt-1 text-xs text-red-700">
        Bấm vào tên luồng để nhảy tới đúng dòng ở &quot;Hồ sơ đấu nối&quot; rồi tự sửa tay — không tự đoán đâu là đúng.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-red-300"
          placeholder="Lọc theo vị trí / thiết bị / tên luồng..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span className="text-xs text-red-600">
          {filtered.length}/{conflicts.length} vị trí
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-red-700">
          Số dòng/trang:
          <select
            className="input w-auto py-1"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
          >
            {[5, 10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mt-2 space-y-2 text-sm text-red-700">
        {paged.map((conflict) => (
          <li key={conflict.positionText}>
            <span className="font-medium">Vị trí &quot;{conflict.positionText}&quot;:</span>{" "}
            {conflict.entries.map((e, i) => (
              <span key={i}>
                {i > 0 && "; "}
                {e.deviceName} (
                <a href={`/odf-device/sua-luong#${rowAnchor(e.circuitId)}`} className="underline hover:text-red-900">
                  {e.circuitName}
                </a>
                )
              </span>
            ))}
          </li>
        ))}
        {paged.length === 0 && <li className="text-red-400">Không có vị trí nào khớp bộ lọc.</li>}
      </ul>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-red-700">
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={pageClamped === 0}
          >
            ← Trước
          </button>
          <span>
            Trang {pageClamped + 1}/{pageCount}
          </span>
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageClamped >= pageCount - 1}
          >
            Sau →
          </button>
        </div>
      )}
    </div>
  );
}
