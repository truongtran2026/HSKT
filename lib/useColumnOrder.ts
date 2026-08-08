"use client";

import { useState } from "react";

// Đổi thứ tự cột bằng kéo-thả, nhớ lại lựa chọn của người dùng giữa các lần
// vào trang qua localStorage — cùng cấu trúc với lib/useColumnVisibility.ts/
// lib/useColumnWidths.ts (yêu cầu người dùng 2026-08-08: "cho phép sắp xếp
// các cột không theo tuần tự hiện tại, có thể kéo cột này ra trước cột kia
// ra sau"). Chỉ áp dụng cho các cột TÙY CHỌN (đúng tập `VisibleCol` mỗi
// bảng đã có sẵn) — cột luôn hiện đầu bảng (vd "Tên luồng"/"Mã rack") và cột
// "Thao tác" cuối bảng giữ CỐ ĐỊNH vị trí, không kéo được (quy ước UI phổ
// biến: cột định danh luôn ở đầu, thao tác luôn ở cuối, dễ tìm).
export function useColumnOrder<K extends string>(storageKey: string, defaultOrder: K[]) {
  const [order, setOrder] = useState<K[]>(() => loadOrder(storageKey, defaultOrder));

  // Kéo cột `dragged` tới NGAY TRƯỚC vị trí cột `target` đang có.
  function moveColumn(dragged: K, target: K) {
    if (dragged === target) return;
    setOrder((prev) => {
      const rest = prev.filter((k) => k !== dragged);
      const targetIndex = rest.indexOf(target);
      if (targetIndex === -1) return prev;
      const next = [...rest.slice(0, targetIndex), dragged, ...rest.slice(targetIndex)];
      saveOrder(storageKey, next);
      return next;
    });
  }

  function reset() {
    setOrder(defaultOrder);
    saveOrder(storageKey, defaultOrder);
  }

  return { order, moveColumn, reset };
}

function loadOrder<K extends string>(storageKey: string, defaultOrder: K[]): K[] {
  if (typeof window === "undefined") return defaultOrder;
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return defaultOrder;
    const parsed = JSON.parse(saved) as string[];
    // Lọc bỏ key đã lưu nhưng không còn tồn tại (đổi/xóa cột về sau), rồi
    // thêm key MỚI (thêm cột sau khi người dùng đã lưu thứ tự cũ) vào CUỐI —
    // không bao giờ để mất hẳn 1 cột khỏi bảng chỉ vì thứ tự đã lưu lỗi thời.
    const stillValid = parsed.filter((k): k is K => defaultOrder.includes(k as K));
    const missing = defaultOrder.filter((k) => !stillValid.includes(k));
    return [...stillValid, ...missing];
  } catch {
    return defaultOrder;
  }
}

function saveOrder<K extends string>(storageKey: string, order: K[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(order));
  } catch {
    /* bỏ qua nếu localStorage không dùng được (vd chế độ ẩn danh chặn) */
  }
}
