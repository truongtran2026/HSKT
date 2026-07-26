"use client";

import type { SortDir } from "@/lib/useSort";

// Tiêu đề cột bấm được để đổi chiều tăng/giảm — dùng chung cho mọi bảng dữ
// liệu trong app (Rack list, Port table, Tìm kiếm nhanh, Danh sách luồng
// thiết bị...) để đồng nhất hành vi + giao diện.
export default function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: SortDir;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`px-4 py-2 font-semibold select-none cursor-pointer hover:bg-primary-100 ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
      onClick={() => onSort(sortKey)}
      title="Bấm để sắp xếp"
    >
      {label}
      <span className={`ml-1 text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
        {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
      </span>
    </th>
  );
}
