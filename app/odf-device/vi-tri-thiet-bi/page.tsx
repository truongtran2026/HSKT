import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { fetchDevices } from "@/lib/devices";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceAliases } from "@/lib/deviceAliases";
import DevicePositionMapClient from "@/components/odf-device/DevicePositionMapClient";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Metadata } from "next";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Thư viện vị trí thiết bị" };

export default async function DevicePositionMapPage() {
  const supabase = await createSupabaseServerClient();
  const [rows, devices, trunkPorts, deviceAliases] = await Promise.all([
    fetchDevicePositionMap(supabase),
    fetchDevices(supabase),
    fetchAllOdfPorts(supabase),
    fetchDeviceAliases(supabase),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Thư viện vị trí thiết bị</h1>
      <p className="text-slate-500 mt-1">
        Danh mục tra cứu: 1 thiết bị tại 1 vị trí cụ thể đấu ra đúng vị trí ODF/DDF nào. Dùng để sau này nhập/sửa
        luồng thiết bị chỉ cần chọn thiết bị + vị trí là tự điền đúng vị trí ODF/DDF, tránh gõ tay sai định dạng.
      </p>
      <div className="mt-6">
        <DevicePositionMapClient rows={rows} devices={devices} trunkPorts={trunkPorts} deviceAliases={deviceAliases} />
      </div>
    </div>
  );
}
