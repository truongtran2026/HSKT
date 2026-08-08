"use client";

import { useRole } from "@/components/RoleProvider";

// Ẩn hẳn (không phải disable+tooltip) các nút Thêm/Sửa/Xóa mà role hiện tại
// không được phép — đúng ranh giới đã có sẵn ở RLS (xem
// supabase/migrations/20260806000001_authenticated_rls.sql):
//   allow=["operator","admin"]  → Thêm/Sửa, và Xóa từng luồng/liên kết
//   allow=["admin"]             → Xóa cả rack/thiết bị
// role null (chưa gán quyền) luôn bị coi như KHÔNG đủ quyền, kể cả khi
// allow chứa "viewer" — an toàn hơn là mặc định cho qua.
export default function RoleGate({ allow, children }: { allow: string[]; children: React.ReactNode }) {
  const role = useRole();
  if (!role || !allow.includes(role)) return null;
  return <>{children}</>;
}
