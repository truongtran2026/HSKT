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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
