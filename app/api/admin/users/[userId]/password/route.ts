import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdminApi";
import { getSupabaseAdminServer } from "@/lib/supabaseAdminServer";

// Admin đặt lại mật khẩu cho 1 tài khoản CẤP DƯỚI (yêu cầu người dùng
// 2026-08-08 — trước đây Admin không quản lý được mật khẩu của Operator/
// View, phải nhờ chính chủ tài khoản tự đổi ở "/settings"). KHÔNG chặn tự
// đặt lại mật khẩu của chính mình (khác đổi vai trò — không có rủi ro tự
// khóa quyền, admin đã có form đổi mật khẩu riêng ở "/settings" nhưng route
// này vẫn hoạt động đúng nếu gọi cho chính mình).
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { userId } = await params;
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 6) {
    return NextResponse.json({ error: "Mật khẩu cần ít nhất 6 ký tự." }, { status: 400 });
  }

  const admin = getSupabaseAdminServer();
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, { password });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
