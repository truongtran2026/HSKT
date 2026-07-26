"use client";

import { useState } from "react";

export type SortDir = "asc" | "desc";

// Bấm lại đúng cột đang chọn -> đảo chiều; bấm cột khác -> chuyển sang cột đó,
// mặc định tăng dần. Hành vi chuẩn của bảng dữ liệu (Excel/Google Sheets).
export function useSort<K extends string>(defaultKey: K, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  function toggleSort(key: K) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return { sortKey, sortDir, toggleSort };
}
