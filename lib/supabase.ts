import { createBrowserClient } from "@supabase/ssr";

// Đợt 3 bảo mật (architecture.md, yêu cầu người dùng 2026-08-06: bật Supabase
// Auth thật, đổi nguyên tắc "không auth ở MVP" cũ trong CLAUDE.md vì lỗ hổng
// bảo mật thật — anon key public + RLS mvp_allow_all cho phép AI CŨNG đọc/
// ghi/xóa toàn bộ CSDL qua REST API, không cần qua app).
//
// Client này giờ CHỈ dùng cho trình duyệt (Client Component, `"use client"`)
// — createBrowserClient (thay cho createClient trơn trước đây) tự đọc/ghi
// phiên đăng nhập qua cookie, để middleware.ts và Server Component (đọc cookie
// qua next/headers) thấy ĐÚNG 1 phiên đó. Đây là lý do phải tách riêng client
// cho Server Component — xem lib/supabase-server.ts (tạo mới mỗi request,
// KHÔNG phải singleton như file này) và scripts/lib/supabaseAdmin.ts (service
// role key, dùng cho script CLI chạy `tsx`, không có cookie/next-headers).
//
// Giữ NGUYÊN tên export `supabase` — mọi Client Component gọi thẳng
// `supabase.from(...)` (9 file: PortTable.tsx, DeviceCircuitList.tsx...)
// không cần sửa gì cho việc đổi này.
//
// Không dùng generic createClient<Database>(...): bản @supabase/postgrest-js
// hiện tại đòi hỏi kiểu schema rất chi tiết (xem lib/database.types.ts), viết
// tay dễ lệch và làm insert/select bị suy nhầm ra "never". Dùng client không
// generic — vẫn chạy đúng, chỉ mất gợi ý kiểu cột theo tên bảng. Các kiểu
// Row/Insert trong database.types.ts vẫn dùng được để khai báo biến tay khi
// cần (vd `const rows: Circuit[] = ...`).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.local.example thành .env.local và điền giá trị từ Supabase Dashboard."
  );
}

// QUAN TRỌNG (phát hiện thực tế 2026-07-26): `export const dynamic =
// "force-dynamic"` ở mỗi trang KHÔNG đủ để tắt cache — Next.js vẫn cache lại
// kết quả gọi supabase-js đầu tiên trong vòng đời server (dev server hay 1
// lambda "ấm" trên Vercel), các request sau nhận y nguyên dữ liệu cũ dù DB đã
// đổi (đã kiểm chứng: thêm dòng mới vào device_position_map, gọi lại trang
// nhiều lần vẫn không thấy — số dòng bảng đứng yên bất kể dữ liệu thật đã
// tăng). Ép fetch riêng của client này luôn "no-store" thì Next.js mới thực
// sự không cache, áp dụng chung cho MỌI bảng, không chỉ device_position_map.
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
