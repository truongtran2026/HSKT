import { fetchDevices } from "@/lib/devices";
import { fetchDeviceCircuits, findDevicePositionConflicts } from "@/lib/deviceCircuits";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { findTransitPositionMismatches } from "@/lib/transitPositionMismatches";
import { findFuzzyDuplicateDevices, fetchIgnoredDevicePairs } from "@/lib/deviceDedup";
import { findTrunkCircuitsMissingDeviceMirror } from "@/lib/reverseDeviceTrunkAudit";
import { findUnlinkedDeviceDevicePairs } from "@/lib/unlinkedMirrorPairs";
import { findAllDeviceTrunkPairs } from "@/lib/circuitPairSync";
import DataQualityClient from "@/components/data-quality/DataQualityClient";

// Trang "Chất lượng dữ liệu" (yêu cầu người dùng 2026-07-29) — gộp 3 khung
// rà soát trước đây nằm rời rạc (Chuyển tiếp chưa chuẩn form mỗi rack/danh
// sách rack; thiết bị trùng gần đúng chưa từng có UI; xung đột vị trí ODF
// thiết bị trước đây chỉ hiện ở DeviceCircuitList.tsx) thành 1 nơi rà hàng
// ngày duy nhất. Bắt buộc force-dynamic như mọi trang đọc Supabase khác
// (xem app/odf-trunk/page.tsx) để không bị cache dữ liệu cũ.
export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const [devices, circuits, trunkPorts, ignoredPairs, trunkMissingDeviceItems, devicePositionMap] = await Promise.all([
    fetchDevices(),
    fetchDeviceCircuits(),
    fetchAllOdfPorts(),
    fetchIgnoredDevicePairs(),
    findTrunkCircuitsMissingDeviceMirror(),
    fetchDevicePositionMap(),
  ]);
  // fetchNonConformingTransitLinks/findUnlinkedMirrorPairs cần trunkPorts đã
  // tải xong (đối chiếu phần ODF bên trong) nên chờ riêng, không gộp Promise.all.
  const nonConformingTransit = await fetchNonConformingTransitLinks(trunkPorts);
  const unlinkedDeviceDevicePairs = findUnlinkedDeviceDevicePairs(circuits, devices);
  const dupCandidates = findFuzzyDuplicateDevices(devices, circuits, ignoredPairs);
  const positionConflicts = findDevicePositionConflicts(circuits);
  // Ô "Chuyển tiếp" ghi sai tọa độ ODF so với Vị trí thiết bị đã xác nhận
  // (yêu cầu người dùng 2026-08-02, phát hiện từ ca thật ADN1.P2(2/1/2) — xem
  // lib/transitPositionMismatches.ts).
  const transitPositionMismatches = await findTransitPositionMismatches(devicePositionMap);
  // "Kiểm tra 01 luồng" đúng ánh xạ vật lý (yêu cầu người dùng 2026-08-02, sau
  // khi chỉ ra cách rà CŨ ở trên "không logic") — 1 lượt tính duy nhất cho CẢ
  // cặp chưa liên kết (thay dữ liệu cho tab mục 44, đồng bộ ĐỦ 3 điểm thay vì
  // chỉ tên) LẪN cặp đã liên kết nhưng lệch (tab mới, LOẠI 6) — xem
  // lib/circuitPairSync.ts.
  const allDeviceTrunkPairs = await findAllDeviceTrunkPairs(trunkPorts, circuits);
  const unlinkedPairDetails = allDeviceTrunkPairs.filter((p) => !p.isLinked);
  const mismatchedLinkedPairs = allDeviceTrunkPairs.filter(
    (p) => p.isLinked && (!p.nameMatch || p.ownPositionMatch === false || p.nextPositionMatch === false)
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Chất lượng dữ liệu</h1>
      <p className="mt-1 text-slate-500">
        Nơi rà soát tập trung — trước đây các cảnh báo này nằm rời rạc ở từng trang, phải vào từng nơi mới thấy.
      </p>

      <div className="mt-6">
        <DataQualityClient
          transitItems={nonConformingTransit}
          dupCandidates={dupCandidates}
          positionConflicts={positionConflicts}
          trunkMissingDeviceItems={trunkMissingDeviceItems}
          unlinkedDeviceDevicePairs={unlinkedDeviceDevicePairs}
          transitPositionMismatches={transitPositionMismatches}
          unlinkedPairDetails={unlinkedPairDetails}
          mismatchedLinkedPairs={mismatchedLinkedPairs}
        />
      </div>
    </div>
  );
}
