import { createClient } from "@supabase/supabase-js";

// Client dùng CHUNG cho mọi script CLI (chạy `tsx`, không có next/headers,
// không có phiên đăng nhập trình duyệt) — service role key, bỏ qua RLS hoàn
// toàn (đúng và cần thiết cho script quản trị/audit chạy tay). Trước Đợt 3
// mỗi script tự dựng client này riêng lẻ (xem fix-100g-label.ts và các script
// khác) — nay gom về 1 hàm để không lặp lại, và vì các hàm dùng chung trong
// lib/*.ts giờ đòi hỏi tham số `client` bắt buộc (Đợt 3, xem lib/supabase.ts),
// script cần 1 chỗ để lấy client hợp lệ truyền vào.
//
// LƯU Ý: hàm gọi Ở ĐÂU thì `loadEnv()` (dotenv) của CHÍNH script đó phải đã
// chạy TRƯỚC khi module này được import — đúng bẫy đã ghi nhiều nơi trong dự
// án (vd scripts/sync-missing-trunk-circuits.ts): dùng `await import(...)`
// động cho module này bên trong `main()`, không import tĩnh ở đầu file.
export function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  }
  return createClient(supabaseUrl, key);
}
