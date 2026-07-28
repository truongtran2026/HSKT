// Mã rack dạng "ODF{a}/{b}" (b có thể có phần thập phân như "7.1") — sắp xếp
// theo SỐ chứ không theo chuỗi ký tự, để "ODF1/2" đứng trước "ODF1/10" (chuỗi
// ký tự sẽ xếp "1/10" trước "1/2" — sai với thứ tự người dùng cần).
// Dùng chung cho danh sách rack (RackListTable) và trang tìm kiếm (search).
export function parseRackCode(code: string): [number, number] {
  const m = code.match(/^ODF(\d+)\/(\d+(?:\.\d+)?)/);
  if (!m) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  return [Number(m[1]), Number(m[2])];
}

export function compareRackCode(a: string, b: string): number {
  const [a1, a2] = parseRackCode(a);
  const [b1, b2] = parseRackCode(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a.localeCompare(b);
}

// Chèn khoảng trắng CHỈ lúc hiển thị ("ODF1/15" -> "ODF 1/15") — KHÔNG sửa
// racks.code gốc trong DB (đã khảo sát + quyết định giữ nguyên không khoảng
// cách cho toàn bộ rack thật, xem architecture.md mục 7 và formatCanonical
// OdfPosition() trong lib/trunkPorts.ts dùng cùng quy tắc này cho chuỗi
// "Chuyển tiếp"/"Vị trí ODF"). Dùng ở RackListTable/RackHeader để mã rack
// hiện ra đúng chuẩn người dùng quen nhìn ("ODF 1/15") thay vì dính liền.
export function formatRackCodeDisplay(code: string): string {
  return code.replace(/^ODF(?!\s)/, "ODF ");
}
