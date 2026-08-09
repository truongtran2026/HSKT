"use client";

import { useEffect, useMemo, useState } from "react";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export interface RouteStat {
  cableRouteName: string;
  total: number;
  inUse: number;
  standby: number;
  empty: number;
}

type SortBy = "name" | "percentInUse" | "total";

const COLORS = { inUse: "#10b981", standby: "#f59e0b", empty: "#94a3b8" };
const ROUTE_FILTER_KEY = "dashboard-route-filter-v2";

// Đổi từ 4 kiểu xem tách rời qua tab (Bảng/Thẻ/Cột/Tròn, mỗi kiểu 1 bộ lọc
// tuyến riêng) sang MỘT giao diện duy nhất hiện Tròn + Cột + Bảng cùng lúc
// từ trên xuống (yêu cầu người dùng 2026-08-09: "không để từng thẻ và bấm
// vào mới hiển thị nữa"). Vì chỉ còn 1 giao diện nên chỉ cần 1 bộ lọc tuyến
// DÙNG CHUNG (không còn khái niệm "mỗi kiểu lưu riêng" như trước) — đổi hẳn
// key localStorage (không phải thêm hậu tố) để không đọc nhầm dữ liệu cũ
// theo từng kiểu xem đã bỏ.
function loadRouteFilter(): string[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ROUTE_FILTER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

type StatFilterKey = "route" | "total" | "inUse" | "standby" | "empty";

function matchesStatFilters(r: RouteStat, filters: Record<StatFilterKey, string>): boolean {
  return (
    matchesFilter(r.cableRouteName, filters.route) &&
    matchesFilter(r.total, filters.total) &&
    matchesFilter(r.inUse, filters.inUse) &&
    matchesFilter(r.standby, filters.standby) &&
    matchesFilter(r.empty, filters.empty)
  );
}

function sumRoutes(routes: RouteStat[]): { total: number; inUse: number; standby: number; empty: number } {
  const sum = { total: 0, inUse: 0, standby: 0, empty: 0 };
  for (const r of routes) {
    sum.total += r.total;
    sum.inUse += r.inUse;
    sum.standby += r.standby;
    sum.empty += r.empty;
  }
  return sum;
}

export default function DashboardClient({ routes }: { routes: RouteStat[] }) {
  const [sortBy, setSortBy] = useState<SortBy>("name");
  // routeFilter = null nghĩa là "chưa lọc, hiện tất cả" (mặc định) — mảng
  // (kể cả rỗng) là danh sách tuyến người dùng đã chủ động chọn, DÙNG CHUNG
  // cho cả biểu đồ Tròn/Cột/Bảng (yêu cầu người dùng 2026-08-09).
  const [routeFilter, setRouteFilterState] = useState<string[] | null>(null);

  // Đọc bộ lọc đã lưu SAU khi mount (tránh lệch giữa SSR và client).
  useEffect(() => {
    setRouteFilterState(loadRouteFilter());
  }, []);

  function setRouteFilter(next: string[] | null) {
    setRouteFilterState(next);
    if (typeof window === "undefined") return;
    if (next === null) window.localStorage.removeItem(ROUTE_FILTER_KEY);
    else window.localStorage.setItem(ROUTE_FILTER_KEY, JSON.stringify(next));
  }

  // Danh sách cho GroupedMultiSelect (yêu cầu người dùng 2026-08-09: sửa lỗi
  // "chọn tuyến hiển thị" y hệt lỗi ĐàI ĐÃ FIX ở /odf-trunk — bấm ra ngoài
  // phải tự đóng, "Chọn tất cả" sau khi gõ tìm chỉ chọn đúng phần đang lọc,
  // dropdown phải nổi TRÊN tiêu đề bảng sticky — dùng THẲNG
  // components/ui/GroupedMultiSelect.tsx đã fix sẵn 3 lỗi này thay vì tự viết
  // lại 1 bản riêng dễ lặp lại lỗi cũ; xem quy định chung ở architecture.md).
  // `group: ""` cho mọi tuyến — component tự chuyển sang chế độ phẳng (không
  // có cấp nhóm nào bên dưới tuyến cáp ở màn hình này).
  const routeItems = useMemo(
    () =>
      [...routes]
        .sort((a, b) => a.cableRouteName.localeCompare(b.cableRouteName))
        .map((r) => ({ value: r.cableRouteName, label: r.cableRouteName, group: "" })),
    [routes]
  );

  // Danh sách tuyến thực sự đưa vào Tròn/Cột/Bảng = lọc theo routeFilter —
  // ĐÂY LÀ dữ liệu áp cho mọi phần bên dưới, không còn giữ "overall" cố định
  // toàn trạm nữa (yêu cầu người dùng: giá trị trên biểu đồ/thẻ phải theo
  // đúng phần đang lọc, không phải ALL dữ liệu).
  const visible = useMemo(() => {
    if (routeFilter === null) return routes;
    const set = new Set(routeFilter);
    return routes.filter((r) => set.has(r.cableRouteName));
  }, [routes, routeFilter]);

  // Sắp xếp DÙNG CHUNG cho cả biểu đồ Cột và Bảng (yêu cầu người dùng
  // 2026-08-09: "thêm sắp xếp cho biểu đồ Cột tương tự như Bảng") — 1
  // dropdown, áp cho cả 2 nơi, không phải 2 nguồn sắp xếp riêng dễ lệch nhau.
  const sorted = useMemo(() => {
    const list = [...visible];
    if (sortBy === "name") list.sort((a, b) => a.cableRouteName.localeCompare(b.cableRouteName));
    if (sortBy === "percentInUse") list.sort((a, b) => pct(b.inUse, b.total) - pct(a.inUse, a.total));
    if (sortBy === "total") list.sort((a, b) => b.total - a.total);
    return list;
  }, [visible, sortBy]);

  const filteredStat = useMemo(() => sumRoutes(visible), [visible]);
  const pieData = [
    { name: "Đang dùng", value: filteredStat.inUse, color: COLORS.inUse },
    { name: "Dự phòng", value: filteredStat.standby, color: COLORS.standby },
    { name: "Trống", value: filteredStat.empty, color: COLORS.empty },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <GroupedMultiSelect items={routeItems} selected={routeFilter} onChange={setRouteFilter} buttonLabel="Chọn tuyến hiển thị" />
        <select className="input w-auto" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="name">Sắp theo: Tên tuyến</option>
          <option value="percentInUse">Sắp theo: % Đang dùng (giảm dần)</option>
          <option value="total">Sắp theo: Tổng port (giảm dần)</option>
        </select>
        <p className="text-xs text-slate-400">Áp dụng cho cả biểu đồ Tròn/Cột và Bảng bên dưới.</p>
      </div>

      {/* Chỉ còn 1 thẻ (yêu cầu người dùng 2026-08-09: bỏ 3 thẻ Đang dùng/Dự
          phòng/Trống — đã có đủ trong biểu đồ Tròn) — giá trị theo ĐÚNG tuyến
          đang lọc ở trên, không còn fix cứng toàn trạm. */}
      <div className="mb-6 max-w-xs">
        <StatTile label="Tổng số port (theo tuyến đang chọn)" value={String(filteredStat.total)} color="text-slate-700" />
      </div>

      {/* Tròn bên trái, Cột bên phải khi đủ bề ngang (desktop); dưới ngưỡng
          `lg` thì xếp chồng dọc theo ĐÚNG thứ tự trong DOM: Tròn -> Cột ->
          Bảng (yêu cầu người dùng 2026-08-09). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <PieView data={pieData} />
        <ColumnView routes={sorted} />
      </div>

      <TableView routes={sorted} />
    </div>
  );
}

function StatTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function StackedBar({ r }: { r: RouteStat }) {
  if (r.total === 0) return null;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div style={{ width: `${pct(r.inUse, r.total)}%`, backgroundColor: COLORS.inUse }} />
      <div style={{ width: `${pct(r.standby, r.total)}%`, backgroundColor: COLORS.standby }} />
      <div style={{ width: `${pct(r.empty, r.total)}%`, backgroundColor: COLORS.empty }} />
    </div>
  );
}

// Cột "Tuyến cáp" luôn hiện — 4 cột số liệu ẩn/hiện được (quy định chung mọi
// bảng, xem architecture.md). Thứ tự sắp xếp DÒNG dùng chung dropdown ở
// khung cha (không thêm sắp xếp theo cột riêng ở đây để tránh 2 nguồn sắp
// xếp xung đột nhau) — header ở đây chỉ có lọc + kéo dãn qua DataTh (sortKey
// để trống). Bộ lọc theo từng cột (StatFilterKey) là RIÊNG của Bảng — Cột/
// Tròn không cần vì đã lọc tuyến ở "Chọn tuyến hiển thị" chung phía trên
// (yêu cầu người dùng 2026-08-09).
type VisibleCol = "total" | "inUse" | "standby" | "empty" | "ratio";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = { total: true, inUse: true, standby: true, empty: true, ratio: true };
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "total", label: "Tổng port" },
  { key: "inUse", label: "Đang dùng" },
  { key: "standby", label: "Dự phòng" },
  { key: "empty", label: "Trống" },
  { key: "ratio", label: "Tỷ lệ" },
];
type ResizableCol = "route";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { route: 220 };

// Kéo-thả TOÀN BỘ cột, kể cả "Tuyến cáp" trước giờ cố định đầu bảng (yêu cầu
// người dùng 2026-08-08, đồng bộ từ PortTable.tsx — xem architecture.md Mục
// 84).
type StructuralCol = "route";
type AllCol = StructuralCol | VisibleCol;
const DEFAULT_ALL_ORDER: AllCol[] = ["route", ...COLUMN_ITEMS.map((c) => c.key)];
const STRUCTURAL_COLUMNS = new Set<AllCol>(["route"]);
const OPTIONAL_COL_SET = new Set<AllCol>(COLUMN_ITEMS.map((c) => c.key));

function TableView({ routes }: { routes: RouteStat[] }) {
  const [filters, setFilters] = useState<Record<StatFilterKey, string>>({
    route: "",
    total: "",
    inUse: "",
    standby: "",
    empty: "",
  });
  function setFilter(key: StatFilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
  const filtered = useMemo(() => routes.filter((r) => matchesStatFilters(r, filters)), [routes, filters]);
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("dashboard-table-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("dashboard-table-col-visibility", DEFAULT_VISIBLE);
  // "-v2" (yêu cầu người dùng 2026-08-08, cùng lý do đã đổi ở PortTable.tsx).
  const {
    order: colOrder,
    moveColumn,
    reset: resetColOrder,
  } = useColumnOrder<AllCol>("dashboard-table-col-order-v2", DEFAULT_ALL_ORDER);
  const orderedAll = colOrder.filter((col) => STRUCTURAL_COLUMNS.has(col) || visible[col as VisibleCol]);

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (r: RouteStat) => string | number | null }[] = [{ label: "Tuyến cáp", getValue: (r) => r.cableRouteName }];
    if (visible.total) cols.push({ label: "Tổng port", getValue: (r) => r.total });
    if (visible.inUse) cols.push({ label: "Đang dùng", getValue: (r) => r.inUse });
    if (visible.standby) cols.push({ label: "Dự phòng", getValue: (r) => r.standby });
    if (visible.empty) cols.push({ label: "Trống", getValue: (r) => r.empty });
    return cols;
  }, [visible]);

  const visibleColCount = 1 + COLUMN_ITEMS.filter((c) => visible[c.key]).length;

  const COL_WIDTH: Record<VisibleCol, number> = { total: 110, inUse: 130, standby: 130, empty: 110, ratio: 192 };
  function colWidthOf(col: AllCol): number {
    return col === "route" ? colWidths.route : COL_WIDTH[col];
  }

  function renderHeaderCell(col: AllCol) {
    const reorderProps = { reorderKey: col, onReorderColumn: moveColumn } as const;
    switch (col) {
      case "route":
        return (
          <DataTh
            key={col}
            label="Tuyến cáp"
            width={colWidths.route}
            onResize={(w) => resizeCol("route", w)}
            filterValue={filters.route}
            onFilterChange={(v) => setFilter("route", v)}
            {...reorderProps}
          />
        );
      case "total":
        return (
          <DataTh key={col} label="Tổng port" align="right" filterValue={filters.total} onFilterChange={(v) => setFilter("total", v)} {...reorderProps} />
        );
      case "inUse":
        return (
          <DataTh
            key={col}
            label="Đang dùng"
            align="right"
            filterValue={filters.inUse}
            onFilterChange={(v) => setFilter("inUse", v)}
            {...reorderProps}
          />
        );
      case "standby":
        return (
          <DataTh
            key={col}
            label="Dự phòng"
            align="right"
            filterValue={filters.standby}
            onFilterChange={(v) => setFilter("standby", v)}
            {...reorderProps}
          />
        );
      case "empty":
        return (
          <DataTh key={col} label="Trống" align="right" filterValue={filters.empty} onFilterChange={(v) => setFilter("empty", v)} {...reorderProps} />
        );
      case "ratio":
        // Không sort/lọc (chỉ hiện thanh biểu đồ) — vẫn qua DataTh để kéo-thả
        // được như các cột khác.
        return <DataTh key={col} label="Tỷ lệ" {...reorderProps} />;
    }
  }

  function renderCell(col: AllCol, r: RouteStat) {
    switch (col) {
      case "route":
        return (
          <td key={col} className="px-3 py-2 text-slate-700 break-words">
            {r.cableRouteName}
          </td>
        );
      case "total":
        return (
          <td key={col} className="px-3 py-2 text-right text-slate-600">
            {r.total}
          </td>
        );
      case "inUse":
        return (
          <td key={col} className="px-3 py-2 text-right text-emerald-600">
            {r.inUse} ({pct(r.inUse, r.total)}%)
          </td>
        );
      case "standby":
        return (
          <td key={col} className="px-3 py-2 text-right text-amber-600">
            {r.standby} ({pct(r.standby, r.total)}%)
          </td>
        );
      case "empty":
        return (
          <td key={col} className="px-3 py-2 text-right text-slate-500">
            {r.empty} ({pct(r.empty, r.total)}%)
          </td>
        );
      case "ratio":
        return (
          <td key={col} className="px-3 py-2">
            <StackedBar r={r} />
          </td>
        );
    }
  }

  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Thống kê theo tuyến" fileNamePrefix="Thong_ke_theo_tuyen" />
        <ColumnPicker
          items={COLUMN_ITEMS}
          order={colOrder.filter((col): col is VisibleCol => OPTIONAL_COL_SET.has(col))}
          visible={visible}
          onToggle={toggleColumn}
          onReorderColumn={moveColumn as (dragged: VisibleCol, target: VisibleCol) => void}
          onResetOrder={resetColOrder}
        />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {orderedAll.map((col) => (
              <col key={col} style={{ width: colWidthOf(col) }} />
            ))}
          </colgroup>
          <thead className="text-primary-800">
            <tr>{orderedAll.map((col) => renderHeaderCell(col))}</tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.cableRouteName} className="border-t border-slate-100 hover:bg-primary-50/50">
                {orderedAll.map((col) => renderCell(col, r))}
              </tr>
            ))}
            {routes.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-6 text-center text-slate-400">
                  Không có tuyến nào được chọn hiển thị.
                </td>
              </tr>
            )}
            {routes.length > 0 && filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy tuyến nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ColumnView({ routes }: { routes: RouteStat[] }) {
  if (routes.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-400">
        Không có tuyến nào khớp (kiểm tra lại lựa chọn tuyến phía trên).
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={routes} margin={{ top: 10, right: 20, left: 0, bottom: 90 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="cableRouteName" angle={-40} textAnchor="end" interval={0} height={110} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="inUse" name="Đang dùng" stackId="a" fill={COLORS.inUse} />
          <Bar dataKey="standby" name="Dự phòng" stackId="a" fill={COLORS.standby} />
          <Bar dataKey="empty" name="Trống" stackId="a" fill={COLORS.empty} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieView({ data }: { data: { name: string; value: number; color: string }[] }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500 mb-2">Tỷ lệ tổng theo các tuyến đang được chọn ở trên</p>
      <ResponsiveContainer width="100%" height={380}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={130} label={(d) => `${d.name}: ${d.value}`}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
