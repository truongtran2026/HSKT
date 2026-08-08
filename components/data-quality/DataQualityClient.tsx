"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { NonConformingTransitLink } from "@/lib/transitLinks";
import type { DevicePositionConflict, DeviceOwnPositionDuplicate } from "@/lib/deviceCircuits";
import { mergeDeviceInto, ignoreDevicePair, type DeviceDupCandidate } from "@/lib/deviceDedup";
import { syncDevicePositionMapNames, type LibraryOwnPositionDuplicate } from "@/lib/devicePositionMap";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { TrunkCircuitMissingDeviceMirror } from "@/lib/reverseDeviceTrunkAudit";
import type { UnlinkedDeviceDevicePair } from "@/lib/unlinkedMirrorPairs";
import type { TransitPositionMismatch } from "@/lib/transitPositionMismatches";
import type { DeviceCircuitLibraryMismatch } from "@/lib/devicePositionMismatches";
import type { CircuitPairDetail } from "@/lib/circuitPairSync";
import type { DivergentTransitGroup } from "@/lib/transitLinks";
import {
  syncAllTrunkMirrorGaps,
  syncAllTrunkTrunkMirrorGaps,
  type MirrorGapScanSummary,
  type MirrorScanScope,
} from "@/lib/mirrorTrunkCircuits";
import { syncAllDeviceMirrorGaps } from "@/lib/deviceDeviceSync";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";
import { useCollapsed } from "@/lib/useCollapsed";
import RoleGate from "@/components/ui/RoleGate";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";
import TrunkMissingDeviceMirrorTab from "@/components/data-quality/TrunkMissingDeviceMirrorTab";
import UnlinkedMirrorPairsTab from "@/components/data-quality/UnlinkedMirrorPairsTab";
import UnlinkedDeviceMirrorPairsTab from "@/components/data-quality/UnlinkedDeviceMirrorPairsTab";
import TransitPositionMismatchTab from "@/components/data-quality/TransitPositionMismatchTab";
import DeviceLibraryMismatchTab from "@/components/data-quality/DeviceLibraryMismatchTab";
import MismatchedLinkedPairsTab from "@/components/data-quality/MismatchedLinkedPairsTab";
import DivergentTransitTab from "@/components/data-quality/DivergentTransitTab";

// Gộp 8 tab cũ xuống còn 3 khung (mục 60, người dùng 2026-08-03: "xem việc
// điều chỉnh ở các khung khác có vấn đề gì với nội dung gộp các khung...
// còn lại 2-3 khung thôi", chốt tách riêng "Xung đột vị trí" thành khung 3
// thay vì gộp chung). CHỈ gộp lớp HIỂN THỊ/ĐIỀU HƯỚNG (bar tab + phần chọn
// tab) — 8 component con bên dưới GIỮ NGUYÊN logic/nút bấm/phân trang đã
// test kỹ, không viết lại, tránh rủi ro hỏng chỗ đang chạy đúng chỉ để gộp
// giao diện. "sync" gộp 4 tab vốn CÙNG BẢN CHẤT "thiếu liên kết/lệch dữ liệu
// 2 bên" (khác nhau ở việc tính bằng hàm cũ riêng lẻ có trước so với
// syncAllTrunkMirrorGaps.../mục 56-58) — đặt NGAY DƯỚI ScanFillGapsPanel vì
// cùng 1 chủ đề. "format" gộp 3 tab về định dạng/trùng tên, bản chất khác
// hẳn "sync" (không liên quan liên kết 2 bên). "positions" (xung đột vị trí
// — nhiều luồng tranh 1 vị trí) giữ riêng vì bản chất khác cả 2 khung kia.
type Tab = "sync" | "format" | "positions";

