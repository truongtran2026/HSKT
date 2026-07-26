// So sánh "tự nhiên" cho chuỗi có xen số (vd Trib "S1-1", "S2-1", "S11-1",
// vị trí "ODF3/9/19,20") — tách thành từng đoạn số/chữ xen kẽ rồi so từng
// đoạn, đoạn số so bằng giá trị số thay vì so ký tự. Nếu so ký tự thường
// (localeCompare) thì "S11-1" đứng trước "S2-1" (vì '1' < '2'), sai với thứ
// tự người dùng mong đợi S1-1, S1-2, S2-1, S2-2, S11-1, S11-2.
function naturalCompare(a: string, b: string): number {
  const ax = a.match(/\d+|\D+/g) ?? [];
  const bx = b.match(/\d+|\D+/g) ?? [];
  const len = Math.max(ax.length, bx.length);
  for (let i = 0; i < len; i++) {
    const ai = ax[i] ?? "";
    const bi = bx[i] ?? "";
    if (ai === bi) continue;
    const isNum = (s: string) => /^\d+$/.test(s);
    if (isNum(ai) && isNum(bi)) {
      const diff = Number(ai) - Number(bi);
      if (diff !== 0) return diff;
    } else {
      const cmp = ai.localeCompare(bi, "vi");
      if (cmp !== 0) return cmp;
    }
  }
  return 0;
}

// So sánh dùng chung cho mọi bảng có thể sắp xếp theo cột (bấm tiêu đề đổi
// chiều tăng/giảm) — xem components/ui/SortableTh.tsx. Giá trị null luôn xếp
// CUỐI bất kể chiều tăng/giảm (dữ liệu trống không nên "nhảy lên đầu" khi
// đổi sang giảm dần, dễ gây hiểu nhầm là có giá trị nhỏ nhất).
export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const an = a ?? null;
  const bn = b ?? null;
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  if (typeof an === "number" && typeof bn === "number") return an - bn;
  return naturalCompare(String(an), String(bn));
}
