import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ROLE_LABEL } from "@/lib/roleLabel";
import ChangePasswordForm from "@/components/settings/ChangePasswordForm";
import UserManagementPanel from "@/components/settings/UserManagementPanel";

// Thay PagePlaceholder cũ (Đợt Cài đặt chung, 2026-08-08) — placeholder cũ
// ghi "auth chưa cần ở MVP" đã lỗi thời từ khi bật Supabase Auth thật +
// phân quyền 3 cấp (2026-08-06, xem migration 20260806000001). Trang này lấy
// user y hệt cách app/layout.tsx đang lấy cho Sidebar (không thêm plumbing
// mới) để hiện thông tin tài khoản + form đổi mật khẩu; khối "Quản lý tài
// khoản" chỉ gửi xuống client khi CHÍNH server đã xác nhận role=admin (không
// phải ẩn bằng CSS) — người không phải admin sẽ không nhận được component
// đó trong HTML/RSC payload luôn.
export const dynamic = "force-dynamic";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

export default async function SettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userRole = (user?.app_metadata?.role as string | undefined) ?? null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Cài đặt chung</h1>
        <p className="text-slate-500 mt-1">Thông tin tài khoản, đổi mật khẩu và quản lý quyền truy cập.</p>
      </div>

      <section>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">Tài khoản của bạn</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm max-w-sm space-y-1.5 mb-6">
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Email</span>
            <span className="font-medium text-slate-800">{user?.email ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Vai trò</span>
            <span className="font-medium text-slate-800">
              {userRole ? (ROLE_LABEL[userRole] ?? userRole) : "chưa gán quyền"}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Ngày tạo tài khoản</span>
            <span className="text-slate-700">{formatDateTime(user?.created_at)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-slate-500">Lần đăng nhập gần nhất</span>
            <span className="text-slate-700">{formatDateTime(user?.last_sign_in_at)}</span>
          </div>
        </div>
        <ChangePasswordForm />
      </section>

      {userRole === "admin" && (
        <section>
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Quản lý tài khoản</h2>
          <p className="text-sm text-slate-500 mb-3">
            Danh sách toàn bộ tài khoản đang có trong hệ thống, đổi vai trò hoặc thêm tài khoản mới — không cần chạy
            script CLI nữa.
          </p>
          <UserManagementPanel currentUserId={user!.id} />
        </section>
      )}
    </div>
  );
}
