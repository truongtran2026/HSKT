"use client";

import type { SortDir } from "@/lib/useSort";
import ColumnResizeHandle from "./ColumnResizeHandle";

// Tiêu đề cột kéo dãn độ rộng được (tay kéo ở mép phải), sắp xếp được TÙY
// CHỌN — dùng chung cho mọi bảng dữ liệu cần cột co dãn (yêu cầu người dùng
// 2026-07-27: "các bảng dữ liệu đều cho tôi thay đổi kích thước cột"). Để
// trống sortKey/onSort thì cột chỉ kéo dãn, không sắp xếp được (vd cột
// "Chuyển tiếp" bên ODF trung kế — không có ý nghĩa để sắp xếp).
//
// Độ rộng thật sự có tác dụng cần bảng cha dùng `table-fixed` + <colgroup>
// (xem PortTable.tsx) — component này chỉ lo phần kéo + tiêu đề, KHÔNG tự
// set width lên chính nó.
export default function ResizableTh<K extends string>({
  label,
  width,
  onResize,
  sortKey,
  activeSortKey,
  sortDir,
  onSort,
  className = "",
}: {
  label: string;
  width: number;
  onResize: (width: number) => void;
  sortKey?: K;
  activeSortKey?: K;
  sortDir?: SortDir;
  onSort?: (key: K) => void;
  className?: string;
}) {
  const sortable = sortKey !== undefined && !!onSort;
  const active = sortable && activeSortKey === sortKey;

  return (
    <th
      className={`relative px-3 py-2 text-left font-semibold select-none ${sortable ? "cursor-pointer hover:bg-primary-100" : ""} ${className}`}
      onClick={sortable ? () => onSort!(sortKey!) : undefined}
      title={sortable ? "Bấm để sắp xếp" : undefined}
    >
      {label}
      {sortable && (
        <span className={`ml-1 text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
          {active ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      )}
      <ColumnResizeHandle width={width} onResize={onResize} />
    </th>
  );
}
