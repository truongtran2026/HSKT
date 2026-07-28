"use client";

import { useState } from "react";

// Độ rộng cột co dãn được (px), nhớ lại lựa chọn của người dùng giữa các lần
// vào trang qua localStorage — dùng CHUNG cho mọi bảng dữ liệu trong app cần
// kéo to/nhỏ cột (yêu cầu người dùng 2026-07-27: "các bảng dữ liệu đều" phải
// làm được, không riêng ODF trung kế). Mỗi bảng truyền 1 storageKey RIÊNG để
// nhớ độ rộng riêng, không lẫn giữa các bảng khác nhau.
const MIN_WIDTH = 120;
const MAX_WIDTH = 600;

export function useColumnWidths<K extends string>(storageKey: string, defaults: Record<K, number>) {
  const [widths, setWidths] = useState<Record<K, number>>(() => loadColWidths(storageKey, defaults));

  function resize(key: K, width: number) {
    setWidths((prev) => {
      const next = { ...prev, [key]: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) };
      saveColWidths(storageKey, next);
      return next;
    });
  }

  return { widths, resize };
}

function loadColWidths<K extends string>(storageKey: string, defaults: Record<K, number>): Record<K, number> {
  if (typeof window === "undefined") return defaults;
  try {
    const saved = window.localStorage.getItem(storageKey);
    return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
  } catch {
    return defaults;
  }
}

function saveColWidths<K extends string>(storageKey: string, widths: Record<K, number>) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(widths));
  } catch {
    /* bỏ qua nếu localStorage không dùng được (vd chế độ ẩn danh chặn) */
  }
}
