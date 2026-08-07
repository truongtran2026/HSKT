"use client";

import { useState } from "react";

// Ẩn/hiện cột tùy chọn, nhớ lại lựa chọn của người dùng giữa các lần vào
// trang qua localStorage — cùng cấu trúc với lib/useColumnWidths.ts (yêu cầu
// người dùng 2026-08-07: "Hồ sơ ODF" + "Hồ sơ đấu nối" đều cần ẩn/hiện cột).
// Mỗi bảng truyền 1 storageKey RIÊNG để không lẫn giữa các bảng khác nhau.
export function useColumnVisibility<K extends string>(storageKey: string, defaults: Record<K, boolean>) {
  const [visible, setVisible] = useState<Record<K, boolean>>(() => loadVisibility(storageKey, defaults));

  function toggle(key: K) {
    setVisible((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveVisibility(storageKey, next);
      return next;
    });
  }

  return { visible, toggle };
}

function loadVisibility<K extends string>(storageKey: string, defaults: Record<K, boolean>): Record<K, boolean> {
  if (typeof window === "undefined") return defaults;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

function saveVisibility<K extends string>(storageKey: string, visible: Record<K, boolean>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(visible));
  } catch {
    /* bỏ qua nếu localStorage không dùng được (vd chế độ ẩn danh chặn) */
  }
}
