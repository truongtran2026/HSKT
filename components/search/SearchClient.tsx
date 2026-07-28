"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { compareRackCode } from "@/lib/rackCode";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { useColumnWidths } from "@/lib/useColumnWidths";
import SortableTh from "@/components/ui/SortableTh";
import ResizableTh from "@/components/ui/ResizableTh";
import FilterInput from "@/components/ui/FilterInput";
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

export default function SearchClient({ rows }: { rows: SearchRow[] }) {
  const [mode, setMode] = useState<FilterMode>("all");
  const [rackId, setRackId] = useState(""); // "" = tất cả rack
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("rack");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("search-col-widths", DEFAULT_COL_WIDTHS);
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

      <p className="text-sm text-slate-500 mb-2">
        {filtered.length}/{rows.length} port
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 100 }} />
            <col style={{ width: colWidths.route }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 70 }} />
            <col style={{ width: 110 }} />
            <col style={{ width: colWidths.name }} />
            <col style={{ width: colWidths.counterpart }} />
          </colgroup>
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <SortableTh label="Rack" sortKey="rack" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <ResizableTh
                label="Tuyến cáp"
                sortKey="route"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.route}
                onResize={(w) => resizeCol("route", w)}
              />
              <SortableTh label="Port" sortKey="port" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="Sợi" sortKey="fiber" activeKey={sortKey} dir={sortDir} onSort={toggleSort} align="right" />
              <SortableTh label="Trạng thái" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <ResizableTh
                label="Tên luồng"
                sortKey="name"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
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
                <FilterInput value={filters.route} onChange={(v) => setFilter("route", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.port} onChange={(v) => setFilter("port", v)} align="right" />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.fiber} onChange={(v) => setFilter("fiber", v)} align="right" />
              </th>
              <th className="px-2 py-1" />
              <th className="px-2 py-1">
                <FilterInput value={filters.name} onChange={(v) => setFilter("name", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.counterpart} onChange={(v) => setFilter("counterpart", v)} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const ds = deriveStatus(r);
              return (
                <tr key={r.portId} className="border-t border-slate-100 hover:bg-primary-50/50">
                  <td className="px-4 py-2">
                    <Link href={`/odf-trunk/${r.rackId}`} className="font-medium text-primary-700 hover:underline">
                      {r.rackCode}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-600 break-words">{r.cableRouteName}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{r.portNumber}</td>
                  <td className="px-4 py-2 text-right text-slate-600">{r.fiberNumber ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={
                        "rounded px-2 py-0.5 text-xs font-medium " +
                        (ds === "empty"
                          ? "bg-slate-100 text-slate-500"
                          : ds === "standby"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-emerald-100 text-emerald-700")
                      }
                    >
                      {STATUS_LABEL[ds]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-700 break-words">{r.circuit?.name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 break-words">{r.circuit?.counterpartText ?? "—"}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy port nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
