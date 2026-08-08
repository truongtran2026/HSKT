import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// Dùng chung cho MỌI Route Handler dưới app/api/admin/** — xác minh người
// gọi (qua cookie phiên thật, không tin bất kỳ tham số nào từ client) đã
// đăng nhập VÀ có role=admin, TRƯỚC KHI route handler được phép gọi
// lib/supabaseAdminServer.ts (service role key, bỏ qua RLS).
export async function requireAdmin(): Promise<
  { user: { id: string; email?: string }; error?: undefined } | { user?: undefined; error: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Chưa đăng nhập." }, { status: 401 }) };
  }
  const role = (user.app_metadata?.role as string | undefined) ?? null;
  if (role !== "admin") {
    return { error: NextResponse.json({ error: "Cần quyền Admin để thực hiện thao tác này." }, { status: 403 }) };
  }
  return { user: { id: user.id, email: user.email } };
}
