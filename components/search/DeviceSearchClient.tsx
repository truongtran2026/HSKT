"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { isStandbyCircuitName } from "@/lib/text";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import SortableTh from "@/components/ui/SortableTh";
import ResizableTh from "@/components/ui/ResizableTh";
import FilterInput from "@/components/ui/FilterInput";
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

export default function DeviceSearchClient({ rows }: { rows: DeviceCircuitRow[] }) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [deviceName, setDeviceName] = useState(""); // "" = tất cả thiết bị
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("search-device-col-widths", DEFAULT_COL_WIDTHS);
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
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: colWidths.name }} />
            <col style={{ width: 160 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: colWidths.positionNext }} />
            <col style={{ width: colWidths.counterpart }} />
          </colgroup>
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <ResizableTh
                label="Tên luồng"
                sortKey="name"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
              />
              <SortableTh label="Thiết bị" sortKey="device" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Trib" sortKey="trib" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Vị trí ODF (thiết bị)" sortKey="positionOwn" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <ResizableTh
                label="Vị trí ODF (tiếp theo)"
                sortKey="positionNext"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.positionNext}
                onResize={(w) => resizeCol("positionNext", w)}
              />
              <ResizableTh
                label="Đối phương"
                sortKey="counterpart"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.counterpart}
                onResize={(w) => resizeCol("counterpart", w)}
              />
            </tr>
            <tr className="bg-white">
              <th className="px-2 py-1" />
              <th className="px-2 py-1">
                <FilterInput value={filters.device} onChange={(v) => setFilter("device", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.trib} onChange={(v) => setFilter("trib", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.positionOwn} onChange={(v) => setFilter("positionOwn", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.positionNext} onChange={(v) => setFilter("positionNext", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.counterpart} onChange={(v) => setFilter("counterpart", v)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                <td className="px-4 py-2">
                  <Link href={`/odf-device/sua-luong#${rowAnchor(r.id)}`} className="font-medium text-primary-700 hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600 break-words">{r.deviceName ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600 break-words">{r.tribText ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600 break-words">{r.devicePositionOwn ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600 break-words">{r.devicePositionNext ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600 break-words">{r.counterpartText ?? "—"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy luồng nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
