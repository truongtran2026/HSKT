// Chuẩn hóa text tiếng Việt (bỏ dấu, hạ chữ thường) để so khớp mờ khi tìm
// kiếm — cho phép gõ "tang 12" vẫn tìm ra "Tầng 12".
export function normalizeVN(s: string): string {
  return s
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[đĐ]/g, "d")
    .replace(/[ưƯ]/g, "u")
    .replace(/[ơƠ]/g, "o")
    .toLowerCase();
}

// Định nghĩa "đường dự phòng" theo quy ước đặt tên thật của người dùng: tên
// luồng bắt đầu bằng "DP" (kể cả "DP1", "DP2", "DP.", "DP " ...) hoặc có chứa
// chữ "dự phòng" ở bất kỳ đâu trong tên — KHÔNG dùng cột circuits.circuit_role
// vì cột đó đang được suy ra từ tên RACK (import-legacy.ts: isStandbyRack),
// sai lệch nhiều so với thực tế (kiểm tra thật: chỉ 14/1774 luồng có
// circuit_role='standby' trong khi có tới 103 luồng khớp quy ước tên "DP"
// thật của người dùng).
export function isStandbyCircuitName(name: string): boolean {
  const trimmed = name.trim();
  if (/^DP(\s|\d|\.|$)/i.test(trimmed)) return true;
  return normalizeVN(name).includes("du phong");
}
