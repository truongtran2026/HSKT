import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Đợt 3 bảo mật (2026-08-06, xem lib/supabase.ts) — client dùng cho SERVER
// COMPONENT / ROUTE HANDLER / SERVER ACTION / middleware.ts, đọc phiên đăng
// nhập qua cookie của CHÍNH request đang xử lý (next/headers `cookies()`).
//
// CỐ Ý không phải singleton/không cache — phải tạo MỚI mỗi lần gọi, vì
// `cookies()` chỉ hợp lệ trong đúng phạm vi 1 request. Nếu lỡ cache lại 1
// instance rồi dùng cho nhiều request khác nhau (vd trên 1 lambda "ấm" của
// Vercel hay dev server), request sau sẽ vô tình dùng NHẦM phiên đăng nhập
// của request trước — đúng lớp lỗi mà lib/supabase.ts đã từng cảnh báo cho
// `fetch` cache (mục no-store ở file đó), lần này là rò rỉ session giữa các
// người dùng/tab khác nhau, nghiêm trọng hơn nhiều so với dữ liệu cache cũ.
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.local.example thành .env.local và điền giá trị từ Supabase Dashboard."
    );
  }

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Gọi trong 1 Server Component render (không phải Route Handler/
        // Server Action) sẽ ném lỗi vì Next.js không cho ghi cookie ở đó —
        // bỏ qua an toàn: middleware.ts đã lo phần refresh token/ghi lại
        // cookie mỗi request rồi, Server Component chỉ cần ĐỌC phiên hiện có.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Bỏ qua — xem giải thích ở trên.
        }
      },
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
