"use client";

import { useState } from "react";
import type { SortDir } from "@/lib/useSort";
import FilterInput from "@/components/ui/FilterInput";
import FilterSelect from "@/components/ui/FilterSelect";
import ColumnResizeHandle from "@/components/ui/ColumnResizeHandle";
import { IconGripVertical } from "@/components/ui/icons";

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
//
// Kéo-thả đổi thứ tự cột (yêu cầu người dùng 2026-08-08, xem lib/useColumnOrder.ts)
// — CHỈ icon 6-chấm (IconGripVertical) là `draggable`, KHÔNG phải cả <th>:
// nếu để cả <th> draggable thì việc bấm chọn chữ trong ô lọc/bấm nhãn để sắp
// xếp dễ bị trình duyệt hiểu nhầm thành bắt đầu kéo. Icon grip chặn
// `stopPropagation` khi bấm (không phải kéo) để không lỡ kích hoạt sắp xếp
// của div cha. Toàn bộ <th> vẫn là VÙNG THẢ (onDragOver/onDrop) để dễ nhắm
// khi thả, không bắt buộc thả trúng đúng icon nhỏ.
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
  filterOptions,
  width,
  onResize,
  reorderKey,
  onReorderColumn,
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
  // Cột chỉ có vài giá trị rời rạc cố định (vd trạng thái) — cho CHỌN thay
  // vì gõ chữ (yêu cầu người dùng 2026-08-08). Có mặt thì dùng FilterSelect
  // thay FilterInput, dù vẫn cùng vị trí/kích thước trong <th>.
  filterOptions?: { value: string; label: string }[];
  width?: number;
  onResize?: (width: number) => void;
  // Định danh cột này để kéo-thả đổi thứ tự — truyền CÙNG `onReorderColumn`
  // (từ `useColumnOrder().moveColumn`) thì mới bật kéo-thả cho cột này.
  reorderKey?: K;
  onReorderColumn?: (draggedKey: K, targetKey: K) => void;
  className?: string;
}) {
  const sortable = sortKey !== undefined && !!onSort;
  const active = sortable && activeSortKey === sortKey;
  const filterable = onFilterChange !== undefined;
  const reorderable = reorderKey !== undefined && !!onReorderColumn;
  const [dragOver, setDragOver] = useState(false);

  return (
    <th
      onDragOver={
        reorderable
          ? (e) => {
              e.preventDefault();
              setDragOver(true);
            }
          : undefined
      }
      onDragLeave={reorderable ? () => setDragOver(false) : undefined}
      onDrop={
        reorderable
          ? (e) => {
              e.preventDefault();
              setDragOver(false);
              const draggedKey = e.dataTransfer.getData("text/plain");
              if (draggedKey && draggedKey !== reorderKey) onReorderColumn!(draggedKey as K, reorderKey!);
            }
          : undefined
      }
      className={`sticky top-0 z-10 relative bg-primary-50 px-3 py-2 align-top ${align === "right" ? "text-right" : "text-left"} ${
        dragOver ? "bg-primary-200" : ""
      } ${className}`}
    >
      <div
        className={`mb-1 flex min-w-0 items-center gap-1 font-semibold ${
          sortable ? "cursor-pointer select-none hover:text-primary-900" : ""
        } ${align === "right" ? "justify-end" : ""}`}
        onClick={sortable ? () => onSort!(sortKey!) : undefined}
        title={sortable ? `${label} — bấm để sắp xếp` : label}
      >
        {reorderable && (
          <span
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", reorderKey!);
              e.dataTransfer.effectAllowed = "move";
            }}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 cursor-grab text-primary-300 hover:text-primary-600"
            title="Kéo để đổi thứ tự cột"
          >
            <IconGripVertical className="h-3.5 w-3.5" />
          </span>
        )}
        <span className="truncate">{label}</span>
        {sortable && (
          <span className={`shrink-0 text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
            {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        )}
      </div>
      {filterable &&
        (filterOptions ? (
          <FilterSelect value={filterValue ?? ""} onChange={onFilterChange!} options={filterOptions} />
        ) : (
          <FilterInput value={filterValue ?? ""} onChange={onFilterChange!} align={align} placeholder={filterPlaceholder} />
        ))}
      {width !== undefined && onResize && <ColumnResizeHandle width={width} onResize={onResize} />}
    </th>
  );
}
