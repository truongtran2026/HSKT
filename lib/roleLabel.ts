// Nhãn hiển thị cho 3 cấp quyền (viewer/operator/admin) — tách ra từ
// components/Sidebar.tsx (Đợt Cài đặt chung, 2026-08-06) để dùng chung với
// app/settings/page.tsx, tránh định nghĩa lặp lại ở 2 nơi.
//
// "View" thay "Viewer" (yêu cầu người dùng 2026-08-08: "không dùng khái niệm
// viewer") — CHỈ đổi chữ hiển thị ở đây, giá trị `"viewer"` lưu thật trong
// app_metadata.role/RLS/API GIỮ NGUYÊN (đổi cả giá trị đó rủi ro cao hơn
// nhiều — đụng migration + tài khoản đã tạo, người dùng chọn không làm).
export const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  operator: "Operator",
  viewer: "View (chỉ xem)",
};
