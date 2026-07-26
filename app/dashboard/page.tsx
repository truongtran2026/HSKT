import { fetchAllTrunkPorts } from "@/lib/trunkPorts";
import { derivePortStatus } from "@/lib/portStatus";
import DashboardClient, { type RouteStat, type OverallStat } from "@/components/dashboard/DashboardClient";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

const UNNAMED_ROUTE = "(chưa đặt tên tuyến)";

async function getDashboardData(): Promise<{ routes: RouteStat[]; overall: OverallStat }> {
  const ports = await fetchAllTrunkPorts();

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
  const { routes, overall } = await getDashboardData();
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
