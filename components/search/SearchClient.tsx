"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareRackCode } from "@/lib/rackCode";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import RefreshButton from "@/components/ui/RefreshButton";
import EmptyUntilFiltered from "@/components/ui/EmptyUntilFiltered";
import { derivePortStatus, type DerivedPortStatus } from "@/lib/portStatus";
import type { TrunkPortRow } from "@/lib/trunkPorts";

export type SearchRow = TrunkPortRow;

type FilterMode = "all" | "unused" | "standby";
type DerivedStatus = DerivedPortStatus;

function deriveStatus(r: SearchRow): DerivedStatus {
  return derivePortStatus(r.circuit);
}

const STATUS_LABEL: Record<DerivedStatus, string> = {
  empty: "Trống",
  in_use: "Đang dùng",
  standby: "Dự phòng",
};

type SortKey = "rack" | "route" | "port" | "fiber" | "status" | "name" | "counterpart";

function compareByKey(key: SortKey, a: SearchRow, b: SearchRow): number {
  switch (key) {
    case "rack":
      return compareRackCode(a.rackCode, b.rackCode) || a.portNumber - b.portNumber;
    case "route":
      return compareValues(a.cableRouteName, b.cableRouteName);
    case "port":
      return compareValues(a.portNumber, b.portNumber);
    case "fiber":
      return compareValues(a.fiberNumber, b.fiberNumber);
    case "status":
      return compareValues(STATUS_LABEL[deriveStatus(a)], STATUS_LABEL[deriveStatus(b)]);
    case "name":
      return compareValues(a.circuit?.name ?? null, b.circuit?.name ?? null);
    case "counterpart":
      return compareValues(a.circuit?.counterpartText ?? null, b.circuit?.counterpartText ?? null);
  }
}

// Cột lọc riêng theo tự do — không gồm "rack" (đã có dropdown chọn đúng 1
// rack ở trên, chính xác hơn gõ text) và "status" (đã có 3 nút bấm trạng
// thái, cũng chính xác hơn gõ text).
type FreeFilterKey = "route" | "port" | "fiber" | "name" | "counterpart";

function freeCellText(r: SearchRow, key: FreeFilterKey): string | number | null {
  switch (key) {
    case "route":
      return r.cableRouteName;
    case "port":
      return r.portNumber;
    case "fiber":
      return r.fiberNumber;
    case "name":
      return r.circuit?.name ?? null;
    case "counterpart":
      return r.circuit?.counterpartText ?? null;
  }
}

const FREE_FILTER_KEYS: FreeFilterKey[] = ["route", "port", "fiber", "name", "counterpart"];

// Cột dễ dài cần kéo dãn (yêu cầu người dùng 2026-07-27: "các bảng dữ liệu
// đều" kéo dãn được) — Rack/Port/Sợi/Trạng thái ngắn, giữ cố định.
type ResizableCol = "route" | "name" | "counterpart";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { route: 220, name: 220, counterpart: 200 };

// Rack luôn hiện — 6 cột còn lại ẩn/hiện được (quy định chung mọi bảng).
type VisibleCol = "route" | "port" | "fiber" | "status" | "name" | "counterpart";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = {
  route: true,
  port: true,
  fiber: true,
  status: true,
  name: true,
  counterpart: true,
};
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "route", label: "Tuyến cáp" },
  { key: "port", label: "Port" },
  { key: "fiber", label: "Sợi" },
  { key: "status", label: "Trạng thái" },
  { key: "name", label: "Tên luồng" },
  { key: "counterpart", label: "Đối phương" },
];

// Kéo-thả TOÀN BỘ cột, kể cả "Rack" trước giờ cố định đầu bảng (yêu cầu
// người dùng 2026-08-08, đồng bộ từ PortTable.tsx — xem architecture.md Mục
// 84). `AllCol` trùng hệt `SortKey` (đều thêm đúng "rack") nên không cần ép
// kiểu sort riêng — "rack" không có ô lọc riêng (đã có dropdown chọn rack ở
// trên, chính xác hơn gõ text) nên không đưa vào `FreeFilterKey`.
type StructuralCol = "rack";
type AllCol = StructuralCol | VisibleCol;
const DEFAULT_ALL_ORDER: AllCol[] = ["rack", ...COLUMN_ITEMS.map((c) => c.key)];
const STRUCTURAL_COLUMNS = new Set<AllCol>(["rack"]);
const OPTIONAL_COL_SET = new Set<AllCol>(COLUMN_ITEMS.map((c) => c.key));

