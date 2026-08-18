"use client";

import { useRef } from "react";

// Ô nhập liệu kiểu `.input` (form Thêm/Sửa) kèm nút "×" xóa nhanh — đối
// xứng FilterInput.tsx (ô lọc nhỏ trong bảng) nhưng dùng cho ô nhập liệu cỡ
// thường (yêu cầu người dùng 2026-08-18: "khung thêm dòng mới... có thêm
// nút icon để bỏ lọc hay clear chữ/số trong ô hết để gõ lại cho nhanh").
// Chỉ hiện nút khi ô đang có chữ, bấm xóa sạch + focus lại luôn. `className`
// áp cho DIV BỌC NGOÀI (kiểm soát kích thước/layout, vd "w-auto
// max-w-[220px]") — ô input bên trong luôn `.input` (đã có sẵn `w-full`) để
// lấp đầy đúng khung đã định.
export default function ClearableInput({
  value,
  onChange,
  onBlur,
  placeholder,
  list,
  className = "",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  list?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`relative ${className}`}>
      <input
        ref={inputRef}
        className={`input ${value ? "pr-6" : ""}`}
        list={list}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoFocus={autoFocus}
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
          className="absolute inset-y-0 right-1.5 flex items-center text-slate-400 hover:text-slate-600"
        >
          ×
        </button>
      )}
    </div>
  );
}
