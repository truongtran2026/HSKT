import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdminApi";
import { getSupabaseAdminServer } from "@/lib/supabaseAdminServer";

const VALID_ROLES = ["viewer", "operator", "admin"] as const;
type Role = (typeof VALID_ROLES)[number];

// Danh sách tài khoản — chỉ Admin (requireAdmin kiểm tra qua cookie phiên
// thật trước, không tin tham số nào từ client). perPage cao hơn nhu cầu thật
// nhiều (trạm ADN1 chỉ có vài tài khoản) — tránh phải làm phân trang cho 1
// danh sách nhỏ.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const admin = getSupabaseAdminServer();
  const { data, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) {
    return NextResponse.json({ error: listError.message }, { status: 500 });
  }

  const users = data.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? null,
      role: (u.app_metadata?.role as string | undefined) ?? null,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
    }))
    .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? ""));

  return NextResponse.json({ users });
}

// Thêm tài khoản mới — thay cho việc phải chạy `npm run create-role-accounts`
// thủ công. Dùng đúng cách scripts/create-role-test-accounts.ts đang tạo tài
// khoản test: auth.admin.createUser với app_metadata.role (không phải
// user_metadata — chỉ Admin API mới ghi được, xem migration
// 20260806000001_authenticated_rls.sql).
export async function POST(request: Request) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role as Role | undefined;

  if (!email) return NextResponse.json({ error: "Thiếu email." }, { status: 400 });
  if (password.length < 6) return NextResponse.json({ error: "Mật khẩu cần ít nhất 6 ký tự." }, { status: 400 });
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
  }

  const admin = getSupabaseAdminServer();
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role },
  });
  if (createError) {
    return NextResponse.json({ error: createError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
