import { createClient } from "@supabase/supabase-js";

// Bản dùng trong RUNTIME Next.js của scripts/lib/supabaseAdmin.ts (client CLI
// dùng `tsx` — xem file đó). Đây là LẦN ĐẦU TIÊN service role key được dùng
// trong app runtime (Đợt Cài đặt chung, 2026-08-08, tính năng "Quản lý tài
// khoản") — service role key BỎ QUA TOÀN BỘ RLS.
//
// CHỈ được import từ Route Handler (app/api/**/route.ts) — KHÔNG BAO GIỜ từ
// "use client" hay render trực tiếp cho browser. Route Handler gọi hàm này
// PHẢI tự xác minh người gọi đã đăng nhập VÀ có role=admin (qua cookie phiên
// thật, lib/supabase-server.ts) TRƯỚC KHI gọi hàm này — hàm này tự nó không
// kiểm tra quyền gì cả, chỉ trả về 1 client có toàn quyền.
export function getSupabaseAdminServer() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  }
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
