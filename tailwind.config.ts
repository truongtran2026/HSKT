import type { Config } from "tailwindcss";

// Bảng màu "primary" xanh dương sáng theo tông giao diện mẫu "PTools"
// (xem CLAUDE.md mục Giao diện/UX). Dùng primary-* thay vì hardcode blue-*
// trực tiếp trong component, để sau này đổi tông màu chỉ sửa 1 chỗ.
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
