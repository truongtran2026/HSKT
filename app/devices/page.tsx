import { fetchDevices, getAdn1StationId } from "@/lib/devices";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import DeviceCategoryClient from "@/components/devices/DeviceCategoryClient";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

export default async function DevicesPage() {
  const [devices, circuits, stationId] = await Promise.all([fetchDevices(), fetchDeviceCircuits(), getAdn1StationId()]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Danh mục thiết bị</h1>
      <p className="text-slate-500 mt-1">
        Toàn bộ thiết bị đã chuẩn hóa (tự sinh khi lưu luồng/nhập tay), chỉ trạm ADN1. Tick chọn 1 hoặc nhiều thiết
        bị để gán/đổi lĩnh vực, đổi tên, hoặc gộp nhiều thiết bị trùng thành 1. Luồng thiết bị chưa gán thiết bị
        chuẩn (nếu có) hiện riêng ở khung phía trên bảng.
      </p>
      <div className="mt-6">
        <DeviceCategoryClient devices={devices} circuits={circuits} stationId={stationId} />
      </div>
    </div>
  );
}
