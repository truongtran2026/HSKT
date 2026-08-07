// Dịch các thông điệp lỗi Postgres/PostgREST hay gặp nhất trong app sang
// tiếng Việt dễ hiểu (Đợt 4 audit, HSKT-audit-2026-08-03.md — người dùng
// không phải lập trình viên, thông điệp gốc kiểu "new row violates row-level
// security policy for table \"circuits\"" không nói lên được PHẢI làm gì).
// Không nhận diện được mẫu nào thì trả nguyên văn — KHÔNG che giấu lỗi lạ,
// chỉ dịch những ca đã biết rõ nguyên nhân.
export function translatePgError(message: string | null | undefined): string {
  if (!message) return "Có lỗi xảy ra, không rõ nguyên nhân.";

  if (/row-level security policy/i.test(message)) {
    return `Bạn không có đủ quyền để thực hiện thao tác này (cần quyền Operator/Admin trở lên) — liên hệ người quản trị nếu cần. (Chi tiết gốc: ${message})`;
  }
  if (/duplicate key value violates unique constraint/i.test(message)) {
    return `Dữ liệu bị trùng — giá trị này đã tồn tại, không thể lưu thêm 1 bản giống hệt. (Chi tiết gốc: ${message})`;
  }
  if (/violates foreign key constraint/i.test(message)) {
    return `Không thể thực hiện vì dữ liệu này đang được dùng/tham chiếu ở chỗ khác trong hệ thống. (Chi tiết gốc: ${message})`;
  }
  if (/JWT expired|invalid JWT|invalid claim/i.test(message)) {
    return `Phiên đăng nhập đã hết hạn — tải lại trang và đăng nhập lại. (Chi tiết gốc: ${message})`;
  }
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
    return `Không kết nối được tới máy chủ — kiểm tra lại mạng rồi thử lại. (Chi tiết gốc: ${message})`;
  }
  return message;
}
