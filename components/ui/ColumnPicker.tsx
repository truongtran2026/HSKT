"use client";

import { useEffect, useRef, useState } from "react";

export interface ColumnPickerItem<K extends string> {
  key: K;
  label: string;
}

// Nút "Cột hiển thị (n/m)" mở dropdown checkbox phẳng — dùng chung cho các
// bảng ODF trung kế/thiết bị/Hồ sơ đấu nối (yêu cầu người dùng 2026-08-07).
// Đơn giản hơn components/ui/GroupedMultiSelect.tsx (không nhóm/tìm kiếm, vì
// mỗi bảng chỉ có dưới 10 cột) nhưng dùng lại đúng pattern "bấm ra ngoài để
// đóng" từ file đó.
export default function ColumnPicker<K extends string>({
  items,
  visible,
  onToggle,
}: {
  items: ColumnPickerItem<K>[];
  visible: Record<K, boolean>;
  onToggle: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const shownCount = items.filter((i) => visible[i.key]).length;

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
        Cột hiển thị ({shownCount}/{items.length})
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          {items.map((item) => (
            <label key={item.key} className="flex items-center gap-2 py-1 text-sm text-slate-700">
              <input type="checkbox" checked={visible[item.key]} onChange={() => onToggle(item.key)} />
              <span className="truncate">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
