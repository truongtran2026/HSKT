import { supabase } from "@/lib/supabase";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import { derivePortStatus } from "@/lib/portStatus";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";

// Bắt buộc cho MỌI trang lấy dữ liệu từ Supabase: nếu không có dòng này,
// Next.js cache lại kết quả fetch đầu tiên và không bao giờ lấy dữ liệu mới
// (đã gặp lỗi này khi test thật — sửa xong RLS nhưng trang vẫn hiện dữ liệu
// cũ/rỗng vì bị cache). Dữ liệu ODF thay đổi liên tục nên luôn cần mới nhất.
export const dynamic = "force-dynamic";

interface RawPortLink {
  circuits: { name: string } | { name: string }[] | null;
}
interface RawPort {
  status: string;
  port_circuit_links: RawPortLink | RawPortLink[] | null;
}
interface RawRack {
  id: string;
  code: string;
  cable_route_name: string | null;
  odf_type: "welded" | "distribution";
  port_count: number;
  ports: RawPort[];
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

async function getRacks(): Promise<RackListItem[]> {
  // ports(status, port_circuit_links(circuits(name))) — CẦN tên luồng thật
  // (không chỉ ports.status) để tính Đang dùng/Dự phòng đúng chuẩn
  // derivePortStatus() (yêu cầu người dùng 2026-07-28, cùng đợt sửa số liệu
  // sai bên "Hồ sơ ODF Thiết bị" — nhân tiện đồng bộ luôn cách tính ở đây,
  // trước giờ dùng ports.status là cột KHÔNG đáng tin theo chính comment ở
  // lib/portStatus.ts, dù bên trung kế status CÓ được cập nhật qua Sửa/Xóa/
  // Chuyển tuyến nên không sai lệch nhiều như bên thiết bị — vẫn nên dùng
  // đúng 1 nguồn chuẩn duy nhất cho nhất quán).
  const { data, error } = await supabase
    .from("racks")
    .select("id, code, cable_route_name, odf_type, port_count, ports(status, port_circuit_links(circuits(name)))")
    .eq("domain", "trunk");
  if (error) throw error;
  return ((data ?? []) as unknown as RawRack[]).map((r) => {
    let inUsePorts = 0;
    let standbyPorts = 0;
    for (const p of r.ports) {
      const link = firstOf(p.port_circuit_links);
      const circuit = link ? firstOf(link.circuits) : null;
      const status = derivePortStatus(circuit);
      if (status === "in_use") inUsePorts++;
      else if (status === "standby") standbyPorts++;
    }
    return {
      id: r.id,
      code: r.code,
      cableRouteName: r.cable_route_name,
      odfType: r.odf_type,
      portCount: r.port_count,
      inUsePorts,
      standbyPorts,
    };
  });
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
