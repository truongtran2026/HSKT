"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import { isStandbyCircuitName } from "@/lib/text";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EmptyUntilFiltered from "@/components/ui/EmptyUntilFiltered";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

// Bản "Hồ sơ đấu nối (thiết bị)" của trang Tìm kiếm nhanh (yêu cầu người dùng
// 2026-08-08: "/search" trước đây CHỈ có ODF trung kế, thiếu hẳn domain
// thiết bị). Copy cấu trúc SortableTh/ResizableTh/FilterInput từ
// SearchClient.tsx (bên trung kế) cho đồng nhất, đổi cột theo đúng
// DeviceCircuitRow — KHÔNG có khái niệm "cổng trống" ở domain này (mỗi dòng
// circuits đã là 1 luồng thật, không có "port chưa gán" như bên trung kế).
type FilterMode = "all" | "standby";
type SortKey = "name" | "device" | "trib" | "positionOwn" | "positionNext" | "counterpart";

function compareByKey(key: SortKey, a: DeviceCircuitRow, b: DeviceCircuitRow): number {
  switch (key) {
    case "name":
      return compareValues(a.name, b.name);
    case "device":
      return compareValues(a.deviceName, b.deviceName);
    case "trib":
      return compareValues(a.tribText, b.tribText);
    case "positionOwn":
      return compareValues(a.devicePositionOwn, b.devicePositionOwn);
    case "positionNext":
      return compareValues(a.devicePositionNext, b.devicePositionNext);
    case "counterpart":
      return compareValues(a.counterpartText, b.counterpartText);
  }
}

type FreeFilterKey = "device" | "trib" | "positionOwn" | "positionNext" | "interface" | "counterpart" | "notes";

function freeCellText(r: DeviceCircuitRow, key: FreeFilterKey): string | null {
  switch (key) {
    case "device":
      return r.deviceName;
    case "trib":
      return r.tribText;
    case "positionOwn":
      return r.devicePositionOwn;
    case "positionNext":
      return r.devicePositionNext;
    case "interface":
      return r.interfaceType;
    case "counterpart":
      return r.counterpartText;
    case "notes":
      return r.notes;
  }
}

const FREE_FILTER_KEYS: FreeFilterKey[] = ["device", "trib", "positionOwn", "positionNext", "interface", "counterpart", "notes"];

type ResizableCol = "name" | "positionNext" | "counterpart";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { name: 240, positionNext: 220, counterpart: 200 };

// Tên luồng luôn hiện — 5 cột còn lại ẩn/hiện được (quy định chung mọi bảng).
type VisibleCol = "device" | "trib" | "positionOwn" | "positionNext" | "counterpart";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = {
  device: true,
  trib: true,
  positionOwn: true,
  positionNext: true,
  counterpart: true,
};
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "device", label: "Thiết bị" },
  { key: "trib", label: "Trib" },
  { key: "positionOwn", label: "Vị trí ODF (thiết bị)" },
  { key: "positionNext", label: "Vị trí ODF (tiếp theo)" },
  { key: "counterpart", label: "Đối phương" },
];

// Kéo-thả TOÀN BỘ cột, kể cả "Tên luồng" trước giờ cố định đầu bảng (yêu cầu
// người dùng 2026-08-08, đồng bộ từ PortTable.tsx — xem architecture.md Mục
// 84). `AllCol` trùng hệt `SortKey` — không cần ép kiểu sort riêng.
type StructuralCol = "name";
type AllCol = StructuralCol | VisibleCol;
const DEFAULT_ALL_ORDER: AllCol[] = ["name", ...COLUMN_ITEMS.map((c) => c.key)];
const STRUCTURAL_COLUMNS = new Set<AllCol>(["name"]);
const OPTIONAL_COL_SET = new Set<AllCol>(COLUMN_ITEMS.map((c) => c.key));