export default function DataQualityClient({
  transitItems,
  dupCandidates,
  positionConflicts,
  ownPositionDuplicates,
  libraryOwnPositionDuplicates,
  trunkMissingDeviceItems,
  unlinkedDeviceDevicePairs,
  transitPositionMismatches,
  deviceCircuitLibraryMismatches,
  unlinkedPairDetails,
  mismatchedLinkedPairs,
  divergentTransitGroups,
  trunkRackCodes,
  deviceRackCodes,
  deviceNames,
}: {
  transitItems: NonConformingTransitLink[];
  dupCandidates: DeviceDupCandidate[];
  positionConflicts: DevicePositionConflict[];
  ownPositionDuplicates: DeviceOwnPositionDuplicate[];
  libraryOwnPositionDuplicates: LibraryOwnPositionDuplicate[];
  trunkMissingDeviceItems: TrunkCircuitMissingDeviceMirror[];
  unlinkedDeviceDevicePairs: UnlinkedDeviceDevicePair[];
  transitPositionMismatches: TransitPositionMismatch[];
  deviceCircuitLibraryMismatches: DeviceCircuitLibraryMismatch[];
  unlinkedPairDetails: CircuitPairDetail[];
  mismatchedLinkedPairs: CircuitPairDetail[];
  divergentTransitGroups: DivergentTransitGroup[];
  trunkRackCodes: string[];
  deviceRackCodes: string[];
  deviceNames: string[];
}) {
  const syncCount = trunkMissingDeviceItems.length + unlinkedPairDetails.length + mismatchedLinkedPairs.length + unlinkedDeviceDevicePairs.length;
  const formatCount =
    transitItems.length + transitPositionMismatches.length + deviceCircuitLibraryMismatches.length + dupCandidates.length + divergentTransitGroups.length;
  const positionsCount = positionConflicts.length + ownPositionDuplicates.length + libraryOwnPositionDuplicates.length;

  const [tab, setTab] = useState<Tab>(syncCount > 0 ? "sync" : formatCount > 0 ? "format" : "positions");

  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">
        Tổng: {transitItems.length} chuyển tiếp chưa chuẩn · {dupCandidates.length} thiết bị nghi trùng ·{" "}
        {positionConflicts.length} vị trí xung đột · {ownPositionDuplicates.length + libraryOwnPositionDuplicates.length} thiết
        bị trùng vị trí giữa 2 Trib · {trunkMissingDeviceItems.length} luồng trung kế thiếu bên thiết bị ·{" "}
        {unlinkedPairDetails.length} cặp luồng thiết bị-trung kế chưa liên kết ·{" "}
        {mismatchedLinkedPairs.length} cặp đã liên kết nhưng lệch dữ liệu ·{" "}
        {unlinkedDeviceDevicePairs.length} cặp luồng thiết bị-thiết bị chưa liên kết ·{" "}
        {transitPositionMismatches.length} chuyển tiếp sai tọa độ ODF ·{" "}
        {deviceCircuitLibraryMismatches.length} luồng thiết bị sai tọa độ ODF so với thư viện ·{" "}
        {divergentTransitGroups.length} luồng có 2 sợi ghi Chuyển tiếp khác nhau
      </p>

      <ScanFillGapsPanel trunkRackCodes={trunkRackCodes} deviceRackCodes={deviceRackCodes} deviceNames={deviceNames} />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        <TabButton active={tab === "sync"} onClick={() => setTab("sync")} count={syncCount}>
          Liên kết &amp; đồng bộ 2 chiều
        </TabButton>
        <TabButton active={tab === "format"} onClick={() => setTab("format")} count={formatCount}>
          Định dạng &amp; trùng lặp dữ liệu
        </TabButton>
        <TabButton active={tab === "positions"} onClick={() => setTab("positions")} count={positionsCount}>
          Xung đột vị trí
        </TabButton>
      </div>

      {tab === "sync" &&
        (syncCount === 0 ? (
          <EmptyState text="Không phát hiện chỗ thiếu liên kết hoặc lệch dữ liệu 2 chiều nào." />
        ) : (
          <div className="space-y-4">
            <TrunkMissingDeviceMirrorTab items={trunkMissingDeviceItems} />
            <UnlinkedMirrorPairsTab items={unlinkedPairDetails} />
            <MismatchedLinkedPairsTab items={mismatchedLinkedPairs} />
            <UnlinkedDeviceMirrorPairsTab items={unlinkedDeviceDevicePairs} />
          </div>
        ))}
      {tab === "format" &&
        (formatCount === 0 ? (
          <EmptyState text="Không phát hiện vấn đề định dạng hoặc thiết bị trùng lặp nào." />
        ) : (
          <div className="space-y-4">
            {transitItems.length === 0 ? (
              <EmptyState text="Không có dòng &quot;Chuyển tiếp&quot; nào chưa chuẩn form." />
            ) : (
              <TransitFormatWarning items={transitItems} openInNewTab />
            )}
            <TransitPositionMismatchTab items={transitPositionMismatches} />
            <DeviceLibraryMismatchTab items={deviceCircuitLibraryMismatches} />
            <DivergentTransitTab groups={divergentTransitGroups} />
            <DeviceDupTab candidates={dupCandidates} />
          </div>
        ))}
      {tab === "positions" && (
        <div className="space-y-4">
          <PositionConflictsTab conflicts={positionConflicts} />
          <OwnPositionDuplicatesTab circuitDuplicates={ownPositionDuplicates} libraryDuplicates={libraryOwnPositionDuplicates} />
        </div>
      )}
    </div>
  );
}

