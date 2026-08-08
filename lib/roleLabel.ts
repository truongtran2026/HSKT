// Nhãn hiển thị cho 3 cấp quyền (viewer/operator/admin) — tách ra từ
// components/Sidebar.tsx (Đợt Cài đặt chung, 2026-08-08) để dùng chung với
// app/settings/page.tsx, tránh định nghĩa lặp lại ở 2 nơi.
export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "Viewer (chỉ xem)",
};
