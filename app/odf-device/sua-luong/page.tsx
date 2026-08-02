import Link from "next/link";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices } from "@/lib/devices";
import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { findUnlinkedMirrorPairs, findUnlinkedDeviceDevicePairs } from "@/lib/unlinkedMirrorPairs";
import { computeMirrorLinkStatuses } from "@/lib/mirrorLinkStatus";
import { findAllDeviceTrunkPairs } from "@/lib/circuitPairSync";
import DeviceCircuitList from "@/components/odf-device/DeviceCircuitList";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

// Chuyển từ app/odf-device/page.tsx sang đây (yêu cầu người dùng 2026-07-28):
// "/odf-device" giờ là danh sách rack (Hồ sơ ODF Thiết bị mới, xem
// architecture.md) — trang PHẲNG (Thêm/Sửa/Xóa luồng) chuyển về đây. Đổi tên
// hiển thị "Sửa luồng thiết bị" -> "Hồ sơ đấu nối" (yêu cầu người dùng
// 2026-07-28, cùng đợt sửa Sidebar) — vẫn là nơi DUY NHẤT thao tác chi tiết
// luồng, chỉ đổi tên cho rõ nghĩa hơn.
export default async function SuaLuongThietBiPage() {
  // fetchAllOdfPorts (không phải fetchAllTrunkPorts) — cần CẢ rack trung kế
  // lẫn ODF/DDF nội bộ (domain='device') để "Vị trí ODF (tiếp theo)" nhận
  // diện/chuẩn hóa được cả 2 loại (yêu cầu người dùng 2026-07-27).
  const [circuits, devices, devicePositionMap, trunkPorts] = await Promise.all([
    fetchDeviceCircuits(),
    fetchDevices(),
    fetchDevicePositionMap(),
    fetchAllOdfPorts(),
  ]);
  // Huy hiệu "Đã liên kết"/"Chưa liên kết" trên từng dòng (yêu cầu người dùng
  // 2026-08-02) — tái dùng ĐÚNG 2 hàm rà soát đã có ở /data-quality (mục
  // 44/45), không viết thuật toán khác ở đây. Rẻ: không thêm round-trip
  // Supabase nào (xem lib/mirrorLinkStatus.ts).
  const [unlinkedMirrorPairs, unlinkedDeviceDevicePairs] = await Promise.all([
    findUnlinkedMirrorPairs(trunkPorts, circuits),
    findUnlinkedDeviceDevicePairs(circuits, devices),
  ]);
  const mirrorLinkStatuses = computeMirrorLinkStatuses(trunkPorts, circuits, unlinkedMirrorPairs, unlinkedDeviceDevicePairs);
  // Nút "Kiểm tra đồng bộ" ngay trong form sửa 1 luồng (yêu cầu người dùng
  // 2026-08-02 — xem lib/circuitPairSync.ts).
  const circuitPairDetails = await findAllDeviceTrunkPairs(trunkPorts, circuits);
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ đấu nối</h1>
      <p className="text-slate-500 mt-1">Danh sách {circuits.length} luồng đấu nối tại thiết bị, xem/sửa/xóa ngay tại đây.</p>
      <p className="mt-2">
        <Link href="/devices" className="text-sm text-primary-600 hover:underline">
          → Chuẩn hóa / đổi tên thiết bị
        </Link>
      </p>
      <div className="mt-6">
        <DeviceCircuitList
          circuits={circuits}
          devices={devices}
          devicePositionMap={devicePositionMap}
          trunkPorts={trunkPorts}
          mirrorLinkStatuses={mirrorLinkStatuses}
          circuitPairDetails={circuitPairDetails}
        />
      </div>
    </div>
  );
}
