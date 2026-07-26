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
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
