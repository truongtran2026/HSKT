"use client";

// Ô lọc dạng CHỌN SẴN (dropdown) thay vì gõ chữ — dùng cho cột chỉ có vài
// giá trị rời rạc cố định (yêu cầu người dùng 2026-08-08, cột "Trạng thái"
// liên kết: "mỗi lần phải gõ chữ" bất tiện, "cho tôi chọn đi cho nhanh").
// Cùng vị trí/kích thước với FilterInput (đặt ngay dưới tiêu đề cột trong
// DataTh) để không lệch hàng với các ô lọc chữ ở cột khác.
export default function FilterSelect({
  value,
  onChange,
  options,
  allLabel = "Tất cả",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border border-slate-200 bg-white px-1 py-1 text-xs font-normal text-slate-700 focus:border-primary-400 focus:outline-none"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
