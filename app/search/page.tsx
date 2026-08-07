import { fetchAllTrunkPorts } from "@/lib/trunkPorts";
import SearchClient from "@/components/search/SearchClient";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ (vd vừa sửa port ở tab khác rồi quay lại tìm kiếm).
export const dynamic = "force-dynamic";

export default async function SearchPage() {
  const supabase = await createSupabaseServerClient();
  const rows = await fetchAllTrunkPorts(supabase);
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 mb-1">Tìm kiếm nhanh</h1>
      <p className="text-sm text-slate-500 mb-4">
        Tìm theo tên luồng / mã rack / tuyến cáp / số port-sợi, lọc nhanh cổng trống hoặc đường dự phòng (ODF trung kế, trạm ADN1).
      </p>
      <SearchClient rows={rows} />
    </div>
  );
}
