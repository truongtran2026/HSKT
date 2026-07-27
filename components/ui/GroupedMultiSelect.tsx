"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeVN } from "@/lib/text";
import FilterInput from "@/components/ui/FilterInput";

export interface GroupedMultiSelectItem {
  value: string;
  label: string;
  group: string;
}

// Dropdown chọn nhiều, có gõ tìm nhanh + nhóm theo "group" (dùng cho danh
// sách dài — vd chọn thiết bị theo lĩnh vực) — cùng pattern với khung "Chọn
// tuyến hiển thị" ở Dashboard, tách ra dùng chung. `selected = null` nghĩa
// là "chọn tất cả" (mặc định, không lưu riêng từng lựa chọn khi chưa đụng
// tới gì). "Chọn tất cả"/"Bỏ chọn" chỉ tác động các mục ĐANG HIỆN theo ô
// tìm, giữ nguyên lựa chọn của các mục không hiện ra — không phải "tất tần
// tật" toàn bộ danh sách gốc.
export default function GroupedMultiSelect({
  items,
  selected,
  onChange,
  buttonLabel,
}: {
  items: GroupedMultiSelectItem[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
  buttonLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Bấm ra ngoài khung thì tự đóng (yêu cầu người dùng 2026-07-26) — đỡ phải
  // bấm riêng 1 nút "Đóng" (đã bỏ nút đó, xem JSX bên dưới).
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

  const allValues = useMemo(() => items.map((i) => i.value), [items]);

  const visible = useMemo(() => {
    const q = normalizeVN(query.trim());
    if (!q) return items;
    return items.filter((i) => normalizeVN(i.label).includes(q) || normalizeVN(i.group).includes(q));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedMultiSelectItem[]>();
    for (const item of visible) {
      const list = map.get(item.group) ?? [];
      list.push(item);
      map.set(item.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible]);

  function toggleItem(value: string) {
    const base = selected ?? allValues;
    onChange(base.includes(value) ? base.filter((v) => v !== value) : [...base, value]);
  }

  function selectAllVisible() {
    if (query.trim() === "") {
      onChange(null);
      return;
    }
    const base = selected ?? allValues;
    const visibleValues = visible.map((i) => i.value);
    onChange(Array.from(new Set([...base, ...visibleValues])));
  }

  function clearVisible() {
    if (query.trim() === "") {
      onChange([]);
      return;
    }
    const base = selected ?? allValues;
    const visibleValues = new Set(visible.map((i) => i.value));
    onChange(base.filter((v) => !visibleValues.has(v)));
  }

  const selectedCount = selected === null ? items.length : selected.length;

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button type="button" className="btn-secondary" onClick={() => setOpen((v) => !v)}>
        {buttonLabel} ({selectedCount}/{items.length})
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              onClick={selectAllVisible}
            >
              Chọn tất cả
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              onClick={clearVisible}
            >
              Bỏ chọn
            </button>
            {query.trim() && <span className="ml-auto text-xs text-slate-400">(theo kết quả đang lọc)</span>}
          </div>
          <div className="border-b border-slate-100 p-2">
            <FilterInput value={query} onChange={setQuery} />
          </div>
          <div className="max-h-72 overflow-y-auto p-3">
            {grouped.map(([group, groupItems]) => (
              <div key={group} className="mb-2">
                <div className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</div>
                {groupItems.map((item) => {
                  const checked = selected === null || selected.includes(item.value);
                  return (
                    <label key={item.value} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                      <input type="checkbox" checked={checked} onChange={() => toggleItem(item.value)} />
                      <span className="truncate" title={item.label}>
                        {item.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
            {visible.length === 0 && <p className="py-2 text-sm text-slate-400">Không có kết quả.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
