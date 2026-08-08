import type { Metadata } from "next";

// app/login/page.tsx là Client Component ("use client") — không tự export
// `metadata` được (chỉ Server Component mới export được), nên tách riêng 1
// layout Server Component chỉ để khai báo tiêu đề tab (yêu cầu người dùng
// 2026-08-08 — xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Đăng nhập" };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
