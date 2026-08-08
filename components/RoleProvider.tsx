"use client";

import { createContext, useContext } from "react";

// Đưa `userRole` mà app/layout.tsx đã tính SẴN ở Server Component (đọc từ
// user.app_metadata.role qua cookie phiên) xuống cho mọi Client Component
// con, KHÔNG gọi lại Supabase phía trình duyệt — tránh round-trip mạng thừa
// và tránh nháy nút (flash hiện rồi ẩn) trước khi biết role. Chỉ để ẨN/HIỆN
// nút ở UI (xem components/ui/RoleGate.tsx) — RLS ở CSDL mới là nơi chặn
// thật, y hệt tinh thần badge role ở components/Sidebar.tsx.
const RoleContext = createContext<string | null>(null);

export default function RoleProvider({ role, children }: { role: string | null; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useRole(): string | null {
  return useContext(RoleContext);
}
