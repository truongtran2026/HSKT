import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import CommandPalette from "@/components/ui/CommandPalette";
import PageLoadTimer from "@/components/ui/PageLoadTimer";
import RoleProvider from "@/components/RoleProvider";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const metadata: Metadata = {
  title: "Hồ sơ kỹ thuật",
  description: "Quản lý hồ sơ ODF trung kế & ODF/DDF thiết bị tại trạm VT ADN1",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Đợt 3 bảo mật (2026-08-06) — chỉ để HIỂN THỊ email trong Sidebar, không
  // phải chốt chặn bảo mật (middleware.ts mới là nơi chặn thật). Ở /login
  // luôn null (chưa đăng nhập được vào đó), Sidebar tự hiện "—".
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // app_metadata (không phải user_metadata) — chỉ Admin API/Dashboard sửa
  // được, không tự sửa được từ chính người dùng, xem migration
  // 20260806000001_authenticated_rls.sql. Có thể null nếu tài khoản chưa
  // được gán role (vd tài khoản admin đầu tiên trước khi chạy câu lệnh gán
  // tay ở cuối migration đó) — Sidebar tự hiện "chưa gán quyền" cho ca này.
  const userRole = (user?.app_metadata?.role as string | undefined) ?? null;

  return (
    <html lang="vi">
      <body>
        {/* RoleProvider bọc TOÀN BỘ (kể cả Sidebar) — chuẩn bị sẵn cho lúc
            Sidebar cũng cần useRole() sau này, và để useRole() dùng được ở
            bất kỳ Client Component nào trong cây, không riêng <main>. */}
        <RoleProvider role={userRole}>
          <div className="flex min-h-screen">
            <Sidebar userEmail={user?.email ?? null} userRole={userRole} />
            {/* min-w-0 bắt buộc — mặc định flex item không co xuống dưới
                chiều rộng NỘI DUNG của nó, nên bảng dài (nhiều cột như
                PortTable/DeviceCircuitList) sẽ đẩy cả trang rộng ra thay vì để
                đúng khung bảng tự cuộn ngang riêng (đã thấy thực tế 2026-07-27:
                thu nhỏ trình duyệt lại làm "ẩn" mất cột bên phải, không cuộn
                được tới). */}
            <main className="min-w-0 flex-1 p-8">{children}</main>
          </div>
          {/* Mount 1 lần duy nhất ở đây để có mặt trên MỌI trang — Cmd/Ctrl+K
              mở được dù đang ở trang nào, không phải thêm lại ở từng page.tsx. */}
          <CommandPalette />
          <PageLoadTimer />
        </RoleProvider>
      </body>
    </html>
  );
}