export default function SearchClient({ rows }: { rows: SearchRow[] }) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [rackId, setRackId] = useState(""); // "" = tất cả rack
  // Mặc định KHÔNG hiện bảng (yêu cầu người dùng 2026-08-08: 2000+ port load
  // hết ngay lúc mở tab làm chậm) — chỉ hiện khi đã chọn đúng 1 rack HOẶC chủ
  // động bấm "Xem tất cả" (cùng cơ chế DeviceCircuitList.tsx).
  const [viewAll, setViewAll] = useState(false);
  // Chọn 1 rack HOẶC đổi sang "Cổng trống"/"Đường dự phòng" (đều tự thu hẹp
  // đáng kể so với toàn bộ port) đều coi là đã chọn phạm vi — không bắt buộc
  // riêng chọn rack mới hiện bảng.
  const scopeChosen = viewAll || rackId !== "" || mode !== "all";
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("rack");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("search-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("search-trunk-col-visibility", DEFAULT_VISIBLE);
  // "-v2" (yêu cầu người dùng 2026-08-08, cùng lý do đã đổi ở PortTable.tsx).
  const {
    order: colOrder,
    moveColumn,
    reset: resetColOrder,
  } = useColumnOrder<AllCol>("search-trunk-col-order-v2", DEFAULT_ALL_ORDER);
  const orderedAll = colOrder.filter((col) => STRUCTURAL_COLUMNS.has(col) || visible[col as VisibleCol]);
  const [filters, setFilters] = useState<Record<FreeFilterKey, string>>({
    route: "",
    port: "",
    fiber: "",
    name: "",
    counterpart: "",
  });

  function setFilter(key: FreeFilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const sorted = useMemo(() => {
    const arr = [...rows].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [rows, sortKey, sortDir]);

  // Danh sách rack duy nhất để chọn lọc CHÍNH XÁC theo 1 rack — tách riêng
  // khỏi ô tìm kiếm tự do vì gõ text tự do có thể khớp nhầm sang cột khác
  // (tên luồng, đối phương...) khi mã rack trùng một phần với nội dung đó.
  const rackOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) map.set(r.rackId, r.rackCode);
    return [...map.entries()].map(([id, code]) => ({ id, code })).sort((a, b) => compareRackCode(a.code, b.code));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = sorted;
    if (rackId) list = list.filter((r) => r.rackId === rackId);
    // "Cổng trống theo tuyến cáp" (architecture.md 4.3): chưa gán luồng nào.
    if (mode === "unused") list = list.filter((r) => deriveStatus(r) === "empty");
    // "Đường dự phòng" (architecture.md 4.3): tên luồng theo quy ước "DP"/"Dự phòng".
    if (mode === "standby") list = list.filter((r) => deriveStatus(r) === "standby");

    return list.filter((r) => FREE_FILTER_KEYS.every((k) => matchesFilter(freeCellText(r, k), filters[k])));
  }, [sorted, mode, rackId, filters]);

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (r: SearchRow) => string | number | null }[] = [{ label: "Rack", getValue: (r) => r.rackCode }];
    if (visible.route) cols.push({ label: "Tuyến cáp", getValue: (r) => r.cableRouteName });
    if (visible.port) cols.push({ label: "Port", getValue: (r) => r.portNumber });
    if (visible.fiber) cols.push({ label: "Sợi", getValue: (r) => r.fiberNumber });
    if (visible.status) cols.push({ label: "Trạng thái", getValue: (r) => STATUS_LABEL[deriveStatus(r)] });
    if (visible.name) cols.push({ label: "Tên luồng", getValue: (r) => r.circuit?.name ?? "" });
    if (visible.counterpart) cols.push({ label: "Đối phương", getValue: (r) => r.circuit?.counterpartText ?? "" });
    return cols;
  }, [visible]);

  const visibleColCount = 1 + COLUMN_ITEMS.filter((c) => visible[c.key]).length;

  function colWidthOf(col: AllCol): number {
    if (col === "rack") return 100;
    if (col === "route") return colWidths.route;
    if (col === "name") return colWidths.name;
    if (col === "counterpart") return colWidths.counterpart;
    if (col === "status") return 110;
    return 70; // port/fiber
  }

  function renderHeaderCell(col: AllCol) {
    // `AllCol` trùng hệt `SortKey` ở file này (xem comment khai báo AllCol).
    const common = {
      key: col,
      sortKey: col,
      activeSortKey: sortKey,
      sortDir,
      onSort: toggleSort,
      reorderKey: col,
      onReorderColumn: moveColumn,
    } as const;
    switch (col) {
      case "rack":
        return <DataTh {...common} label="Rack" />;
      case "route":
        return (
          <DataTh
            {...common}
            label="Tuyến cáp"
            width={colWidths.route}
            onResize={(w) => resizeCol("route", w)}
            filterValue={filters.route}
            onFilterChange={(v) => setFilter("route", v)}
          />
        );
      case "port":
        return <DataTh {...common} label="Port" align="right" filterValue={filters.port} onFilterChange={(v) => setFilter("port", v)} />;
      case "fiber":
        return <DataTh {...common} label="Sợi" align="right" filterValue={filters.fiber} onFilterChange={(v) => setFilter("fiber", v)} />;
      case "status":
        return <DataTh {...common} label="Trạng thái" />;
      case "name":
        return (
          <DataTh
            {...common}
            label="Tên luồng"
            width={colWidths.name}
            onResize={(w) => resizeCol("name", w)}
            filterValue={filters.name}
            onFilterChange={(v) => setFilter("name", v)}
          />
        );
      case "counterpart":
        return (
          <DataTh
            {...common}
            label="Đối phương"
            width={colWidths.counterpart}
            onResize={(w) => resizeCol("counterpart", w)}
            filterValue={filters.counterpart}
            onFilterChange={(v) => setFilter("counterpart", v)}
          />
        );
    }
  }

  function renderCell(col: AllCol, r: SearchRow, ds: DerivedStatus) {
    switch (col) {
      case "rack":
        return (
          <td key={col} className="px-3 py-2">
            <Link href={`/odf-trunk/${r.rackId}`} className="font-medium text-primary-700 hover:underline">
              {r.rackCode}
            </Link>
          </td>
        );
      case "route":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.cableRouteName}
          </td>
        );
      case "port":
        return (
          <td key={col} className="px-3 py-2 text-right text-slate-600">
            {r.portNumber}
          </td>
        );
      case "fiber":
        return (
          <td key={col} className="px-3 py-2 text-right text-slate-600">
            {r.fiberNumber ?? "—"}
          </td>
        );
      case "status":
        return (
          <td key={col} className="px-3 py-2">
            <span
              className={
                "rounded px-2 py-0.5 text-xs font-medium " +
                (ds === "empty" ? "bg-slate-100 text-slate-500" : ds === "standby" ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700")
              }
            >
              {STATUS_LABEL[ds]}
            </span>
          </td>
        );
      case "name":
        return (
          <td key={col} className="px-3 py-2 text-slate-700 break-words">
            {r.circuit?.name ?? "—"}
          </td>
        );
      case "counterpart":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.circuit?.counterpartText ?? "—"}
          </td>
        );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="input w-auto max-w-[220px]" value={rackId} onChange={(e) => setRackId(e.target.value)}>
          <option value="">Tất cả rack</option>
          {rackOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(
            [
              ["all", "Tất cả"],
              ["unused", "Cổng trống"],
              ["standby", "Đường dự phòng"],
            ] as [FilterMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-md px-3 py-1.5 text-sm border " +
                (mode === m
                  ? "bg-primary-600 text-white border-primary-600"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm text-slate-500">
          {filtered.length}/{rows.length} port
        </p>
        {Object.values(filters).some((v) => v) && (
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() => setFilters({ route: "", port: "", fiber: "", name: "", counterpart: "" })}
          >
            Xóa bộ lọc
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <RefreshButton />
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Tìm kiếm ODF trung kế" fileNamePrefix="Tim_kiem_ODF_trung_ke" />
          <ColumnPicker
            items={COLUMN_ITEMS}
            order={colOrder.filter((col): col is VisibleCol => OPTIONAL_COL_SET.has(col))}
            visible={visible}
            onToggle={toggleColumn}
            onReorderColumn={moveColumn as (dragged: VisibleCol, target: VisibleCol) => void}
            onResetOrder={resetColOrder}
          />
        </div>
      </div>

      <EmptyUntilFiltered active={scopeChosen} onShowAll={() => setViewAll(true)} prompt="Chọn 1 rack ở trên để xem, hoặc">
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
            {filtered.map((r) => {
              const ds = deriveStatus(r);
              return (
                <tr key={r.portId} className="border-t border-slate-100 hover:bg-primary-50/50">
                  {orderedAll.map((col) => renderCell(col, r, ds))}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy port nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </EmptyUntilFiltered>
    </div>
  );
}
