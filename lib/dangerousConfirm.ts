// Xác nhận gõ chữ cho thao tác xóa HÀNG LOẠT (Đợt 3.4 audit, HSKT-audit-2026-08-03.md
// — xóa nhầm hàng loạt khó hoàn tác hơn xóa 1 dòng, nên cần rào chắn mạnh hơn
// `confirm()` OK/Cancel thường, vốn chỉ cần 1 cú Enter là qua). Giới hạn 20
// dòng/lần buộc chia nhỏ thao tác, giảm thiệt hại nếu chọn nhầm cả bảng.
// CHỈ dùng cho các nút "Xóa đã chọn" (bulk) — nút xóa từng dòng đơn lẻ vẫn
// giữ `confirm()` thường như trước, không đổi.
export function confirmBulkDelete(message: string, count: number, maxRows = 20): boolean {
  if (count > maxRows) {
    alert(`Chỉ xóa tối đa ${maxRows} dòng một lần (đang chọn ${count}) — bỏ bớt lựa chọn rồi thử lại.`);
    return false;
  }
  const typed = window.prompt(`${message}\n\nGõ "XÓA" (không dấu ngoặc) để xác nhận:`);
  return typed?.trim().toUpperCase() === "XÓA";
}
