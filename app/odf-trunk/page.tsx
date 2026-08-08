import { Suspense } from "react";
import type { Metadata } from "next";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import { derivePortStatus } from "@/lib/portStatus";
import { type RackListItem } from "@/components/odf-trunk/RackListTable";
import TrunkRackListPanel from "@/components/odf-trunk/TrunkRackListPanel";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Bắt buộc cho MỌI trang lấy dữ liệu từ Supabase: nếu không có dòng này,
// Next.js cache lại kết quả fetch đầu tiên và không bao giờ lấy dữ liệu mới
// (đã gặp lỗi này khi test thật — sửa xong RLS nhưng trang vẫn hiện dữ liệu
// cũ/rỗng vì bị cache). Dữ liệu ODF thay đổi liên tục nên luôn cần mới nhất.
export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Hồ sơ ODF Trung kế" };

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

async function getRacks(supabase: SupabaseClient): Promise<RackListItem[]> {
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

// Tách riêng khỏi OdfTrunkPage + bọc <Suspense> (tối ưu 2026-08-08, người
// dùng hỏi vì sao vào trang danh sách rack chậm) — trước đây trang này CHỜ
// XONG CẢ fetchAllOdfPorts (toàn bộ port toàn trạm) + fetchNonConformingTransitLinks
// rồi mới trả HTML, dù danh sách rack chính (TrunkRackListPanel) không cần 2
// lời gọi đó chút nào (getRacks() tự có query riêng, nhẹ hơn nhiều). Kết quả:
// người dùng phải đợi đúng bằng thời gian của khung cảnh báo "Chuyển tiếp
// chưa chuẩn form" mới thấy được cả danh sách rack, kể cả khi khung đó đang
// thu gọn/không quan tâm. Suspense cho phép HTML của danh sách rack (getRacks,
// nhanh) trả về NGAY, còn khung cảnh báo (chậm hơn) tự "trôi" vào sau khi
// xong — không đổi hành vi/dữ liệu hiển thị, chỉ đổi THỜI ĐIỂM nó xuất hiện.
async function TransitWarningSection({ supabase }: { supabase: SupabaseClient }) {
  const trunkPorts = await fetchAllOdfPorts(supabase);
  // fetchNonConformingTransitLinks cần trunkPorts để đối chiếu phần ODF bên
  // trong (xem lib/transitLinks.ts) -> phải chờ trunkPorts xong trước.
  const nonConformingTransit = await fetchNonConformingTransitLinks(supabase, trunkPorts);
  return <TransitFormatWarning items={nonConformingTransit} />;
}

function TransitWarningSkeleton() {
  return (
    <div className="mb-4 animate-pulse rounded-lg border border-amber-100 bg-amber-50/60 px-4 py-2.5 text-sm text-amber-500">
      Đang kiểm tra &quot;Chuyển tiếp&quot; chưa đúng chuẩn form...
    </div>
  );
}

export default async function OdfTrunkPage() {
  const supabase = await createSupabaseServerClient();
  const racks = await getRacks(supabase);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ ODF Trung kế</h1>
      <p className="text-slate-500 mt-1">Bấm vào 1 rack để xem/sửa chi tiết từng port.</p>

      <div className="mt-6">
        <Suspense fallback={<TransitWarningSkeleton />}>
          <TransitWarningSection supabase={supabase} />
        </Suspense>
        <TrunkRackListPanel racks={racks} />
      </div>
    </div>
  );
}
