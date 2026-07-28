import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

interface RawRack {
  id: string;
  code: string;
  cable_route_name: string | null;
  odf_type: "welded" | "distribution";
  port_count: number;
  ports: { status: string }[];
}

async function getRacks(): Promise<RackListItem[]> {
  const { data, error } = await supabase
    .from("racks")
    .select("id, code, cable_route_name, odf_type, port_count, ports(status)")
    .eq("domain", "device");
  if (error) throw error;
  return ((data ?? []) as unknown as RawRack[]).map((r) => ({
    id: r.id,
    code: r.code,
    cableRouteName: r.cable_route_name,
    odfType: r.odf_type,
    portCount: r.port_count,
    totalPorts: r.ports.length,
    inUsePorts: r.ports.filter((p) => p.status === "in_use").length,
  }));
}

// Nội dung này trước ở app/odf-device/odf-ddf-noi-bo/page.tsx — chuyển về
// đây (yêu cầu người dùng 2026-07-28) để "Hồ sơ ODF Thiết bị" có cấu trúc
// rack → port → luồng giống hệt "Hồ sơ ODF Trung kế", thay vì danh sách luồng
// phẳng như trước (nay chuyển sang "/odf-device/sua-luong", xem
// architecture.md). Bấm vào 1 rack dùng lại NGUYÊN trang
// "/odf-trunk/[rackId]" (đã domain-aware sẵn).
export default async function OdfDevicePage() {
  const racks = await getRacks();

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
      {/* Cột "Tuyến cáp" trong bảng dưới sẽ luôn trống với loại rack này —
          không có ý nghĩa ngoài domain=trunk (đúng theo comment cột
          racks.cable_route_name trong schema), không phải thiếu dữ liệu. */}
      <div className="mt-6">
        <RackListTable racks={racks} />
      </div>
    </div>
  );
}
