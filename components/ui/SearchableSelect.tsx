"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeVN } from "@/lib/text";

export interface SearchableSelectItem {
  value: string;
  label: string;
  group?: string;
}

// Dropdown chọn 1 giá trị, có ô gõ tìm nhanh + nhóm theo "group" (tùy chọn) —
// cùng pattern với GroupedMultiSelect nhưng chỉ chọn 1 (thay cho <select> gốc
// khi danh sách quá dài, phải cuộn hết mới thấy — yêu cầu người dùng
// 2026-07-27, vd chọn Thiết bị ở form "Thêm luồng mới"). Ô lọc CHỈ xuất hiện
// khi bấm mở dropdown ra (không chiếm chỗ lúc đóng), tự focus sẵn để gõ được
// ngay không cần bấm thêm lần nữa.
export default function SearchableSelect({
  items,
  value,
  onChange,
  placeholder = "-- Chọn --",
}: {
  items: SearchableSelectItem[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài khung thì tự đóng, cùng nếp đã dùng ở GroupedMultiSelect.
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

  const visible = useMemo(() => {
    const q = normalizeVN(query.trim());
    if (!q) return items;
    return items.filter((i) => normalizeVN(i.label).includes(q) || (i.group && normalizeVN(i.group).includes(q)));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchableSelectItem[]>();
    for (const item of visible) {
      const key = item.group ?? "";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  const selectedLabel = items.find((i) => i.value === value)?.label;

  function pick(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        className="input mt-1 flex w-full items-center justify-between gap-1 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${selectedLabel ? "" : "text-slate-400"}`}>{selectedLabel ?? placeholder}</span>
        <span className="text-slate-400">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[240px] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Lọc..."
              className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-normal text-slate-700 focus:border-primary-400 focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {grouped.map(([group, groupItems]) => (
              <div key={group} className="mb-1">
                {group && <div className="mt-1 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</div>}
                {groupItems.map((item) => (
                  <button
                    type="button"
                    key={item.value}
                    onClick={() => pick(item.value)}
                    title={item.label}
                    className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-primary-50 ${
                      item.value === value ? "bg-primary-100 text-primary-800" : "text-slate-700"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
            {visible.length === 0 && <p className="py-2 text-sm text-slate-400">Không có kết quả.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
