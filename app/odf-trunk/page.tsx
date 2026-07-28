import { supabase } from "@/lib/supabase";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";

// Bắt buộc cho MỌI trang lấy dữ liệu từ Supabase: nếu không có dòng này,
// Next.js cache lại kết quả fetch đầu tiên và không bao giờ lấy dữ liệu mới
// (đã gặp lỗi này khi test thật — sửa xong RLS nhưng trang vẫn hiện dữ liệu
// cũ/rỗng vì bị cache). Dữ liệu ODF thay đổi liên tục nên luôn cần mới nhất.
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
    .eq("domain", "trunk");
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

export default async function OdfTrunkPage() {
  const [racks, trunkPorts] = await Promise.all([getRacks(), fetchAllOdfPorts()]);
  // fetchNonConformingTransitLinks cần trunkPorts để đối chiếu phần ODF bên
  // trong (xem lib/transitLinks.ts) -> phải chờ trunkPorts xong trước, không
  // gộp chung Promise.all ở trên được (phụ thuộc kết quả nhau).
  const nonConformingTransit = await fetchNonConformingTransitLinks(trunkPorts);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">ODF Trung kế</h1>
      <p className="text-slate-500 mt-1">Bấm vào 1 rack để xem/sửa chi tiết từng port.</p>

      <div className="mt-6">
        <TransitFormatWarning items={nonConformingTransit} />
        <RackListTable racks={racks} />
      </div>
    </div>
  );
}
