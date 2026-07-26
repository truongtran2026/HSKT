"use client";

// Ô lọc nhỏ đặt ngay dưới tiêu đề cột — mỗi cột lọc riêng, gõ nhiều ô cùng
// lúc = lọc AND (khớp hết mọi ô đã gõ). Dùng chung cho mọi bảng dữ liệu.
export default function FilterInput({
  value,
  onChange,
  align = "left",
  placeholder = "Lọc...",
}: {
  value: string;
  onChange: (v: string) => void;
  align?: "left" | "right";
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-normal text-slate-700 focus:border-primary-400 focus:outline-none ${
        align === "right" ? "text-right" : "text-left"
      }`}
    />
  );
}
