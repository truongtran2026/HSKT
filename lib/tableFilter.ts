import { normalizeVN } from "./text";

// Lọc theo từng cột kiểu Excel: so khớp chuỗi con, bỏ dấu, không phân biệt
// hoa/thường. Ô lọc để trống -> luôn khớp (không lọc cột đó).
export function matchesFilter(value: string | number | null | undefined, filterText: string): boolean {
  const f = normalizeVN(filterText.trim());
  if (!f) return true;
  const v = normalizeVN(value == null ? "" : String(value));
  return v.includes(f);
}
