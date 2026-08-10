// Bộ icon SVG nhỏ dùng chung cho nút thao tác (yêu cầu người dùng 2026-08-08:
// đổi nút Ghim/Sửa/Xóa/Ack/Cài đặt cột từ chữ sang icon). Vẽ tay bằng SVG
// inline (stroke, không fill) — KHÔNG thêm thư viện icon ngoài (lucide/
// heroicons...), đúng tinh thần "không thêm dependency khi chưa thật cần".
// Mỗi icon nhận `className` để chỉnh cỡ/màu qua Tailwind (mặc định 16x16,
// currentColor — kế thừa màu chữ của nút cha).
type IconProps = { className?: string };

const DEFAULT_CLASS = "h-4 w-4";

export function IconPin({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 17v5" />
      <path d="M9 10.5 7 12h10l-2-1.5V5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1z" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function IconPinOff({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 17v5" />
      <path d="M9 10.5 7 12h10l-2-1.5V5a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1z" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function IconEdit({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  );
}

export function IconTrash({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export function IconCheck({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconGear({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconLink({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <path d="M8 12h8" />
    </svg>
  );
}

export function IconLinkOff({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 17H7A5 5 0 0 1 7 7h1.5" />
      <path d="M15 7h2a5 5 0 0 1 4.24 7.66" />
      <path d="M8 12h2.5" />
      <path d="M13.5 12H16" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export function IconGripVertical({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  );
}

export function IconDownload({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

// Icon "xuất chi tiết NHIỀU rack cùng lúc" (yêu cầu người dùng 2026-08-09) —
// dáng thư mục (đại diện cho nhiều rack/sheet gộp lại) + mũi tên xuống, để
// KHÔNG bị nhầm với IconDownload (mũi tên đơn giản) đã dùng cho nút "Xuất
// Excel" xuất 1 bảng đang xem (ExportExcelButton.tsx) — 2 nút nằm gần nhau ở
// /odf-trunk nhưng làm 2 việc khác nhau (thống kê 1 bảng vs chi tiết nhiều
// rack, mỗi rack 1 sheet).
export function IconFolderDown({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M12 10.5v6" />
      <path d="m9.5 14 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

// 4 icon "sắp xếp biểu đồ Cột" (yêu cầu người dùng 2026-08-09, Dashboard —
// "dùng icon không dùng chữ nhìn rối"). Mỗi icon là 1 tiêu chí sắp xếp khác
// hẳn hình dáng nhau để không nhầm, đều dùng CHUNG với chỉ báo chiều tăng/
// giảm (▲/▼) vẽ ĐÈ LÊN bằng badge riêng ở nơi gọi (xem ColSortButton trong
// DashboardClient.tsx), bản thân icon ở đây không tự vẽ chiều tăng/giảm.
export function IconSortName({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <text x="3" y="10.5" fontSize="9" fontWeight={700} stroke="none" fill="currentColor">
        A
      </text>
      <text x="3" y="21" fontSize="9" fontWeight={700} stroke="none" fill="currentColor">
        Z
      </text>
      <path d="M18 4v14" />
      <path d="m14 14 4 4 4-4" />
    </svg>
  );
}

// "Tổng sợi/port" — dấu # (hash), quen mắt cho "tổng số/đếm".
export function IconSortTotal({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 9h14" />
      <path d="M5 15h14" />
      <path d="M10 3 8 21" />
      <path d="m16 3-2 18" />
    </svg>
  );
}

// "% Đang dùng" — vòng tròn ĐẶC (đầy = đang dùng).
export function IconSortPercentUsed({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="12" cy="12" r="9" />
      <text x="12" y="15.5" fontSize="8.5" fontWeight={700} textAnchor="middle" fill="white" stroke="none">
        %
      </text>
    </svg>
  );
}

// "% Trống" — vòng tròn RỖNG (rỗng = trống), cố ý ĐỐI XỨNG với
// IconSortPercentUsed ở trên để dễ liên tưởng đặc/rỗng ↔ đang dùng/trống.
export function IconSortPercentEmpty({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <text x="12" y="15.5" fontSize="8.5" fontWeight={700} textAnchor="middle" fill="currentColor" stroke="none">
        %
      </text>
    </svg>
  );
}

// Icon "Làm mới dữ liệu" (yêu cầu người dùng 2026-08-10) — 2 mũi tên cong
// vòng tròn, quy ước phổ biến cho "refresh". Dùng với `RefreshButton.tsx`
// (quay khi đang tải qua className `animate-spin` truyền từ nơi gọi).
export function IconRefresh({ className = DEFAULT_CLASS }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 12a9 9 0 0 1 15.5-6.5L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.5L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
