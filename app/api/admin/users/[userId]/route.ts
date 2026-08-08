import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/requireAdminApi";
import { getSupabaseAdminServer } from "@/lib/supabaseAdminServer";

const VALID_ROLES = ["viewer", "operator", "admin"] as const;
type Role = (typeof VALID_ROLES)[number];

// Đổi vai trò 1 tài khoản. CHẶN đổi vai trò của CHÍNH người đang gọi API này
// — tránh tự khóa quyền admin của mình do bấm nhầm (vd chỉ còn 1 admin, tự
// đổi mình xuống viewer thì không còn ai vào lại được trang này để đổi ngược
// lại, phải sửa tay qua Supabase Dashboard). Muốn đổi vai trò của chính
// mình thì phải nhờ 1 tài khoản admin KHÁC, hoặc vào thẳng Dashboard.
export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { user, error } = await requireAdmin();
  if (error) return error;

  const { userId } = await params;
  if (userId === user.id) {
    return NextResponse.json({ error: "Không thể tự đổi vai trò của chính tài khoản đang đăng nhập." }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const role = body?.role as Role | undefined;
  if (!role || !VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: "Vai trò không hợp lệ." }, { status: 400 });
  }

  const admin = getSupabaseAdminServer();
  // Merge với app_metadata hiện có (không chỉ ghi đè role) — updateUserById
  // thay THẲNG object app_metadata, không tự gộp; hiện tại chỉ có mỗi field
  // role nhưng gộp để không lỡ mất field khác nếu sau này thêm.
  const { data: existing, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError || !existing.user) {
    return NextResponse.json({ error: getError?.message ?? "Không tìm thấy tài khoản." }, { status: 404 });
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { ...existing.user.app_metadata, role },
  });
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
