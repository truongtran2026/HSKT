"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import { useSort, type SortDir } from "@/lib/useSort";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import { IconSortName, IconSortTotal, IconSortPercentUsed, IconSortPercentEmpty } from "@/components/ui/icons";
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

// Bật/tắt từng phần Đang dùng/Dự phòng/Trống trên biểu đồ Tròn VÀ Cột (yêu
// cầu người dùng 2026-08-09: "bấm vào legend... bấm vào phần hiển thị của
// biểu đồ cũng có thể ẩn/hiện"). Mỗi biểu đồ giữ trạng thái ẩn RIÊNG (2 biểu
// đồ độc lập, không dùng chung 1 state — ẩn "Trống" ở Tròn không ảnh hưởng
// Cột). `hidden` là tập các key đang ẨN.
type StatKey = "inUse" | "standby" | "empty";
const STAT_KEYS: StatKey[] = ["inUse", "standby", "empty"];
const STAT_LABELS: Record<StatKey, string> = { inUse: "Đang dùng", standby: "Dự phòng", empty: "Trống" };

function useHiddenStat() {
  const [hidden, setHidden] = useState<Set<StatKey>>(new Set());
  function toggle(k: StatKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  return { hidden, toggle };
}

// Legend cố định 3 mục (KHÔNG để Recharts tự suy ra từ data/Bar đang render)
// — vì <Bar hide> hoặc lọc bớt `data` của Pie sẽ làm mục đó biến mất khỏi
// legend tự sinh, người dùng sẽ không còn cách nào bấm lại để HIỆN lại phần
// đã ẩn. `payload` tự truyền tay đảm bảo cả 3 mục luôn có mặt để bấm.
function buildLegendPayload(hidden: Set<StatKey>) {
  return STAT_KEYS.map((k) => ({
    value: STAT_LABELS[k],
    id: k,
    dataKey: k,
    type: "square" as const,
    color: hidden.has(k) ? "#cbd5e1" : COLORS[k],
  }));
}

function legendFormatter(hidden: Set<StatKey>) {
  return (value: string, entry: { dataKey?: string | number | ((obj: unknown) => unknown) }) => {
    const k = entry.dataKey as StatKey;
    return (
      <span
        style={{
          textDecoration: hidden.has(k) ? "line-through" : "none",
          color: hidden.has(k) ? "#94a3b8" : undefined,
          cursor: "pointer",
        }}
      >
        {value}
      </span>
    );
  };
}

export default function DashboardClient({ routes }: { routes: RouteStat[] }) {
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
  // "chọn tuyến hiển thị" y hệt lỗi ĐÃ FIX ở /odf-trunk — bấm ra ngoài phải
  // tự đóng, "Chọn tất cả" sau khi gõ tìm chỉ chọn đúng phần đang lọc,
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
  // KHÔNG sắp xếp ở đây nữa (Bảng và Cột giờ tự sắp xếp riêng, xem
  // TableView/ColumnView bên dưới) — ĐÂY LÀ dữ liệu áp cho mọi phần bên
  // dưới, không còn giữ "overall" cố định toàn trạm nữa (yêu cầu người dùng:
  // giá trị trên biểu đồ/thẻ phải theo đúng phần đang lọc, không phải ALL
  // dữ liệu).
  const visible = useMemo(() => {
    if (routeFilter === null) return routes;
    const set = new Set(routeFilter);
    return routes.filter((r) => set.has(r.cableRouteName));
  }, [routes, routeFilter]);

  const filteredStat = useMemo(() => sumRoutes(visible), [visible]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <GroupedMultiSelect items={routeItems} selected={routeFilter} onChange={setRouteFilter} buttonLabel="Chọn tuyến hiển thị" />
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
        <PieView stat={filteredStat} />
        <ColumnView routes={visible} />
      </div>

      <TableView routes={visible} />
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
// bảng, xem architecture.md). Sắp xếp DÒNG qua bấm CHỮ TIÊU ĐỀ cột (quy định
// chung mọi bảng dữ liệu — xem architecture.md Mục 88), KHÔNG còn dùng
// dropdown "Sắp theo" rời như trước. Bộ lọc theo từng cột (StatFilterKey) là
// RIÊNG của Bảng — Cột/Tròn không cần vì đã lọc tuyến ở "Chọn tuyến hiển
// thị" chung phía trên (yêu cầu người dùng 2026-08-09).
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

// "ratio" (cột Tỷ lệ, chỉ vẽ thanh biểu đồ) không có giá trị riêng để sắp —
// SortKey vì vậy KHÔNG gồm "ratio", khác `AllCol` (giống PortTable.tsx: cột
// không sort được thì tách khỏi SortKey thay vì ép kiểu).
type SortKey = "route" | "total" | "inUse" | "standby" | "empty";

function compareByKey(key: SortKey, a: RouteStat, b: RouteStat): number {
  switch (key) {
    case "route":
      return a.cableRouteName.localeCompare(b.cableRouteName);
    case "total":
      return a.total - b.total;
    case "inUse":
      return a.inUse - b.inUse;
    case "standby":
      return a.standby - b.standby;
    case "empty":
      return a.empty - b.empty;
  }
}

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
  // Mặc định "Tuyến cáp" tăng dần (yêu cầu người dùng 2026-08-09: "mặc định
  // theo tên tuyến"), bấm lại chữ tiêu đề để đảo chiều — đúng quy định chung
  // mọi bảng (architecture.md Mục 88), dùng `lib/useSort.ts` y hệt các bảng
  // khác trong app thay vì dropdown rời.
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("route");
  const filtered = useMemo(() => routes.filter((r) => matchesStatFilters(r, filters)), [routes, filters]);
  const sorted = useMemo(() => {
    const list = [...filtered].sort((a, b) => compareByKey(sortKey, a, b));
    if (sortDir === "desc") list.reverse();
    return list;
  }, [filtered, sortKey, sortDir]);
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
    // Ép kiểu sang AllCol (giống PortTable.tsx: cột "ratio" không có trong
    // SortKey) — an toàn vì "ratio" luôn truyền `sortKey={undefined}` riêng
    // (case bên dưới), không bao giờ thực sự gọi onSort với "ratio".
    const sortProps = { activeSortKey: sortKey as AllCol, sortDir, onSort: toggleSort as (k: AllCol) => void };
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
            sortKey="route"
            {...sortProps}
            {...reorderProps}
          />
        );
      case "total":
        return (
          <DataTh
            key={col}
            label="Tổng port"
            align="right"
            filterValue={filters.total}
            onFilterChange={(v) => setFilter("total", v)}
            sortKey="total"
            {...sortProps}
            {...reorderProps}
          />
        );
      case "inUse":
        return (
          <DataTh
            key={col}
            label="Đang dùng"
            align="right"
            filterValue={filters.inUse}
            onFilterChange={(v) => setFilter("inUse", v)}
            sortKey="inUse"
            {...sortProps}
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
            sortKey="standby"
            {...sortProps}
            {...reorderProps}
          />
        );
      case "empty":
        return (
          <DataTh
            key={col}
            label="Trống"
            align="right"
            filterValue={filters.empty}
            onFilterChange={(v) => setFilter("empty", v)}
            sortKey="empty"
            {...sortProps}
            {...reorderProps}
          />
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
        <ExportExcelButton columns={exportColumns} rows={sorted} sheetName="Thống kê theo tuyến" fileNamePrefix="Thong_ke_theo_tuyen" />
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
            {sorted.map((r) => (
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
            {routes.length > 0 && sorted.length === 0 && (
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

// Sắp xếp RIÊNG cho biểu đồ Cột (yêu cầu người dùng 2026-08-09: "thêm sắp
// xếp cho biểu đồ Cột... dùng icon không dùng chữ") — 4 tiêu chí (tên/tổng
// sợi-port/% đang dùng/% trống), mỗi tiêu chí có chiều tăng/giảm riêng: bấm
// icon đang chọn để đảo chiều, bấm icon khác để chuyển tiêu chí (về chiều
// mặc định hợp lý — % thường xem giảm dần trước = "nhiều nhất trước").
type ColSortKey = "name" | "total" | "percentInUse" | "percentEmpty";
const COL_SORT_DEFAULT_DIR: Record<ColSortKey, SortDir> = {
  name: "asc",
  total: "desc",
  percentInUse: "desc",
  percentEmpty: "desc",
};

function ColSortButton({
  active,
  dir,
  label,
  onClick,
  tint,
  children,
}: {
  active: boolean;
  dir: SortDir;
  label: string;
  onClick: () => void;
  tint?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Sắp xếp theo ${label}${active ? ` — đang ${dir === "asc" ? "tăng dần" : "giảm dần"}, bấm lại để đảo chiều` : ""}`}
      aria-label={`Sắp xếp theo ${label}`}
      className={`relative rounded-md border p-1.5 ${
        active ? "border-primary-400 bg-primary-100 text-primary-700" : `border-slate-200 bg-white hover:bg-slate-50 ${tint ?? "text-slate-500"}`
      }`}
    >
      {children}
      {active && (
        <span className="absolute -right-1.5 -top-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary-600 text-[9px] leading-none text-white">
          {dir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </button>
  );
}

function ColumnView({ routes }: { routes: RouteStat[] }) {
  const { hidden, toggle } = useHiddenStat();
  const [colSortKey, setColSortKey] = useState<ColSortKey>("name");
  const [colSortDir, setColSortDir] = useState<SortDir>("asc");

  function toggleColSort(key: ColSortKey) {
    if (key === colSortKey) {
      setColSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setColSortKey(key);
      setColSortDir(COL_SORT_DEFAULT_DIR[key]);
    }
  }

  const sorted = useMemo(() => {
    const list = [...routes];
    const dir = colSortDir === "asc" ? 1 : -1;
    switch (colSortKey) {
      case "name":
        list.sort((a, b) => dir * a.cableRouteName.localeCompare(b.cableRouteName));
        break;
      case "total":
        list.sort((a, b) => dir * (a.total - b.total));
        break;
      case "percentInUse":
        list.sort((a, b) => dir * (pct(a.inUse, a.total) - pct(b.inUse, b.total)));
        break;
      case "percentEmpty":
        list.sort((a, b) => dir * (pct(a.empty, a.total) - pct(b.empty, b.total)));
        break;
    }
    return list;
  }, [routes, colSortKey, colSortDir]);

  if (routes.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-400">
        Không có tuyến nào khớp (kiểm tra lại lựa chọn tuyến phía trên).
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      {/* 4 icon sắp xếp NẰM TRONG khung biểu đồ này (yêu cầu người dùng
          2026-08-09) — không dùng chữ, tooltip (title) giải thích khi hover. */}
      <div className="mb-2 flex items-center justify-end gap-1.5">
        <ColSortButton active={colSortKey === "name"} dir={colSortDir} label="Tên tuyến" onClick={() => toggleColSort("name")}>
          <IconSortName />
        </ColSortButton>
        <ColSortButton active={colSortKey === "total"} dir={colSortDir} label="Tổng sợi/port" onClick={() => toggleColSort("total")}>
          <IconSortTotal />
        </ColSortButton>
        <ColSortButton
          active={colSortKey === "percentInUse"}
          dir={colSortDir}
          label="% Đang dùng"
          onClick={() => toggleColSort("percentInUse")}
          tint="text-emerald-600"
        >
          <IconSortPercentUsed />
        </ColSortButton>
        <ColSortButton
          active={colSortKey === "percentEmpty"}
          dir={colSortDir}
          label="% Trống"
          onClick={() => toggleColSort("percentEmpty")}
          tint="text-slate-500"
        >
          <IconSortPercentEmpty />
        </ColSortButton>
      </div>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={sorted} margin={{ top: 10, right: 20, left: 0, bottom: 90 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="cableRouteName" angle={-40} textAnchor="end" interval={0} height={110} tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          {/* Bấm vào chữ chú thích HOẶC bấm thẳng vào cột màu đều ẩn/hiện
              được phần đó (yêu cầu người dùng 2026-08-09) — legend dùng
              payload cố định (xem buildLegendPayload) để mục ẨN không biến
              mất khỏi legend, vẫn bấm lại để hiện được. */}
          <Legend payload={buildLegendPayload(hidden)} onClick={(e) => toggle(e.dataKey as StatKey)} formatter={legendFormatter(hidden)} />
          <Bar dataKey="inUse" name="Đang dùng" stackId="a" fill={COLORS.inUse} hide={hidden.has("inUse")} cursor="pointer" onClick={() => toggle("inUse")} />
          <Bar
            dataKey="standby"
            name="Dự phòng"
            stackId="a"
            fill={COLORS.standby}
            hide={hidden.has("standby")}
            cursor="pointer"
            onClick={() => toggle("standby")}
          />
          <Bar dataKey="empty" name="Trống" stackId="a" fill={COLORS.empty} hide={hidden.has("empty")} cursor="pointer" onClick={() => toggle("empty")} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieView({ stat }: { stat: { inUse: number; standby: number; empty: number } }) {
  const { hidden, toggle } = useHiddenStat();
  const allData = STAT_KEYS.map((k) => ({ key: k, name: STAT_LABELS[k], value: stat[k], color: COLORS[k] }));
  const data = allData.filter((d) => !hidden.has(d.key));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500 mb-2">
        Tỷ lệ tổng theo các tuyến đang được chọn ở trên — bấm vào lát cắt hoặc chú thích để ẩn/hiện từng phần.
      </p>
      <ResponsiveContainer width="100%" height={380}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={130} label={(d) => `${d.name}: ${d.value}`}>
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} cursor="pointer" onClick={() => toggle(d.key)} />
            ))}
          </Pie>
          <Tooltip />
          <Legend payload={buildLegendPayload(hidden)} onClick={(e) => toggle(e.dataKey as StatKey)} formatter={legendFormatter(hidden)} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
