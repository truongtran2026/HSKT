"use client";

import { useEffect, useMemo, useState } from "react";
import { normalizeVN } from "@/lib/text";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import FilterInput from "@/components/ui/FilterInput";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
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

export interface OverallStat {
  total: number;
  inUse: number;
  standby: number;
  empty: number;
}

type ViewMode = "table" | "card" | "column" | "pie";
type SortBy = "name" | "percentInUse" | "total";

const COLORS = { inUse: "#10b981", standby: "#f59e0b", empty: "#94a3b8" };
const VIEW_STORAGE_KEY = "dashboard-view-mode";
const ROUTE_FILTER_KEY_PREFIX = "dashboard-route-filter-";

function loadViewMode(): ViewMode {
  if (typeof window === "undefined") return "table";
  const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
  return saved === "table" || saved === "card" || saved === "column" || saved === "pie" ? saved : "table";
}

// null = chưa lọc gì (mặc định hiện tất cả tuyến). Mảng (kể cả rỗng) = danh
// sách tuyến người dùng đã chọn riêng cho kiểu biểu đồ này — mỗi kiểu (Bảng/
// Thẻ/Cột/Tròn) lưu 1 bộ lọc ĐỘC LẬP theo đúng yêu cầu (vd Bảng chỉ hiện
// tuyến A,B trong khi Thẻ hiện tuyến B,C,D).
function loadRouteFilter(view: ViewMode): string[] | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(ROUTE_FILTER_KEY_PREFIX + view);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveRouteFilter(view: ViewMode, list: string[] | null) {
  if (list === null) window.localStorage.removeItem(ROUTE_FILTER_KEY_PREFIX + view);
  else window.localStorage.setItem(ROUTE_FILTER_KEY_PREFIX + view, JSON.stringify(list));
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

function sumRoutes(routes: RouteStat[]): OverallStat {
  const sum = { total: 0, inUse: 0, standby: 0, empty: 0 };
  for (const r of routes) {
    sum.total += r.total;
    sum.inUse += r.inUse;
    sum.standby += r.standby;
    sum.empty += r.empty;
  }
  return sum;
}

export default function DashboardClient({ routes, overall }: { routes: RouteStat[]; overall: OverallStat }) {
  const [view, setView] = useState<ViewMode>("table");
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [routeFilter, setRouteFilter] = useState<string[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState(""); // chỉ để tìm nhanh trong danh sách tick, không ảnh hưởng lựa chọn
  // Bộ lọc theo số liệu (Tuyến cáp/Tổng port/Đang dùng/Dự phòng/Trống) — DÙNG
  // CHUNG cho cả 4 kiểu hiển thị (Bảng/Thẻ/Cột/Tròn), khác với "Chọn tuyến
  // hiển thị" (routeFilter) là bộ lọc RIÊNG từng kiểu và được lưu lại. Bộ lọc
  // này chỉ là tìm nhanh tạm thời, không lưu, giữ nguyên khi đổi qua lại giữa
  // các kiểu xem để không mất công gõ lại.
  const [statFilters, setStatFilters] = useState<Record<StatFilterKey, string>>({
    route: "",
    total: "",
    inUse: "",
    standby: "",
    empty: "",
  });

  function setStatFilter(key: StatFilterKey, value: string) {
    setStatFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Đọc cấu hình đã lưu SAU khi mount (tránh lệch giữa SSR và client).
  useEffect(() => {
    setView(loadViewMode());
  }, []);

  // Mỗi lần đổi kiểu biểu đồ, nạp lại bộ lọc tuyến RIÊNG của kiểu đó.
  useEffect(() => {
    setRouteFilter(loadRouteFilter(view));
    setPickerOpen(false);
    setPickerQuery("");
  }, [view]);

  function changeView(v: ViewMode) {
    setView(v);
    window.localStorage.setItem(VIEW_STORAGE_KEY, v);
  }

  const allRouteNames = useMemo(() => routes.map((r) => r.cableRouteName), [routes]);

  function toggleRoute(name: string) {
    setRouteFilter((prev) => {
      const base = prev ?? allRouteNames;
      const next = base.includes(name) ? base.filter((n) => n !== name) : [...base, name];
      saveRouteFilter(view, next);
      return next;
    });
  }

  const sorted = useMemo(() => {
    const list = [...routes];
    if (sortBy === "name") list.sort((a, b) => a.cableRouteName.localeCompare(b.cableRouteName));
    if (sortBy === "percentInUse") list.sort((a, b) => pct(b.inUse, b.total) - pct(a.inUse, a.total));
    if (sortBy === "total") list.sort((a, b) => b.total - a.total);
    return list;
  }, [routes, sortBy]);

  // Danh sách hiện trong khung tick — dùng để TÌM NHANH cho dễ bấm, và cũng
  // là phạm vi mà "Chọn tất cả"/"Bỏ chọn tất cả" tác động khi đang gõ tìm
  // (xem 2 hàm bên dưới) — KHÔNG tự ý đụng routeFilter khi chỉ gõ tìm.
  const pickerVisible = useMemo(() => {
    const q = normalizeVN(pickerQuery.trim());
    if (!q) return sorted;
    return sorted.filter((r) => normalizeVN(r.cableRouteName).includes(q));
  }, [sorted, pickerQuery]);

  // "Chọn tất cả"/"Bỏ chọn tất cả": nếu KHÔNG đang tìm trong khung tick ->
  // áp dụng cho TOÀN BỘ tuyến như trước. Nếu ĐANG tìm (đã gõ ô tìm) -> chỉ
  // tác động tới các tuyến đang hiện ra khớp tìm kiếm, giữ nguyên lựa chọn
  // của các tuyến khác không hiện ra — đúng yêu cầu người dùng.
  function selectAllRoutes() {
    if (pickerQuery.trim() === "") {
      setRouteFilter(null);
      saveRouteFilter(view, null);
      return;
    }
    setRouteFilter((prev) => {
      const base = prev ?? allRouteNames;
      const visibleNames = pickerVisible.map((r) => r.cableRouteName);
      const next = Array.from(new Set([...base, ...visibleNames]));
      saveRouteFilter(view, next);
      return next;
    });
  }

  function selectNoRoutes() {
    if (pickerQuery.trim() === "") {
      setRouteFilter([]);
      saveRouteFilter(view, []);
      return;
    }
    setRouteFilter((prev) => {
      const base = prev ?? allRouteNames;
      const visibleNames = new Set(pickerVisible.map((r) => r.cableRouteName));
      const next = base.filter((n) => !visibleNames.has(n));
      saveRouteFilter(view, next);
      return next;
    });
  }

  // Danh sách tuyến thực sự hiển thị = đã sắp xếp + lọc theo cấu hình riêng
  // của kiểu biểu đồ đang chọn.
  const visible = useMemo(() => {
    if (routeFilter === null) return sorted;
    const set = new Set(routeFilter);
    return sorted.filter((r) => set.has(r.cableRouteName));
  }, [sorted, routeFilter]);

  const selectedCount = routeFilter === null ? routes.length : routeFilter.length;

  // Áp thêm bộ lọc số liệu (statFilters) lên trên danh sách đã chọn tuyến —
  // đây là dữ liệu THẬT SỰ đưa vào cả 4 kiểu hiển thị.
  const filteredVisible = useMemo(() => visible.filter((r) => matchesStatFilters(r, statFilters)), [visible, statFilters]);

  // Biểu đồ Tròn hiện tổng theo ĐÚNG các tuyến đang được chọn + đang lọc
  // (không cố định "overall" nữa) — để bộ lọc cũng áp dụng được cho kiểu Tròn.
  const pieSource = view === "pie" ? sumRoutes(filteredVisible) : overall;
  const pieData = [
    { name: "Đang dùng", value: pieSource.inUse, color: COLORS.inUse },
    { name: "Dự phòng", value: pieSource.standby, color: COLORS.standby },
    { name: "Trống", value: pieSource.empty, color: COLORS.empty },
  ];

  return (
    <div>
      {/* Tổng quan toàn trạm — luôn tính trên TOÀN BỘ dữ liệu, không bị ảnh
          hưởng bởi bộ lọc tuyến riêng của từng kiểu biểu đồ bên dưới. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-6">
        <StatTile label="Tổng số port" value={String(overall.total)} color="text-slate-700" />
        <StatTile label="Đang dùng" value={`${overall.inUse} (${pct(overall.inUse, overall.total)}%)`} color="text-emerald-600" />
        <StatTile label="Dự phòng" value={`${overall.standby} (${pct(overall.standby, overall.total)}%)`} color="text-amber-600" />
        <StatTile label="Trống" value={`${overall.empty} (${pct(overall.empty, overall.total)}%)`} color="text-slate-500" />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex gap-1">
          {(
            [
              ["table", "Bảng"],
              ["card", "Thẻ"],
              ["column", "Cột"],
              ["pie", "Tròn"],
            ] as [ViewMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => changeView(m)}
              className={
                "rounded-md px-3 py-1.5 text-sm border " +
                (view === m
                  ? "bg-primary-600 text-white border-primary-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>

        {(view === "table" || view === "card") && (
          <select className="input w-auto" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
            <option value="name">Sắp theo: Tên tuyến</option>
            <option value="percentInUse">Sắp theo: % Đang dùng (giảm dần)</option>
            <option value="total">Sắp theo: Tổng port (giảm dần)</option>
          </select>
        )}

        <div className="relative">
          <button className="btn-secondary" onClick={() => setPickerOpen((v) => !v)}>
            Chọn tuyến hiển thị ({selectedCount}/{routes.length})
          </button>
          {pickerOpen && (
            <div className="absolute z-10 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
              {/* Header tách riêng khỏi vùng cuộn bên dưới — luôn thấy được nút
                  "Đóng"/"Chọn tất cả" dù đã cuộn xuống cuối danh sách tuyến. */}
              <div className="flex justify-between border-b border-slate-100 px-3 py-2 text-xs">
                <button className="text-primary-600 hover:underline" onClick={selectAllRoutes}>
                  Chọn tất cả
                </button>
                <button className="text-primary-600 hover:underline" onClick={selectNoRoutes}>
                  Bỏ chọn tất cả
                </button>
                <button className="text-slate-500 hover:underline" onClick={() => setPickerOpen(false)}>
                  Đóng
                </button>
              </div>
              <div className="border-b border-slate-100 p-2">
                <FilterInput value={pickerQuery} onChange={setPickerQuery} />
              </div>
              <div className="max-h-64 overflow-y-auto p-3">
                {pickerVisible.map((r) => {
                  const checked = routeFilter === null || routeFilter.includes(r.cableRouteName);
                  return (
                    <label key={r.cableRouteName} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                      <input type="checkbox" checked={checked} onChange={() => toggleRoute(r.cableRouteName)} />
                      <span className="truncate" title={r.cableRouteName}>
                        {r.cableRouteName}
                      </span>
                    </label>
                  );
                })}
                {pickerVisible.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Không khớp tuyến nào.</p>}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Bộ lọc tuyến được lưu riêng cho từng kiểu biểu đồ (Bảng/Thẻ/Cột/Tròn có thể hiện các tuyến khác nhau).
      </p>

      {/* Bảng có dòng lọc riêng ngay dưới tiêu đề cột (quen thuộc kiểu bảng
          dữ liệu); Thẻ/Cột/Tròn không có cột nên dùng chung 1 thanh lọc gọn
          phía trên — cùng chia sẻ statFilters nên gõ 1 lần dùng được cả 4 kiểu. */}
      {view !== "table" && (
        <StatFilterBar filters={statFilters} onChange={setStatFilter} className="mb-3" />
      )}

      {view === "table" && <TableView routes={visible} filters={statFilters} onFilterChange={setStatFilter} />}
      {view === "card" && <CardView routes={filteredVisible} />}
      {view === "column" && <ColumnView routes={filteredVisible} />}
      {view === "pie" && <PieView data={pieData} />}
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

function StatFilterBar({
  filters,
  onChange,
  className = "",
}: {
  filters: Record<StatFilterKey, string>;
  onChange: (key: StatFilterKey, value: string) => void;
  className?: string;
}) {
  const fields: [StatFilterKey, string][] = [
    ["route", "Tuyến cáp"],
    ["total", "Tổng port"],
    ["inUse", "Đang dùng"],
    ["standby", "Dự phòng"],
    ["empty", "Trống"],
  ];
  return (
    <div className={`flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 ${className}`}>
      {fields.map(([key, label]) => (
        <label key={key} className="text-xs text-slate-500">
          <span className="block mb-1">{label}</span>
          <FilterInput value={filters[key]} onChange={(v) => onChange(key, v)} />
        </label>
      ))}
    </div>
  );
}

// Cột "Tuyến cáp" luôn hiện — 4 cột số liệu ẩn/hiện được (quy định chung mọi
// bảng, xem architecture.md). Thứ tự sắp xếp bảng này dùng CHUNG với card/
// column/pie qua dropdown "sortBy" ở khung cha (không thêm sắp xếp theo cột
// riêng ở đây để tránh 2 nguồn sắp xếp xung đột nhau) — header ở đây chỉ có
// lọc + kéo dãn qua DataTh (sortKey để trống).
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

function TableView({
  routes,
  filters,
  onFilterChange,
}: {
  routes: RouteStat[];
  filters: Record<StatFilterKey, string>;
  onFilterChange: (key: StatFilterKey, value: string) => void;
}) {
  const filtered = useMemo(() => routes.filter((r) => matchesStatFilters(r, filters)), [routes, filters]);
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("dashboard-table-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("dashboard-table-col-visibility", DEFAULT_VISIBLE);
  const {
    order: colOrder,
    moveColumn,
    reset: resetColOrder,
  } = useColumnOrder<VisibleCol>("dashboard-table-col-order", COLUMN_ITEMS.map((c) => c.key));
  const orderedVisible = colOrder.filter((key) => visible[key]);

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

  function renderHeaderCell(key: VisibleCol) {
    const reorderProps = { reorderKey: key, onReorderColumn: moveColumn } as const;
    switch (key) {
      case "total":
        return (
          <DataTh key={key} label="Tổng port" align="right" filterValue={filters.total} onFilterChange={(v) => onFilterChange("total", v)} {...reorderProps} />
        );
      case "inUse":
        return (
          <DataTh
            key={key}
            label="Đang dùng"
            align="right"
            filterValue={filters.inUse}
            onFilterChange={(v) => onFilterChange("inUse", v)}
            {...reorderProps}
          />
        );
      case "standby":
        return (
          <DataTh
            key={key}
            label="Dự phòng"
            align="right"
            filterValue={filters.standby}
            onFilterChange={(v) => onFilterChange("standby", v)}
            {...reorderProps}
          />
        );
      case "empty":
        return (
          <DataTh key={key} label="Trống" align="right" filterValue={filters.empty} onFilterChange={(v) => onFilterChange("empty", v)} {...reorderProps} />
        );
      case "ratio":
        // Không sort/lọc (chỉ hiện thanh biểu đồ) — vẫn qua DataTh để kéo-thả
        // được như các cột khác.
        return <DataTh key={key} label="Tỷ lệ" {...reorderProps} />;
    }
  }

  function renderCell(key: VisibleCol, r: RouteStat) {
    switch (key) {
      case "total":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-600">
            {r.total}
          </td>
        );
      case "inUse":
        return (
          <td key={key} className="px-3 py-2 text-right text-emerald-600">
            {r.inUse} ({pct(r.inUse, r.total)}%)
          </td>
        );
      case "standby":
        return (
          <td key={key} className="px-3 py-2 text-right text-amber-600">
            {r.standby} ({pct(r.standby, r.total)}%)
          </td>
        );
      case "empty":
        return (
          <td key={key} className="px-3 py-2 text-right text-slate-500">
            {r.empty} ({pct(r.empty, r.total)}%)
          </td>
        );
      case "ratio":
        return (
          <td key={key} className="px-3 py-2">
            <StackedBar r={r} />
          </td>
        );
    }
  }

  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Thống kê theo tuyến" fileNamePrefix="Thong_ke_theo_tuyen" />
        <ColumnPicker items={COLUMN_ITEMS} visible={visible} onToggle={toggleColumn} onResetOrder={resetColOrder} />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: colWidths.route }} />
            {orderedVisible.map((key) => (
              <col key={key} style={{ width: COL_WIDTH[key] }} />
            ))}
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <DataTh
                label="Tuyến cáp"
                width={colWidths.route}
                onResize={(w) => resizeCol("route", w)}
                filterValue={filters.route}
                onFilterChange={(v) => onFilterChange("route", v)}
              />
              {orderedVisible.map((key) => renderHeaderCell(key))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.cableRouteName} className="border-t border-slate-100 hover:bg-primary-50/50">
                <td className="px-3 py-2 text-slate-700 break-words">{r.cableRouteName}</td>
                {orderedVisible.map((key) => renderCell(key, r))}
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

function CardView({ routes }: { routes: RouteStat[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {routes.map((r) => (
        <div key={r.cableRouteName} className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="font-medium text-slate-700 truncate" title={r.cableRouteName}>
            {r.cableRouteName}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{r.total} port</div>
          <div className="mt-3">
            <StackedBar r={r} />
          </div>
          <div className="mt-2 flex justify-between text-xs">
            <span className="text-emerald-600">Dùng {pct(r.inUse, r.total)}%</span>
            <span className="text-amber-600">DP {pct(r.standby, r.total)}%</span>
            <span className="text-slate-500">Trống {pct(r.empty, r.total)}%</span>
          </div>
        </div>
      ))}
      {routes.length === 0 && <p className="text-center text-slate-400 col-span-full py-6">Không có tuyến nào khớp (kiểm tra lại lựa chọn tuyến/bộ lọc phía trên).</p>}
    </div>
  );
}

function ColumnView({ routes }: { routes: RouteStat[] }) {
  if (routes.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-400">
        Không có tuyến nào khớp (kiểm tra lại lựa chọn tuyến/bộ lọc phía trên).
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
