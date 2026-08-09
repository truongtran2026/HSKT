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

  // Chế độ PHẲNG (yêu cầu người dùng 2026-08-09, dùng cho "Chọn tuyến hiển
  // thị" ở Dashboard — không có cấp nhóm nào bên dưới tuyến cáp, khác
  // /odf-trunk có rack bên trong tuyến). Xét trên TOÀN BỘ `items` gốc (không
  // phải `visible` sau khi gõ tìm) để không đổi hành vi 2 nơi ĐANG dùng nhóm
  // thật (ImportExportClient/TrunkRackListPanel luôn có nhiều nhóm) dù lỡ gõ
  // tìm ra kết quả chỉ khớp 1 nhóm.
  const isFlat = useMemo(() => new Set(items.map((i) => i.group)).size <= 1, [items]);

  function toggleItem(value: string) {
    const base = selected ?? allValues;
    onChange(base.includes(value) ? base.filter((v) => v !== value) : [...base, value]);
  }

  // Chọn/bỏ chọn CẢ 1 nhóm cùng lúc (yêu cầu người dùng 2026-08-08 — ở
  // "/odf-trunk", 1 tuyến cáp gồm nhiều rack vd "ODF 1/8, 1/9, 1/10" đều
  // thuộc "144FO#1 ADN1 - 2T9", trước đây phải tick từng rack 1). Đang CHỌN
  // HẾT (mọi item trong nhóm) -> bấm để BỎ hết; ngược lại (chưa chọn hết,
  // kể cả đang chọn 0) -> bấm để CHỌN hết — cùng logic 2 trạng thái với nút
  // "Chọn tất cả"/"Bỏ chọn" chung, chỉ thu hẹp phạm vi về đúng 1 nhóm.
  function toggleGroup(groupItems: GroupedMultiSelectItem[]) {
    const base = selected ?? allValues;
    const groupValues = groupItems.map((i) => i.value);
    const allChecked = groupValues.every((v) => base.includes(v));
    onChange(allChecked ? base.filter((v) => !groupValues.includes(v)) : Array.from(new Set([...base, ...groupValues])));
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
            {isFlat
              ? visible.map((item) => {
                  const checked = selected === null || selected.includes(item.value);
                  return (
                    <label key={item.value} className="flex items-center gap-2 py-1 text-sm text-slate-700">
                      <input type="checkbox" checked={checked} onChange={() => toggleItem(item.value)} />
                      <span className="truncate" title={item.label}>
                        {item.label}
                      </span>
                    </label>
                  );
                })
              : grouped.map(([group, groupItems]) => {
                  const base = selected ?? allValues;
                  const groupChecked = groupItems.map((i) => i.value).filter((v) => base.includes(v)).length;
                  const groupAllChecked = groupChecked === groupItems.length;
                  const groupSomeChecked = groupChecked > 0 && !groupAllChecked;
                  return (
                    <div key={group} className="mb-2">
                      {/* Checkbox cấp NHÓM (yêu cầu người dùng 2026-08-08) — bấm
                          1 lần chọn/bỏ CẢ tuyến cáp thay vì tick từng rack. Chỉ
                          hiện khi nhóm có >1 mục — nhóm 1 mục thì checkbox riêng
                          của mục đó bên dưới đã đủ, thêm 1 checkbox nữa chỉ rối. */}
                      {groupItems.length > 1 ? (
                        <label className="mt-2 mb-1 flex cursor-pointer items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-primary-700">
                          <input
                            type="checkbox"
                            checked={groupAllChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = groupSomeChecked;
                            }}
                            onChange={() => toggleGroup(groupItems)}
                          />
                          <span className="truncate" title={`${group} — cả tuyến (${groupItems.length} rack)`}>
                            {group}
                          </span>
                        </label>
                      ) : (
                        <div className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{group}</div>
                      )}
                      {groupItems.map((item) => {
                        const checked = selected === null || selected.includes(item.value);
                        return (
                          <label key={item.value} className="flex items-center gap-2 py-1 pl-5 text-sm text-slate-700">
                            <input type="checkbox" checked={checked} onChange={() => toggleItem(item.value)} />
                            <span className="truncate" title={item.label}>
                              {item.label}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
            {visible.length === 0 && <p className="py-2 text-sm text-slate-400">Không có kết quả.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