export default function DeviceSearchClient({ rows }: { rows: DeviceCircuitRow[] }) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [deviceName, setDeviceName] = useState(""); // "" = tất cả thiết bị
  // Mặc định KHÔNG hiện bảng (yêu cầu người dùng 2026-08-08) — chỉ hiện khi
  // đã chọn thiết bị/chế độ lọc cụ thể HOẶC chủ động bấm "Xem tất cả".
  const [viewAll, setViewAll] = useState(false);
  const scopeChosen = viewAll || deviceName !== "" || mode !== "all";
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("search-device-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("search-device-col-visibility", DEFAULT_VISIBLE);
  // "-v2" (yêu cầu người dùng 2026-08-08, cùng lý do đã đổi ở PortTable.tsx).
  const {
    order: colOrder,
    moveColumn,
    reset: resetColOrder,
  } = useColumnOrder<AllCol>("search-device-col-order-v2", DEFAULT_ALL_ORDER);
  const orderedAll = colOrder.filter((col) => STRUCTURAL_COLUMNS.has(col) || visible[col as VisibleCol]);
  const [filters, setFilters] = useState<Record<FreeFilterKey, string>>({
    device: "",
    trib: "",
    positionOwn: "",
    positionNext: "",
    interface: "",
    counterpart: "",
    notes: "",
  });

  function setFilter(key: FreeFilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const sorted = useMemo(() => {
    const arr = [...rows].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [rows, sortKey, sortDir]);

  const deviceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.deviceName) set.add(r.deviceName);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    let list = sorted;
    if (deviceName) list = list.filter((r) => r.deviceName === deviceName);
    if (mode === "standby") list = list.filter((r) => isStandbyCircuitName(r.name));
    return list.filter((r) => FREE_FILTER_KEYS.every((k) => matchesFilter(freeCellText(r, k), filters[k])));
  }, [sorted, mode, deviceName, filters]);

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (r: DeviceCircuitRow) => string | number | null }[] = [{ label: "Tên luồng", getValue: (r) => r.name }];
    if (visible.device) cols.push({ label: "Thiết bị", getValue: (r) => r.deviceName });
    if (visible.trib) cols.push({ label: "Trib", getValue: (r) => r.tribText });
    if (visible.positionOwn) cols.push({ label: "Vị trí ODF (thiết bị)", getValue: (r) => r.devicePositionOwn });
    if (visible.positionNext) cols.push({ label: "Vị trí ODF (tiếp theo)", getValue: (r) => r.devicePositionNext });
    if (visible.counterpart) cols.push({ label: "Đối phương", getValue: (r) => r.counterpartText });
    return cols;
  }, [visible]);

  const visibleColCount = 1 + COLUMN_ITEMS.filter((c) => visible[c.key]).length;

  function colWidthOf(col: AllCol): number {
    if (col === "name") return colWidths.name;
    if (col === "device") return 160;
    if (col === "trib") return 90;
    if (col === "positionOwn") return 150;
    if (col === "positionNext") return colWidths.positionNext;
    return colWidths.counterpart;
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
      case "name":
        return <DataTh {...common} label="Tên luồng" width={colWidths.name} onResize={(w) => resizeCol("name", w)} />;
      case "device":
        return <DataTh {...common} label="Thiết bị" filterValue={filters.device} onFilterChange={(v) => setFilter("device", v)} />;
      case "trib":
        return <DataTh {...common} label="Trib" filterValue={filters.trib} onFilterChange={(v) => setFilter("trib", v)} />;
      case "positionOwn":
        return (
          <DataTh {...common} label="Vị trí ODF (thiết bị)" filterValue={filters.positionOwn} onFilterChange={(v) => setFilter("positionOwn", v)} />
        );
      case "positionNext":
        return (
          <DataTh
            {...common}
            label="Vị trí ODF (tiếp theo)"
            width={colWidths.positionNext}
            onResize={(w) => resizeCol("positionNext", w)}
            filterValue={filters.positionNext}
            onFilterChange={(v) => setFilter("positionNext", v)}
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

  function renderCell(col: AllCol, r: DeviceCircuitRow) {
    switch (col) {
      case "name":
        return (
          <td key={col} className="px-3 py-2">
            <Link href={`/odf-device/sua-luong#${rowAnchor(r.id)}`} className="font-medium text-primary-700 hover:underline">
              {r.name}
            </Link>
          </td>
        );
      case "device":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.deviceName ?? "—"}
          </td>
        );
      case "trib":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.tribText ?? "—"}
          </td>
        );
      case "positionOwn":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.devicePositionOwn ?? "—"}
          </td>
        );
      case "positionNext":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.devicePositionNext ?? "—"}
          </td>
        );
      case "counterpart":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.counterpartText ?? "—"}
          </td>
        );
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select className="input w-auto max-w-[220px]" value={deviceName} onChange={(e) => setDeviceName(e.target.value)}>
          <option value="">Tất cả thiết bị</option>
          {deviceOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          {(
            [
              ["all", "Tất cả"],
              ["standby", "Đường dự phòng"],
            ] as [FilterMode, string][]
          ).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={
                "rounded-md px-3 py-1.5 text-sm border " +
                (mode === m ? "bg-primary-600 text-white border-primary-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm text-slate-500">
          {filtered.length}/{rows.length} luồng
        </p>
        {Object.values(filters).some((v) => v) && (
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() => setFilters({ device: "", trib: "", positionOwn: "", positionNext: "", interface: "", counterpart: "", notes: "" })}
          >
            Xóa bộ lọc
          </button>
        )}
        <div className="ml-auto flex gap-2">
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Tìm kiếm Hồ sơ đấu nối" fileNamePrefix="Tim_kiem_Ho_so_dau_noi" />
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

      <EmptyUntilFiltered active={scopeChosen} onShowAll={() => setViewAll(true)} prompt="Chọn thiết bị ở trên để xem, hoặc">
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
              <tr key={r.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                {orderedAll.map((col) => renderCell(col, r))}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={visibleColCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy luồng nào khớp bộ lọc.
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
