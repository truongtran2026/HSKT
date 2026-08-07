// Khung "Thao tác nguy hiểm" dùng chung (Đợt 3.3 audit, HSKT-audit-2026-08-03.md
// — nút xóa cả rack/thiết bị đứng lẫn với thao tác thường dễ bấm nhầm). Dùng
// <details> gốc trình duyệt (thu gọn mặc định) thay vì tự viết state mở/đóng
// — không cần "use client", không cần JS, vẫn hoạt động cả trong Server
// Component.
export default function DangerZone({
  title = "Thao tác nguy hiểm",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <details className="mt-4 rounded-lg border border-red-200 bg-red-50/60 p-3">
      <summary className="cursor-pointer text-sm font-medium text-red-700">⚠️ {title}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
