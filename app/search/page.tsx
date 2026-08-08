import { fetchAllTrunkPorts } from "@/lib/trunkPorts";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import SearchTabs from "@/components/search/SearchTabs";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { Metadata } from "next";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ (vd vừa sửa port ở tab khác rồi quay lại tìm kiếm).
export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Tìm kiếm nhanh" };

export default async function SearchPage() {
  const supabase = await createSupabaseServerClient();
  const [trunkRows, deviceRows] = await Promise.all([fetchAllTrunkPorts(supabase), fetchDeviceCircuits(supabase)]);
  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-800 mb-1">Tìm kiếm nhanh</h1>
      <p className="text-sm text-slate-500 mb-4">
        Tìm theo tên luồng / mã rack / tuyến cáp / vị trí ODF, lọc nhanh cổng trống hoặc đường dự phòng — cả ODF trung kế lẫn Hồ sơ đấu nối thiết bị (trạm
        ADN1).
      </p>
      <SearchTabs trunkRows={trunkRows} deviceRows={deviceRows} />
    </div>
  );
}
