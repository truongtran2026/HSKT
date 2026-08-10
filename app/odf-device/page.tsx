import { Suspense } from "react";
import type { Metadata } from "next";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceRackPortStatusCounts } from "@/lib/deviceRackPorts";
import { getAdn1StationId } from "@/lib/devices";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";
import AddDeviceRackForm from "@/components/odf-device/AddDeviceRackForm";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Hồ sơ ODF Thiết bị" };

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

// Tách phần đếm port (nặng, cần fetchAllOdfPorts toàn trạm) ra 1 async
// component riêng bọc <Suspense> (tối ưu 2026-08-08, cùng đợt với
// app/odf-trunk/page.tsx — xem architecture.md) — trước đây toàn trang phải
// đợi xong fetchAllOdfPorts + fetchDeviceRackPortStatusCounts rồi mới trả
// HTML, dù <AddDeviceRackForm> (không cần racks/counts) đáng ra hiện được
// ngay.
async function RackListSection({ supabase }: { supabase: SupabaseClient }) {
  const racks = await getRacks(supabase);
  return <RackListTable racks={racks} />;
}

function RackListSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
      Đang tải danh sách rack...
    </div>
  );
}

// Nội dung này trước ở app/odf-device/odf-ddf-noi-bo/page.tsx — chuyển về
// đây (yêu cầu người dùng 2026-07-28) để "Hồ sơ ODF Thiết bị" có cấu trúc
// rack → port → luồng giống hệt "Hồ sơ ODF Trung kế", thay vì danh sách luồng
// phẳng như trước (nay chuyển sang "/odf-device/sua-luong", xem
// architecture.md). Bấm vào 1 rack dùng lại NGUYÊN trang
// "/odf-trunk/[rackId]" (đã domain-aware sẵn).
export default async function OdfDevicePage() {
  const supabase = await createSupabaseServerClient();
  const stationId = await getAdn1StationId(supabase);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ ODF Thiết bị</h1>
      <p className="text-slate-500 mt-1">
        ODF/DDF phân phối tại thiết bị ADN1 (đấu chéo thiết bị-thiết bị, không phải tuyến cáp ra trạm khác). Bấm vào
        1 rack để xem port nào đang có luồng thật, hoặc tăng số port khi tháo gỡ ODF/DDF cũ, thay ODF/DDF mới có số
        port khác.
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
        <Suspense fallback={<RackListSkeleton />}>
          <RackListSection supabase={supabase} />
        </Suspense>
      </div>
    </div>
  );
}
