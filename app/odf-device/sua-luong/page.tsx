import Link from "next/link";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices } from "@/lib/devices";
import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
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
        <DeviceCircuitList circuits={circuits} devices={devices} devicePositionMap={devicePositionMap} trunkPorts={trunkPorts} />
      </div>
    </div>
  );
}
