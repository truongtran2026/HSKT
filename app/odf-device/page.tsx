import Link from "next/link";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices } from "@/lib/devices";
import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import DeviceCircuitList from "@/components/odf-device/DeviceCircuitList";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

export default async function OdfDevicePage() {
  const [circuits, devices, devicePositionMap] = await Promise.all([
    fetchDeviceCircuits(),
    fetchDevices(),
    fetchDevicePositionMap(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ ODF Thiết bị</h1>
      <p className="text-slate-500 mt-1">Danh sách {circuits.length} luồng đấu nối tại thiết bị, xem/sửa/xóa ngay tại đây.</p>
      <p className="mt-2">
        <Link href="/devices" className="text-sm text-primary-600 hover:underline">
          → Chuẩn hóa / đổi tên thiết bị
        </Link>
      </p>
      <div className="mt-6">
        <DeviceCircuitList circuits={circuits} devices={devices} devicePositionMap={devicePositionMap} />
      </div>
    </div>
  );
}
