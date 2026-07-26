import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices, getAdn1StationId } from "@/lib/devices";
import DeviceStandardizeClient from "@/components/odf-device/DeviceStandardizeClient";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

export default async function DeviceStandardizePage() {
  const [circuits, devices, stationId] = await Promise.all([fetchDeviceCircuits(), fetchDevices(), getAdn1StationId()]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Chuẩn hóa thiết bị</h1>
      <p className="text-slate-500 mt-1">
        Tên thiết bị đang được gõ tay nhiều kiểu khác nhau cho cùng 1 thiết bị thực (vd &quot;ADX#13&quot; và &quot;ADX
        #13&quot;). Nhóm dưới đây gộp các biến thể có khả năng trùng nhau — xem lại, sửa tên chuẩn nếu cần, rồi bấm
        &quot;Áp dụng&quot; từng nhóm. Sau khi chuẩn hóa xong, hệ thống sẽ tự kiểm tra xem có vị trí DDF/ODF nào đang
        bị gán cho 2 thiết bị khác nhau không.
      </p>
      <div className="mt-6">
        <DeviceStandardizeClient circuits={circuits} initialDevices={devices} stationId={stationId} />
      </div>
    </div>
  );
}
