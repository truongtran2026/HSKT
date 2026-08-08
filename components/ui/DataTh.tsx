"use client";

import type { SortDir } from "@/lib/useSort";
import FilterInput from "@/components/ui/FilterInput";
import ColumnResizeHandle from "@/components/ui/ColumnResizeHandle";

// Header CHUẨN dùng chung cho MỌI bảng dữ liệu trong app (quy định chung —
// xem architecture.md) — thay thế SortableTh/ResizableTh CŨ và các bản viết
// tay riêng lẻ (Th ở PortTable.tsx, SortFilterTh/FilterOnlyTh ở
// DeviceCircuitList.tsx). Gộp nhãn+sắp xếp+lọc+kéo dãn vào ĐÚNG 1 <th>
// sticky (không tách 2 hàng <tr> — 2 hàng sticky riêng từng gây lỗi chữ đè
// nhau khi cuộn, xem comment cũ ở 2 file trên).
//
// SỬA LỖI (yêu cầu người dùng 2026-08-08): "co dãn cột thì chữ được wrap lại
// nhưng ô filter phải dàn hàng ngang, không được nằm trên ô nằm dưới". Gốc lỗi
// là nhãn cột KHÔNG có whitespace-nowrap — cột hẹp làm nhãn dài xuống 2 dòng,
// đẩy FilterInput ở cột đó lệch xuống so với cột bên cạnh (label 1 dòng).
// Fix: nhãn LUÔN 1 dòng + rút gọn bằng "..." (`truncate`, có `title` đầy đủ
// khi bị cắt) — cột hẹp chỉ ảnh hưởng tới NỘI DUNG bên trong <td> (đã có
// break-words ở mọi bảng), không bao giờ ảnh hưởng tới chiều cao <th>.
export default function DataTh<K extends string>({
  label,
  align = "left",
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  filterValue,
  onFilterChange,
  filterPlaceholder,
  width,
  onResize,
  className = "",
}: {
  label: string;
  align?: "left" | "right";
  sortKey?: K;
  activeSortKey?: K;
  sortDir?: SortDir;
  onSort?: (key: K) => void;
  filterValue?: string;
  onFilterChange?: (v: string) => void;
  filterPlaceholder?: string;
  width?: number;
  onResize?: (width: number) => void;
  className?: string;
}) {
  const sortable = sortKey !== undefined && !!onSort;
  const active = sortable && activeSortKey === sortKey;
  const filterable = onFilterChange !== undefined;

  return (
    <th
      className={`sticky top-0 z-10 relative bg-primary-50 px-3 py-2 align-top ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      <div
        className={`mb-1 flex min-w-0 items-center gap-1 font-semibold ${
          sortable ? "cursor-pointer select-none hover:text-primary-900" : ""
        } ${align === "right" ? "justify-end" : ""}`}
        onClick={sortable ? () => onSort!(sortKey!) : undefined}
        title={sortable ? `${label} — bấm để sắp xếp` : label}
      >
        <span className="truncate">{label}</span>
        {sortable && (
          <span className={`shrink-0 text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        )}
      </div>
      {filterable && (
        <FilterInput value={filterValue ?? ""} onChange={onFilterChange!} align={align} placeholder={filterPlaceholder} />
      )}
      {width !== undefined && onResize && <ColumnResizeHandle width={width} onResize={onResize} />}
    </th>
  );
}
