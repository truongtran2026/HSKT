import type { Metadata } from "next";
import { fetchAllTrunkPorts } from "@/lib/trunkPorts";
import { derivePortStatus } from "@/lib/portStatus";
import DashboardClient, { type RouteStat, type OverallStat } from "@/components/dashboard/DashboardClient";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo ĐÚNG trang đang xem (yêu cầu người dùng
// 2026-08-08: trước đây MỌI trang đều hiện "Hồ sơ kỹ thuật" từ app/layout.tsx,
// không phân biệt được đang ở tab nào) — override title tĩnh của layout gốc.
export const metadata: Metadata = { title: "Dashboard" };

const UNNAMED_ROUTE = "(chưa đặt tên tuyến)";

async function getDashboardData(client: SupabaseClient): Promise<{ routes: RouteStat[]; overall: OverallStat }> {
  const ports = await fetchAllTrunkPorts(client);

  const map = new Map<string, RouteStat>();
  const overall: OverallStat = { total: 0, inUse: 0, standby: 0, empty: 0 };

  for (const p of ports) {
    const key = p.cableRouteName ?? UNNAMED_ROUTE;
    if (!map.has(key)) map.set(key, { cableRouteName: key, total: 0, inUse: 0, standby: 0, empty: 0 });
    const stat = map.get(key)!;

    const ds = derivePortStatus(p.circuit);
    stat.total++;
    overall.total++;
    if (ds === "empty") {
      stat.empty++;
      overall.empty++;
    } else if (ds === "standby") {
      stat.standby++;
      overall.standby++;
    } else {
      stat.inUse++;
      overall.inUse++;
    }
  }

  return { routes: [...map.values()], overall };
}

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const { routes, overall } = await getDashboardData(supabase);
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Dashboard</h1>
      <p className="text-slate-500 mt-1">
        Thống kê % sợi đang dùng / dự phòng / trống theo từng tuyến cáp — ODF trung kế, trạm ADN1.
      </p>
      <div className="mt-6">
        <DashboardClient routes={routes} overall={overall} />
      </div>
    </div>
  );
}
