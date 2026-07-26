/** @type {import('next').NextConfig} */
const nextConfig = {
  // Không cần cấu hình đặc biệt ở MVP — Supabase gọi thẳng từ client/server
  // component qua @supabase/supabase-js, không có backend riêng để proxy qua.
  reactStrictMode: true,
};

export default nextConfig;
