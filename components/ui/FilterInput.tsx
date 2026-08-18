"use client";

import { useRef } from "react";

// Ô lọc nhỏ đặt ngay dưới tiêu đề cột — mỗi cột lọc riêng, gõ nhiều ô cùng
// lúc = lọc AND (khớp hết mọi ô đã gõ). Dùng chung cho mọi bảng dữ liệu, và
// cho ô gõ tìm trong GroupedMultiSelect/SearchableSelect.
//
// Nút "×" xóa nhanh (yêu cầu người dùng 2026-08-18: "có thêm nút icon để bỏ
// lọc hay clear chữ/số trong ô hết để gõ lại cho nhanh... khung multiple
// select... gõ từ khóa để lọc cũng phải có icon để bỏ lọc") — chỉ hiện khi
// ô đang có chữ, bấm xóa sạch + focus lại luôn (đỡ phải tự bấm lại vào ô để
// gõ tiếp). Dùng CHUNG đúng 1 chỗ này nên tự động áp dụng cho MỌI nơi đang
// dùng FilterInput (cột lọc bảng, ô tìm trong GroupedMultiSelect).
export default function FilterInput({
  value,
  onChange,
  align = "left",
  placeholder = "Lọc...",
  autoFocus = false,
}: {
  value: string;
  onChange: (v: string) => void;
  align?: "left" | "right";
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={`w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-xs font-normal text-slate-700 focus:border-primary-400 focus:outline-none ${
          value ? "pr-5" : ""
        } ${align === "right" ? "text-right" : "text-left"}`}
      />
      {value && (
        <button
          type="button"
          tabIndex={-1}
          title="Xóa"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          className="absolute inset-y-0 right-0.5 flex items-center px-1 text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
    </div>
  );
}
