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

export default async function OdfDdfNoiBoPage() {
  const racks = await getRacks();

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">ODF/DDF nội bộ</h1>
      <p className="text-slate-500 mt-1">
        Đấu chéo thiết bị-thiết bị tại ADN1 (không phải tuyến cáp ra trạm khác). Bấm vào 1 rack để xem/sửa chi tiết
        từng port, hoặc tăng số port khi tháo gỡ ODF/DDF cũ, thay ODF/DDF mới có số port khác.
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
