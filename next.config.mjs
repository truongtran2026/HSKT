/** @type {import('next').NextConfig} */
const nextConfig = {
  // Không cần cấu hình đặc biệt ở MVP — Supabase gọi thẳng từ client/server
  // component qua @supabase/supabase-js, không có backend riêng để proxy qua.
  reactStrictMode: true,
  // Tắt Router Cache phía CLIENT cho mọi trang (2026-08-17, người dùng báo:
  // sửa xong ở Thư viện vị trí thiết bị, chuyển tab Sidebar sang Hồ sơ đấu
  // nối vẫn thấy dữ liệu cũ) — mặc định Next.js 14 giữ RSC payload đã tải
  // ~30s trong bộ nhớ trình duyệt cho MỌI điều hướng qua <Link>/router.push,
  // BẤT KỂ trang đó đã khai báo `dynamic = "force-dynamic"` ở server hay
  // chưa (cờ đó chỉ tắt cache PHÍA SERVER, không tắt cache phía client này).
  // Toàn bộ trang trong app đều là dữ liệu Supabase sống, không trang nào
  // cần cache điều hướng — đặt dynamic:0 để LUÔN tải lại RSC mới nhất khi
  // chuyển trang, không ảnh hưởng router.refresh()/RefreshButton (đã dùng
  // riêng cho case đa-tab/đa-trình-duyệt, vẫn hoạt động như cũ).
  experimental: {
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
