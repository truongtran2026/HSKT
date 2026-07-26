import { createClient } from "@supabase/supabase-js";

// MVP giai đoạn 1 = single-user, chưa bật Supabase Auth/RLS (architecture.md
// mục 2). Vì vậy 1 client dùng anon key là đủ cho cả Server Component lẫn
// Client Component — không cần phân biệt client/server helper riêng như khi
// có phiên đăng nhập (đó là việc của giai đoạn 2 khi bật Auth, lúc đó sẽ cần
// @supabase/ssr để đọc cookie phiên).
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
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});
