import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Hồ sơ kỹ thuật",
  description: "Quản lý hồ sơ ODF trung kế & ODF/DDF thiết bị tại trạm VT ADN1",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          {/* min-w-0 bắt buộc — mặc định flex item không co xuống dưới
              chiều rộng NỘI DUNG của nó, nên bảng dài (nhiều cột như
              PortTable/DeviceCircuitList) sẽ đẩy cả trang rộng ra thay vì để
              đúng khung bảng tự cuộn ngang riêng (đã thấy thực tế 2026-07-27:
              thu nhỏ trình duyệt lại làm "ẩn" mất cột bên phải, không cuộn
              được tới). */}
          <main className="min-w-0 flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