// "Nếu bên hồ sơ còn lại đang trống thì sync luôn chứ sao phải đợi sửa lại
// bên hồ sơ đúng 1 chút gì đó (ví dụ ghi thêm ghi chú) rồi mới kích hoạt chế
// độ sync qua bên hồ sơ kia" (yêu cầu người dùng 2026-08-02, sau khi tự thử
// xóa 1 bên trung kế và thấy tồn đọng CŨ không có gì tự kích hoạt) —
// autoCreateXForCircuit (mục 38-40/54) CHỈ chạy khi LƯU đúng 1 luồng cụ thể,
// dữ liệu cũ có sẵn từ trước (chưa ai sửa/lưu lại) không có gì tự kích hoạt.
// Nút này quét TOÀN BỘ 3 loại cặp 1 lượt (tái dùng đúng
// syncAllTrunkMirrorGaps/syncAllTrunkTrunkMirrorGaps/syncAllDeviceMirrorGaps,
// cùng thuật toán CLI script sync-missing-*.ts, không viết lại) — CHỈ tạo
// mới/liên kết chỗ TRỐNG (an toàn, không đụng dữ liệu có sẵn); chỗ đã có dữ
// liệu KHÁC (xung đột thật) chỉ liệt kê ra để tự vào từng luồng xử lý qua
// "Gỡ liên kết"/"Kiểm tra đồng bộ", KHÔNG tự xóa hàng loạt (quá rủi ro khi
// chạy không giám sát từng dòng).
// localStorage key lưu lại lần quét cuối (yêu cầu người dùng 2026-08-03: "quét
// nhân công, lưu lại lần quét cuối cùng mình quét" — trước đây kết quả chỉ là
// state trong RAM, tải lại trang là mất sạch, phải quét lại từ đầu kể cả khi
// không đổi phạm vi gì). Chỉ là tiện ích hiển thị trên máy/trình duyệt đang
// dùng, KHÔNG phải nguồn dữ liệu thật (nguồn thật vẫn luôn là Supabase).
const SCAN_STORAGE_KEY = "hskt:dataQuality:scanFillGaps:last";

interface PersistedScan {
  scope: MirrorScanScope;
  result: MirrorGapScanSummary;
  scannedAt: string;
}

