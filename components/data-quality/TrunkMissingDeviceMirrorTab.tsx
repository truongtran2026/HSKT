"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TrunkCircuitMissingDeviceMirror } from "@/lib/reverseDeviceTrunkAudit";
import { findMirrorTrunkCircuits, deleteTrunkCircuitToResync } from "@/lib/mirrorTrunkCircuits";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Khung rà soát CHIỀU NGƯỢC của mục 38/39 (yêu cầu người dùng 2026-07-31,
// xem lib/reverseDeviceTrunkAudit.ts để hiểu đầy đủ lý do) — luồng trung kế
// ĐÃ CÓ đúng, nhưng "Hồ sơ đấu nối" thiết bị lại chưa có dòng nào tương ứng.
//
// KHÔNG tự tạo/match thiết bị nào (khác 3 cơ chế auto-mirror mục 38/39/40) —
// người dùng chỉ ra rủi ro thật: tên thiết bị ghi trong luồng trung kế có thể
// sai FORMAT (vd "ADN1.MPE8" thay vì đúng "ADN1.MPE#8"), tự match/tạo sẽ lặp
// lại bug tạo trùng thiết bị (mục 35, PSS64/BB330G). Vì vậy CHỈ có 2 lựa
// chọn, người dùng tự quyết định qua tick xác nhận từng dòng:
//   - KHÔNG tick (mặc định, "Phương án 2"): không đụng gì cả — người dùng tự
//     qua "Hồ sơ đấu nối" bổ sung đúng luồng (đúng thiết bị chuẩn từ danh
//     mục), giữ nguyên luồng trung kế hiện có.
//   - CÓ tick rồi bấm "Xóa" ("Phương án 1"): xóa hẳn luồng trung kế cũ để
//     GIẢI PHÓNG port — khi người dùng bổ sung đúng bên Hồ sơ đấu nối,
//     autoCreateTrunkMirrorForCircuit() (mục 39) tự tạo lại mirror trung kế
//     chuẩn, không cần thao tác gì thêm ở đây.
export default function TrunkMissingDeviceMirrorTab({ items }: { items: TrunkCircuitMissingDeviceMirror[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        it.trunkCircuitName.toLowerCase().includes(q) ||
        it.rackCode.toLowerCase().includes(q) ||
        it.parsedDeviceText.toLowerCase().includes(q)
    );
  }, [items, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  function toggleConfirm(id: string, checked: boolean) {
    setConfirmedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleDelete(item: TrunkCircuitMissingDeviceMirror) {
    setError(null);
    setBusyId(item.trunkCircuitId);
    try {
      const mirrorMap = await findMirrorTrunkCircuits(supabase, [item.trunkCircuitId]);
      const cascaded = [...mirrorMap.values()];
      const cascadeNote =
        cascaded.length > 0 ? ` Lưu ý: ${cascaded.length} luồng mirror khác (${cascaded.map((m) => m.circuitName).join(", ")}) sẽ mất theo.` : "";
      if (
        !confirm(
          `Xóa luồng "${item.trunkCircuitName}" (${item.rackCode} port ${item.portNumbers.join(",")})? Port sẽ về trạng thái trống.${cascadeNote}`
        )
      ) {
        setBusyId(null);
        return;
      }
      await deleteTrunkCircuitToResync(supabase, item.trunkCircuitId, cascaded);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <EmptyState text="Không có luồng trung kế nào bị thiếu bên Hồ sơ đấu nối thiết bị." />;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-800">
        Phát hiện {items.length} luồng trung kế có thể thiếu bên &quot;Hồ sơ đấu nối&quot; thiết bị
      </h2>
      <p className="mt-1 text-xs text-amber-700">
        Luồng trung kế dưới đây có tên nhắc tới 1 thiết bị ADN1 nhưng chưa có luồng cùng tên bên Hồ sơ đấu nối — có thể do bỏ
        sót, hoặc do tên thiết bị ghi khác format (vd &quot;ADN1.MPE8&quot; thay vì đúng chuẩn &quot;ADN1.MPE#8&quot;).{" "}
        <strong>Không tự đoán/tạo thiết bị</strong> — bạn tự đối chiếu rồi chọn 1 trong 2:
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">
        <li>Không tick: tự qua Hồ sơ đấu nối bổ sung đúng luồng, giữ nguyên luồng trung kế này.</li>
        <li>Tick xác nhận rồi bấm &quot;Xóa&quot;: xóa luồng trung kế cũ để giải phóng port — khi bổ sung đúng bên Hồ sơ đấu nối, hệ thống tự tạo lại mirror chuẩn.</li>
      </ul>
      {error && <p className="mt-1 text-xs text-red-600">Lỗi: {error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-amber-300"
          placeholder="Lọc theo tên luồng / rack / thiết bị..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span className="text-xs text-amber-600">
          {filtered.length}/{items.length} luồng
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
        {paged.map((item) => (
          <li key={item.trunkCircuitId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-2 py-1.5">
            <a
              href={`/odf-trunk/${item.rackId}#port-${item.firstPortId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 break-words hover:underline"
              title="Xem port này ở Hồ sơ ODF Trung kế (mở tab mới)"
            >
              <span className="font-medium">
                {item.rackCode} port {item.portNumbers.join(",")}:
              </span>{" "}
              &quot;{item.trunkCircuitName}&quot;
              {item.parsedDeviceText && <span className="text-amber-500"> — thiết bị ghi: {item.parsedDeviceText}</span>}
            </a>
            <span className="flex shrink-0 items-center gap-2">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={confirmedIds.has(item.trunkCircuitId)}
                  onChange={(e) => toggleConfirm(item.trunkCircuitId, e.target.checked)}
                />
                Xác nhận xóa
              </label>
              <button
                type="button"
                className="btn-secondary shrink-0 px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => handleDelete(item)}
                disabled={!confirmedIds.has(item.trunkCircuitId) || busyId === item.trunkCircuitId}
                title="Chỉ bấm được khi đã tick xác nhận — xóa để giải phóng port, tạo lại đúng chuẩn khi bổ sung Hồ sơ đấu nối"
              >
                {busyId === item.trunkCircuitId ? "Đang xóa..." : "Xóa"}
              </button>
            </span>
          </li>
        ))}
        {paged.length === 0 && <li className="text-amber-400">Không có dòng nào khớp bộ lọc.</li>}
      </ul>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
          <button className="btn-secondary px-2 py-1" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pageClamped === 0}>
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

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
