"use client";

import { useState } from "react";

// Nhớ trạng thái đóng/mở của 1 khung "Phát hiện..." qua localStorage — rập
// khuôn đúng pattern lazy-init của lib/useColumnVisibility.ts (đọc localStorage
// NGAY trong useState initializer, không phải useEffect, để tránh nháy 1 khung
// hình mặc định rồi mới lật sang giá trị đã lưu). Mặc định ĐÓNG (yêu cầu
// người dùng 2026-08-08: các khung "Phát hiện..." chiếm nhiều chỗ, thu gọn
// lại để đỡ vướng — chỉ mở khi cần xem).
function loadCollapsed(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? defaultValue : raw === "true";
  } catch {
    return defaultValue;
  }
}

function saveCollapsed(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // localStorage không dùng được (vd chế độ ẩn danh chặn) — bỏ qua an toàn.
  }
}

export function useCollapsed(storageKey: string, defaultCollapsed = true) {
  const [collapsed, setCollapsed] = useState(() => loadCollapsed(storageKey, defaultCollapsed));

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      saveCollapsed(storageKey, next);
      return next;
    });
  }

  return { collapsed, toggle };
}
