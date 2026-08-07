import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Đợt 3 bảo mật (2026-08-06, xem lib/supabase.ts) — chặn MỌI route chưa đăng
// nhập TRƯỚC khi bất kỳ trang nào kịp gọi Supabase, thay vì để từng page tự
// kiểm tra (dễ quên sót 1 trang). Mẫu chuẩn @supabase/ssr cho middleware:
// dựng client bám cookie của CHÍNH request/response này (không phải
// lib/supabase-server.ts — file đó dùng `next/headers` cookies(), chỉ hợp lệ
// trong Server Component/Route Handler, KHÔNG chạy được trong middleware).
//
// Dùng `getUser()` — KHÔNG dùng `getSession()`: getSession() chỉ đọc JWT có
// sẵn trong cookie, KHÔNG xác thực lại với Supabase Auth server (JWT hết hạn/
// bị thu hồi vẫn đọc "có session" như thường) — đây là bẫy đã được chính docs
// Supabase cảnh báo cho middleware. getUser() luôn hỏi lại server, chậm hơn
// 1 chút nhưng đúng.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Ghi lại cookie đã refresh vào CẢ request (để phần code sau trong
        // middleware thấy ngay, dù ở đây không có) LẪN response (để trình
        // duyệt nhận được) — đúng mẫu @supabase/ssr, cần dựng lại response
        // sau khi set cookie vào request.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoginPage = request.nextUrl.pathname === "/login";

  if (!user && !isLoginPage) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  if (user && isLoginPage) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

// Loại trừ static asset/ảnh Next.js và chính /login (tránh redirect loop).
// Chưa có app/api/ nào trong dự án, nhưng để rộng cho an toàn nếu thêm sau.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};
