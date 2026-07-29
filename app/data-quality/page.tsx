import { fetchDevices } from "@/lib/devices";
import { fetchDeviceCircuits, findDevicePositionConflicts } from "@/lib/deviceCircuits";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import { findFuzzyDuplicateDevices, fetchIgnoredDevicePairs } from "@/lib/deviceDedup";
import DataQualityClient from "@/components/data-quality/DataQualityClient";

// Trang "Chất lượng dữ liệu" (yêu cầu người dùng 2026-07-29) — gộp 3 khung
// rà soát trước đây nằm rời rạc (Chuyển tiếp chưa chuẩn form mỗi rack/danh
// sách rack; thiết bị trùng gần đúng chưa từng có UI; xung đột vị trí ODF
// thiết bị trước đây chỉ hiện ở DeviceCircuitList.tsx) thành 1 nơi rà hàng
// ngày duy nhất. Bắt buộc force-dynamic như mọi trang đọc Supabase khác
// (xem app/odf-trunk/page.tsx) để không bị cache dữ liệu cũ.
export const dynamic = "force-dynamic";

export default async function DataQualityPage() {
  const [devices, circuits, trunkPorts, ignoredPairs] = await Promise.all([
    fetchDevices(),
    fetchDeviceCircuits(),
    fetchAllOdfPorts(),
    fetchIgnoredDevicePairs(),
  ]);
  // fetchNonConformingTransitLinks cần trunkPorts đã tải xong (đối chiếu phần
  // ODF bên trong, xem lib/transitLinks.ts) nên chờ riêng, không gộp Promise.all.
  const nonConformingTransit = await fetchNonConformingTransitLinks(trunkPorts);
  const dupCandidates = findFuzzyDuplicateDevices(devices, circuits, ignoredPairs);
  const positionConflicts = findDevicePositionConflicts(circuits);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Chất lượng dữ liệu</h1>
      <p className="mt-1 text-slate-500">
        Nơi rà soát tập trung — trước đây các cảnh báo này nằm rời rạc ở từng trang, phải vào từng nơi mới thấy.
      </p>

      <div className="mt-6">
        <DataQualityClient transitItems={nonConformingTransit} dupCandidates={dupCandidates} positionConflicts={positionConflicts} />
      </div>
    </div>
  );
}
