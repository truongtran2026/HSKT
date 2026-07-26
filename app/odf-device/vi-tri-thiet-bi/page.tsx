import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { fetchDevices } from "@/lib/devices";
import DevicePositionMapClient from "@/components/odf-device/DevicePositionMapClient";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

export default async function DevicePositionMapPage() {
  const [rows, devices] = await Promise.all([fetchDevicePositionMap(), fetchDevices()]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Vị trí thiết bị → ODF/DDF</h1>
      <p className="text-slate-500 mt-1">
        Danh mục tra cứu: 1 thiết bị tại 1 vị trí cụ thể đấu ra đúng vị trí ODF/DDF nào. Dùng để sau này nhập/sửa
        luồng thiết bị chỉ cần chọn thiết bị + vị trí là tự điền đúng vị trí ODF/DDF, tránh gõ tay sai định dạng.
      </p>
      <div className="mt-6">
        <DevicePositionMapClient rows={rows} deviceNameOptions={devices.map((d) => d.name)} />
      </div>
    </div>
  );
}
