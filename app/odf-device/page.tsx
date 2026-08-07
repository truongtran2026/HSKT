import Link from "next/link";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceRackPortStatusCounts } from "@/lib/deviceRackPorts";
import { getAdn1StationId } from "@/lib/devices";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";
import AddDeviceRackForm from "@/components/odf-device/AddDeviceRackForm";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

interface RawRack {
  id: string;
  code: string;
  cable_route_name: string | null;
  odf_type: "welded" | "distribution";
  port_count: number;
}

async function getRacks(supabase: SupabaseClient): Promise<RackListItem[]> {
  const { data, error } = await supabase
    .from("racks")
    .select("id, code, cable_route_name, odf_type, port_count")
    .eq("domain", "device");
  if (error) throw error;
  const racks = (data ?? []) as RawRack[];

  // Đang dùng/Dự phòng/Trống tính từ CHÍNH dữ liệu luồng thật (yêu cầu người
  // dùng 2026-07-28: số liệu cũ đọc ports.status luôn hiện sai "0/48" vì luồng
  // thiết bị không hề đụng tới bảng ports thật — xem lib/deviceRackPorts.ts +
  // architecture.md).
  const trunkPorts = await fetchAllOdfPorts(supabase);
  const counts = await fetchDeviceRackPortStatusCounts(
    supabase,
    racks.map((r) => ({ id: r.id, code: r.code, portCount: r.port_count })),
    trunkPorts
  );

  return racks.map((r) => {
    const c = counts.get(r.id) ?? { inUse: 0, standby: 0, empty: r.port_count };
    return {
      id: r.id,
      code: r.code,
      cableRouteName: r.cable_route_name,
      odfType: r.odf_type,
      portCount: r.port_count,
      inUsePorts: c.inUse,
      standbyPorts: c.standby,
    };
  });
}

// Nội dung này trước ở app/odf-device/odf-ddf-noi-bo/page.tsx — chuyển về
// đây (yêu cầu người dùng 2026-07-28) để "Hồ sơ ODF Thiết bị" có cấu trúc
// rack → port → luồng giống hệt "Hồ sơ ODF Trung kế", thay vì danh sách luồng
// phẳng như trước (nay chuyển sang "/odf-device/sua-luong", xem
// architecture.md). Bấm vào 1 rack dùng lại NGUYÊN trang
// "/odf-trunk/[rackId]" (đã domain-aware sẵn).
export default async function OdfDevicePage() {
  const supabase = await createSupabaseServerClient();
  const [racks, stationId] = await Promise.all([getRacks(supabase), getAdn1StationId(supabase)]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ ODF Thiết bị</h1>
      <p className="text-slate-500 mt-1">
        ODF/DDF phân phối tại thiết bị ADN1 (đấu chéo thiết bị-thiết bị, không phải tuyến cáp ra trạm khác). Bấm vào
        1 rack để xem port nào đang có luồng thật, hoặc tăng số port khi tháo gỡ ODF/DDF cũ, thay ODF/DDF mới có số
        port khác.
      </p>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Link href="/odf-device/sua-luong" className="text-primary-600 hover:underline">
          → Thêm / sửa / xóa luồng thiết bị
        </Link>
        <Link href="/odf-device/vi-tri-thiet-bi" className="text-primary-600 hover:underline">
          → Thư viện vị trí gợi ý (device → ODF/DDF)
        </Link>
      </p>

      {/* Thêm rack mới (yêu cầu người dùng 2026-07-28: "Chưa có phần thêm/
          sửa/xóa Rack") — CHỈ domain='device', đặt ở đây (trang danh sách)
          vì rack mới chưa có trang chi tiết để "sửa" từ đó. Sửa số port
          (RackAdminPanel) + xóa rack (DeleteRackButton) vẫn ở trang chi tiết
          từng rack, xem app/odf-trunk/[rackId]/page.tsx. */}
      <div className="mt-6">
        <AddDeviceRackForm stationId={stationId} />
      </div>

      {/* Cột "Tuyến cáp" trong bảng dưới sẽ luôn trống với loại rack này —
          không có ý nghĩa ngoài domain=trunk (đúng theo comment cột
          racks.cable_route_name trong schema), không phải thiếu dữ liệu. */}
      <div className="mt-6">
        <RackListTable racks={racks} />
      </div>
    </div>
  );
}
