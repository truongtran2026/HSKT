import { fetchTrunkExportRows } from "@/lib/trunkExportData";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices } from "@/lib/devices";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import ImportExportClient from "@/components/import-export/ImportExportClient";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Import/Export dữ liệu" };

// Export Excel (yêu cầu người dùng 2026-08-07) — làm phần Export trước, Import
// để đợt sau (rủi ro ghi đè dữ liệu hạ tầng thật cao hơn nhiều, cần thiết kế
// riêng: xem trước thay đổi/diff trước khi ghi). Xem architecture.md.
export default async function ImportExportPage() {
  const supabase = await createSupabaseServerClient();
  const [trunkRows, deviceRows, devices] = await Promise.all([
    fetchTrunkExportRows(supabase),
    fetchDeviceCircuits(supabase),
    fetchDevices(supabase),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Import/Export dữ liệu</h1>
      <p className="mt-1 text-slate-500">
        Xuất dữ liệu ra Excel để lưu trữ/đối chiếu hoặc chỉnh sửa ngoài Excel. Phần Import (đọc file đã sửa, xác nhận thay đổi rồi ghi ngược vào hệ thống)
        sẽ làm ở đợt sau.
      </p>
      <div className="mt-6">
        <ImportExportClient trunkRows={trunkRows} deviceRows={deviceRows} devices={devices} />
      </div>
    </div>
  );
}
