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

export interface RackListItem {
  id: string;
  code: string;
  cableRouteName: string | null;
  odfType: "welded" | "distribution";
  portCount: number;
  totalPorts: number;
  inUsePorts: number;
}

type SortKey = "code" | "route" | "odfType" | "portCount" | "inUse";

function odfTypeLabel(t: RackListItem["odfType"]): string {
  return t === "welded" ? "Hàn nối" : "Phân phối";
}

function compareByKey(key: SortKey, a: RackListItem, b: RackListItem): number {
  switch (key) {
    case "code":
      return compareRackCode(a.code, b.code);
    case "route":
      return compareValues(a.cableRouteName, b.cableRouteName);
    case "odfType":
      return compareValues(a.odfType, b.odfType);
    case "portCount":
      return compareValues(a.portCount, b.portCount);
    case "inUse":
      return compareValues(a.inUsePorts, b.inUsePorts);
  }
}

function cellText(r: RackListItem, key: SortKey): string | number | null {
  switch (key) {
    case "code":
      return r.code;
    case "route":
      return r.cableRouteName;
    case "odfType":
      return odfTypeLabel(r.odfType);
    case "portCount":
      return r.portCount;
    case "inUse":
      return r.inUsePorts;
  }
}

const FILTER_KEYS: SortKey[] = ["code", "route", "odfType", "portCount", "inUse"];

// Chỉ "Tuyến cáp" cần kéo dãn (có thể dài, vd "96FO#1 ADN1 - 2T9") — các cột
// còn lại giá trị ngắn/cố định (yêu cầu người dùng 2026-07-27: "các bảng dữ
// liệu đều" kéo dãn được).
type ResizableCol = "route";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { route: 220 };

export default function RackListTable({ racks }: { racks: RackListItem[] }) {
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("code");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("rack-list-col-widths", DEFAULT_COL_WIDTHS);
  const [filters, setFilters] = useState<Record<SortKey, string>>({
    code: "",
    route: "",
    odfType: "",
    portCount: "",
    inUse: "",
  });

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const sorted = useMemo(() => {
    const arr = [...racks].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [racks, sortKey, sortDir]);

  const filtered = useMemo(
    () => sorted.filter((r) => FILTER_KEYS.every((k) => matchesFilter(cellText(r, k), filters[k]))),
    [sorted, filters]
  );

  return (
    <div>
      <p className="text-sm text-slate-500 mb-2">
        {filtered.length}/{racks.length} rack
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 120 }} />
            <col style={{ width: colWidths.route }} />
            <col style={{ width: 110 }} />
            <col style={{ width: 100 }} />
            <col style={{ width: 110 }} />
          </colgroup>
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <SortableTh label="Mã rack" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <ResizableTh
                label="Tuyến cáp"
                sortKey="route"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.route}
                onResize={(w) => resizeCol("route", w)}
              />
              <SortableTh label="Loại ODF" sortKey="odfType" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh
                label="Số port"
                sortKey="portCount"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                align="right"
              />
              <SortableTh
                label="Đang dùng"
                sortKey="inUse"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                align="right"
              />
            </tr>
            <tr className="bg-white">
              <th className="px-2 py-1">
                <FilterInput value={filters.code} onChange={(v) => setFilter("code", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.route} onChange={(v) => setFilter("route", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.odfType} onChange={(v) => setFilter("odfType", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.portCount} onChange={(v) => setFilter("portCount", v)} align="right" />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.inUse} onChange={(v) => setFilter("inUse", v)} align="right" />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rack) => (
              <tr key={rack.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                <td className="px-4 py-2">
                  <Link href={`/odf-trunk/${rack.id}`} className="font-medium text-primary-700 hover:underline">
                    {rack.code}
                  </Link>
                </td>
                <td className="px-4 py-2 text-slate-600 break-words">{rack.cableRouteName}</td>
                <td className="px-4 py-2 text-slate-600">{odfTypeLabel(rack.odfType)}</td>
                <td className="px-4 py-2 text-right text-slate-600">{rack.portCount}</td>
                <td className="px-4 py-2 text-right text-slate-600">
                  {rack.inUsePorts}/{rack.totalPorts}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy rack nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