function ScanFillGapsPanel({
  trunkRackCodes,
  deviceRackCodes,
  deviceNames,
}: {
  trunkRackCodes: string[];
  deviceRackCodes: string[];
  deviceNames: string[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MirrorGapScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Phạm vi quét (yêu cầu người dùng 2026-08-02: "quét toàn bộ thì sẽ bị
  // chồng lấp đang đúng tự nhiên ở đâu nhập thêm vào thành sai" — thu hẹp lại
  // để giảm rủi ro/blast radius, thay vì luôn quét cả trạm). "" = không giới
  // hạn theo chiều đó; để trống CẢ 3 ô = quét toàn trạm như trước.
  const [trunkRackCode, setTrunkRackCode] = useState("");
  const [deviceRackCode, setDeviceRackCode] = useState("");
  const [deviceName, setDeviceName] = useState("");
  // Phạm vi CỦA LẦN QUÉT GẦN NHẤT — cố ý tách riêng khỏi 3 ô chọn ở trên, vì
  // nút "Làm mới" phải lặp lại đúng lựa chọn lần trước, KHÔNG bị ảnh hưởng
  // nếu người dùng đang gõ dở/đổi ô chọn nhưng chưa bấm "Quét & lấp đầy" (yêu
  // cầu người dùng: "việc refresh là lựa chọn của lần trước đó, làm tươi mới
  // mà" — đổi phạm vi thật sự thì phải chủ động bấm "Quét & lấp đầy" lại).
  const [lastScope, setLastScope] = useState<MirrorScanScope | null>(null);
  const [scannedAt, setScannedAt] = useState<string | null>(null);

  // Khôi phục lần quét gần nhất khi mở lại trang (kể cả sau F5) — đúng yêu
  // cầu người dùng, để không phải quét lại từ đầu chỉ vì tải lại trang.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCAN_STORAGE_KEY);
      if (!raw) return;
      const parsed: PersistedScan = JSON.parse(raw);
      setLastScope(parsed.scope);
      setResult(parsed.result);
      setScannedAt(parsed.scannedAt);
      setTrunkRackCode(parsed.scope.trunkRackCode ?? "");
      setDeviceRackCode(parsed.scope.deviceRackCode ?? "");
      setDeviceName(parsed.scope.deviceName ?? "");
    } catch {
      // localStorage hỏng/bị chặn (vd chế độ ẩn danh) — coi như chưa quét lần nào, không chặn trang chạy tiếp.
    }
  }, []);

  async function runScanWithScope(scope: MirrorScanScope) {
    setBusy(true);
    setError(null);
    try {
      const [trunk, trunkTrunk, device] = await Promise.all([
        syncAllTrunkMirrorGaps(supabase, scope),
        syncAllTrunkTrunkMirrorGaps(supabase, scope),
        syncAllDeviceMirrorGaps(supabase, scope),
      ]);
      const merged: MirrorGapScanSummary = {
        created: trunk.created + trunkTrunk.created + device.created,
        linked: trunk.linked + trunkTrunk.linked + device.linked,
        conflicts: [...trunk.conflicts, ...trunkTrunk.conflicts, ...device.conflicts],
        errors: [...trunk.errors, ...trunkTrunk.errors, ...device.errors],
      };
      const now = new Date().toISOString();
      setResult(merged);
      setLastScope(scope);
      setScannedAt(now);
      try {
        localStorage.setItem(SCAN_STORAGE_KEY, JSON.stringify({ scope, result: merged, scannedAt: now } satisfies PersistedScan));
      } catch {
        // localStorage đầy/bị chặn — không sao, chỉ mất tiện ích nhớ lần quét trước, không ảnh hưởng dữ liệu thật.
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  function runScan() {
    return runScanWithScope({
      trunkRackCode: trunkRackCode || undefined,
      deviceRackCode: deviceRackCode || undefined,
      deviceName: deviceName || undefined,
    });
  }

  // "Làm mới" = quét lại ĐÚNG phạm vi lần quét gần nhất, bất kể 3 ô chọn ở
  // trên đang hiển thị gì — cho phép cập nhật lại trạng thái (vd sau khi vừa
  // sửa xong 1 luồng ở tab khác) chỉ bằng 1 cú bấm, không phải chọn lại rack/
  // thiết bị từ đầu.
  function refreshScan() {
    return runScanWithScope(lastScope ?? {});
  }

  const hasScope = !!(trunkRackCode || deviceRackCode || deviceName);

  return (
    <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={runScan} disabled={busy}>
          {busy ? "Đang quét..." : hasScope ? "🔎 Quét & lấp đầy (theo phạm vi đã chọn)" : "🔎 Quét & lấp đầy TOÀN TRẠM"}
        </button>
        {lastScope && (
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={refreshScan} disabled={busy}>
            {busy ? "Đang làm mới..." : "🔄 Làm mới (theo phạm vi lần quét trước)"}
          </button>
        )}
        <p className="text-xs text-primary-700">
          Tự tạo/liên kết mọi cặp mà 1 bên đang TRỐNG — an toàn, không đụng dữ liệu đã có. Chỗ xung đột thật (đã có dữ
          liệu KHÁC) chỉ liệt kê, không tự xóa. Để trống cả 3 ô dưới = quét toàn trạm; chọn 1-2 ô để thu hẹp phạm vi,
          tránh động chạm chỗ khác đang đúng.
        </p>
      </div>
      {scannedAt && (
        <p className="mt-1 text-xs text-primary-500">
          Lần quét gần nhất: {new Date(scannedAt).toLocaleString("vi-VN")}
          {lastScope && (lastScope.trunkRackCode || lastScope.deviceRackCode || lastScope.deviceName) ? (
            <>
              {" "}
              — phạm vi: {[lastScope.trunkRackCode, lastScope.deviceRackCode, lastScope.deviceName].filter(Boolean).join(", ")}
            </>
          ) : (
            " — toàn trạm"
          )}
          . Sửa dữ liệu ở nơi khác xong thì bấm &quot;Làm mới&quot; để cập nhật lại danh sách dưới đây (kết quả này không tự
          cập nhật khi tải lại trang).
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-primary-700">
          Rack ODF trung kế:
          <select className="input w-auto py-1" value={trunkRackCode} onChange={(e) => setTrunkRackCode(e.target.value)}>
            <option value="">(mọi rack)</option>
            {trunkRackCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-primary-700">
          Rack ODF thiết bị:
          <select className="input w-auto py-1" value={deviceRackCode} onChange={(e) => setDeviceRackCode(e.target.value)}>
            <option value="">(mọi rack)</option>
            {deviceRackCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-primary-700">
          Thiết bị:
          <select className="input w-auto py-1" value={deviceName} onChange={(e) => setDeviceName(e.target.value)}>
            <option value="">(mọi thiết bị)</option>
            {deviceNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">Lỗi: {error}</p>}
      {result && (
        <div className="mt-2 text-xs text-primary-800">
          <p>
            Đã tự tạo <strong>{result.created}</strong> luồng mirror, tự liên kết <strong>{result.linked}</strong> cặp
            khớp sẵn nhưng chưa gắn liên kết.
          </p>
          {result.conflicts.length > 0 && (
            <div className="mt-1">
              <p className="font-medium text-amber-700">{result.conflicts.length} xung đột cần tự vào xử lý:</p>
              <ul className="ml-4 list-disc">
                {result.conflicts.map((c, i) => (
                  <li key={i}>
                    <span className="font-medium">
                      {c.sourceHref ? (
                        <a href={c.sourceHref} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-900">
                          {c.sourceName}
                        </a>
                      ) : (
                        c.sourceName
                      )}
                    </span>
                    : {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="mt-1">
              <p className="font-medium text-red-700">{result.errors.length} lỗi:</p>
              <ul className="ml-4 list-disc">
                {result.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
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
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:deviceDup");

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
      await mergeDeviceInto(supabase, source.id, target.id);
      try {
        await syncDevicePositionMapNames(supabase, [source.name], target.name);
      } catch (syncErr) {
        setError(
          `Đã gộp xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? translatePgError(syncErr.message) : String(syncErr)
          }`
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  async function ignore(candidate: DeviceDupCandidate) {
    setBusyKey(keyOf(candidate));
    setError(null);
    try {
      await ignoreDevicePair(supabase, candidate.deviceA.id, candidate.deviceB.id);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  if (candidates.length === 0) {
    return <EmptyState text="Không phát hiện cặp thiết bị nào nghi trùng tên." />;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-amber-800">Phát hiện {candidates.length} cặp thiết bị tên gần giống nhau</h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-amber-300 px-2 py-0.5 text-sm font-bold text-amber-700 hover:bg-amber-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
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
                      {/* Gộp luôn xóa hẳn 1 thiết bị (mergeDeviceInto) — admin_delete
                          trong RLS chỉ cho admin, khác "Bỏ qua" (chỉ ghi nhận, không
                          xóa gì) — operator được phép. */}
                      <RoleGate allow={["admin"]}>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => merge(c, "a")} disabled={busy}>
                          {busy ? "Đang xử lý..." : `Gộp vào "${c.deviceA.name}"`}
                        </button>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => merge(c, "b")} disabled={busy}>
                          {busy ? "Đang xử lý..." : `Gộp vào "${c.deviceB.name}"`}
                        </button>
                      </RoleGate>
                      <RoleGate allow={["operator", "admin"]}>
                        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => ignore(c)} disabled={busy}>
                          Bỏ qua
                        </button>
                      </RoleGate>
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
        </>
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
          <a
            href={`/odf-device/sua-luong#${rowAnchor(c.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-900"
          >
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
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:positionConflicts");

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
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-red-800">Phát hiện {conflicts.length} vị trí DDF/ODF bị gán cho nhiều hơn 1 thiết bị</h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-sm font-bold text-red-700 hover:bg-red-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
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
                    <a
                      href={`/odf-device/sua-luong#${rowAnchor(e.circuitId)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-red-900"
                    >
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
        </>
      )}
    </div>
  );
}

// ============================================================================
// Tab "1 thiết bị có ≥2 Trib khác nhau cùng ra 1 vị trí ODF/DDF" — đối xứng
// NGƯỢC PositionConflictsTab ở trên (đó là 1 vị trí bị NHIỀU THIẾT BỊ dùng
// chung; đây là NHIỀU TRIB của CÙNG 1 thiết bị dùng chung 1 vị trí). Yêu cầu
// người dùng 2026-08-03. Gộp 2 nguồn dữ liệu: circuitDuplicates (từ chính Hồ
// sơ đấu nối, có link nhảy tới đúng dòng) và libraryDuplicates (dữ liệu CŨ
// trong thư viện Vị trí thiết bị — không có FK thật, không có gì để link tới
// đúng dòng, chỉ liệt kê để tự vào /odf-device/vi-tri-thiet-bi sửa tay).
// ============================================================================
function OwnPositionDuplicatesTab({
  circuitDuplicates,
  libraryDuplicates,
}: {
  circuitDuplicates: DeviceOwnPositionDuplicate[];
  libraryDuplicates: LibraryOwnPositionDuplicate[];
}) {
  const [search, setSearch] = useState("");
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:ownPositionDuplicates");

  const filteredCircuit = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return circuitDuplicates;
    return circuitDuplicates.filter(
      (d) =>
        d.deviceName.toLowerCase().includes(q) ||
        d.positionText.toLowerCase().includes(q) ||
        d.entries.some((e) => e.circuitName.toLowerCase().includes(q) || e.trib.toLowerCase().includes(q))
    );
  }, [circuitDuplicates, search]);

  const filteredLibrary = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryDuplicates;
    return libraryDuplicates.filter(
      (d) =>
        d.deviceName.toLowerCase().includes(q) ||
        d.positionText.toLowerCase().includes(q) ||
        d.entries.some((e) => e.devicePosition.toLowerCase().includes(q))
    );
  }, [libraryDuplicates, search]);

  const total = circuitDuplicates.length + libraryDuplicates.length;
  if (total === 0) {
    return (
      <EmptyState text="Không phát hiện thiết bị nào có ≥2 Trib khác nhau cùng ra 1 vị trí ODF/DDF thật (không tính &quot;Kết nối trực tiếp&quot;)." />
    );
  }

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-red-800">
          Phát hiện {total} thiết bị có ≥2 Trib khác nhau cùng ra 1 vị trí ODF/DDF
        </h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-red-300 px-2 py-0.5 text-sm font-bold text-red-700 hover:bg-red-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <p className="mt-1 text-xs text-red-700">
            1 thiết bị + 1 Trib chỉ có đúng 1 cách ra — trừ &quot;Kết nối trực tiếp&quot; (không tính ở đây, được phép dùng
            chung cho nhiều Trib). Tự vào sửa tay, không tự đoán đâu là đúng.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input w-auto max-w-[260px] border-red-300"
              placeholder="Lọc theo thiết bị / vị trí / Trib..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {filteredCircuit.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500">Từ Hồ sơ đấu nối</p>
              <ul className="mt-1 space-y-2 text-sm text-red-700">
                {filteredCircuit.map((d, i) => (
                  <li key={`${d.deviceName}|${d.positionText}|${i}`}>
                    <span className="font-medium">{d.deviceName}</span> — vị trí &quot;{d.positionText}&quot;:{" "}
                    {d.entries.map((e, j) => (
                      <span key={e.circuitId}>
                        {j > 0 && "; "}
                        {e.trib} (
                        <a
                          href={`/odf-device/sua-luong#${rowAnchor(e.circuitId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-red-900"
                        >
                          {e.circuitName || "(chưa đặt tên)"}
                        </a>
                        )
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filteredLibrary.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
                Từ thư viện Vị trí thiết bị (dữ liệu cũ — tự vào{" "}
                <a href="/odf-device/vi-tri-thiet-bi" target="_blank" rel="noopener noreferrer" className="underline hover:text-red-900">
                  /odf-device/vi-tri-thiet-bi
                </a>{" "}
                sửa)
              </p>
              <ul className="mt-1 space-y-2 text-sm text-red-700">
                {filteredLibrary.map((d, i) => (
                  <li key={`${d.deviceName}|${d.positionText}|${i}`}>
                    <span className="font-medium">{d.deviceName}</span> — vị trí &quot;{d.positionText}&quot;: Trib{" "}
                    {d.entries.map((e) => e.devicePosition).join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filteredCircuit.length === 0 && filteredLibrary.length === 0 && <p className="mt-2 text-red-400">Không có dòng nào khớp bộ lọc.</p>}
        </>
      )}
    </div>
  );
}
