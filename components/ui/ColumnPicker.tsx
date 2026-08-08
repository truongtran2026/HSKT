"use client";

import { useEffect, useRef, useState } from "react";
import { IconGear, IconGripVertical } from "@/components/ui/icons";

export interface ColumnPickerItem<K extends string> {
  key: K;
  label: string;
}

// Nút "Cột hiển thị (n/m)" mở dropdown checkbox phẳng — dùng chung cho các
// bảng ODF trung kế/thiết bị/Hồ sơ đấu nối (yêu cầu người dùng 2026-08-07).
// Đơn giản hơn components/ui/GroupedMultiSelect.tsx (không nhóm/tìm kiếm, vì
// mỗi bảng chỉ có dưới 10 cột) nhưng dùng lại đúng pattern "bấm ra ngoài để
// đóng" từ file đó.
//
// Kéo-thả NGAY TRONG dropdown (yêu cầu người dùng 2026-08-08, sau khi đã có
// kéo-thả ở tiêu đề cột): kéo 1 dòng lên/xuống trong danh sách này = kéo cột
// đó sang trái/phải trong bảng — trên-xuống-dưới tương ứng trái-sang-phải.
// Cùng 1 nguồn `order`/`onReorderColumn` (từ lib/useColumnOrder.ts) với
// DataTh.tsx, chỉ khác nơi kéo — người dùng có 2 cách để làm cùng 1 việc.
export default function ColumnPicker<K extends string>({
  items,
  order,
  visible,
  onToggle,
  onReorderColumn,
  onResetOrder,
}: {
  items: ColumnPickerItem<K>[];
  // Thứ tự cột HIỆN TẠI (kể cả cột đang ẩn) — mặc định theo `items` nếu bảng
  // chưa gắn kéo-thả (vd DeviceRackPortView.tsx, chỉ 1 cột tùy chọn, không
  // cần tính năng này).
  order?: K[];
  visible: Record<K, boolean>;
  onToggle: (key: K) => void;
  // Có mặt thì mỗi dòng thêm icon kéo (IconGripVertical) để đổi thứ tự ngay
  // trong dropdown — cùng hàm `moveColumn` truyền cho DataTh ở bảng.
  onReorderColumn?: (draggedKey: K, targetKey: K) => void;
  // Có mặt thì hiện thêm nút "Đặt lại thứ tự cột" cuối dropdown (yêu cầu
  // người dùng 2026-08-08, đi kèm tính năng kéo-thả đổi thứ tự — xem
  // lib/useColumnOrder.ts) — chỗ duy nhất để hoàn tác nếu lỡ kéo sai, không
  // cần tự kéo tay lại từng cột.
  onResetOrder?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOverKey, setDragOverKey] = useState<K | null>(null);

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
  const hiddenCount = items.length - shownCount;
  const labelOf = (key: K) => items.find((i) => i.key === key)?.label ?? key;
  const displayOrder = order ?? items.map((i) => i.key);
  const reorderable = !!onReorderColumn;

  return (
    <div className="relative inline-block" ref={containerRef}>
      {/* Icon Gear thay cho nút chữ "Cột hiển thị (n/m)" cũ (yêu cầu người
          dùng 2026-08-08) — badge số cột đang ẨN (không phải đang hiện) để
          nổi bật khi có cột bị ẩn, im lặng (không hiện badge) khi hiện đủ. */}
      <button
        type="button"
        className="btn-secondary relative px-2 py-1.5"
        onClick={() => setOpen((v) => !v)}
        title={`Cột hiển thị (${shownCount}/${items.length})`}
        aria-label="Cài đặt cột hiển thị"
      >
        <IconGear />
        {hiddenCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
            {hiddenCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Cột hiển thị ({shownCount}/{items.length})
          </p>
          {displayOrder.map((key) => (
            <label
              key={key}
              className={`flex items-center gap-2 rounded py-1 text-sm text-slate-700 ${dragOverKey === key ? "bg-primary-100" : ""}`}
              onDragOver={
                reorderable
                  ? (e) => {
                      e.preventDefault();
                      setDragOverKey(key);
                    }
                  : undefined
              }
              onDragLeave={reorderable ? () => setDragOverKey((k) => (k === key ? null : k)) : undefined}
              onDrop={
                reorderable
                  ? (e) => {
                      e.preventDefault();
                      setDragOverKey(null);
                      const draggedKey = e.dataTransfer.getData("text/plain");
                      if (draggedKey && draggedKey !== key) onReorderColumn!(draggedKey as K, key);
                    }
                  : undefined
              }
            >
              {reorderable && (
                <span
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 cursor-grab text-slate-300 hover:text-slate-500"
                  title="Kéo để đổi thứ tự cột"
                >
                  <IconGripVertical className="h-3.5 w-3.5" />
                </span>
              )}
              <input type="checkbox" checked={visible[key]} onChange={() => onToggle(key)} />
              <span className="truncate">{labelOf(key)}</span>
            </label>
          ))}
          {onResetOrder && (
            <button
              type="button"
              className="mt-2 w-full border-t border-slate-100 pt-2 text-left text-xs text-primary-600 hover:underline"
              onClick={onResetOrder}
            >
              Đặt lại thứ tự cột
            </button>
          )}
        </div>
      )}
    </div>
  );
}
