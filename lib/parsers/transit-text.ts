// Parser cho cột "Chuyển tiếp" trong Excel gốc, dùng khi nhập transit_links
// (architecture.md mục 3.6, 3.7, 4.1). Định dạng gốc: "STATION.DEVICE(COORD)"
// vd "ADN1.OTS2(1-3-3)" -> station=ADN1, device=OTS2, coord="1-3-3".
//
// Đây là bước "cố gắng nhận diện" — KHÔNG tự quyết định lưu gì. Theo đúng
// mục 3.7: nếu match được thiết bị thuộc ADN1, UI phải HỎI XÁC NHẬN trước
// khi tạo devices/transit_links mới, chưa tự tạo ngầm ở lớp parser này.
//
// Ghi chú quan trọng: regex bên dưới dựa trên MÔ TẢ định dạng trong
// architecture.md, chưa được đối chiếu với dữ liệu Excel ADN1 thật (file
// gốc chưa có trên máy tại thời điểm viết). Khi có file thật ở giai đoạn 2,
// cần chạy thử trên toàn bộ cột "Chuyển tiếp" thật và tinh chỉnh lại.

export interface ParsedTransitTarget {
  /** Toàn bộ text gốc, luôn giữ lại để không mất dữ liệu (raw_text). */
  raw: string;
  /** true nếu regex nhận diện được đúng dạng STATION.DEVICE(COORD). */
  matched: boolean;
  stationCode?: string;
  deviceName?: string;
  coordinateText?: string;
}

const TRANSIT_PATTERN = /^([A-Za-z0-9._]+)\.([A-Za-z0-9\-/]+)\(([^)]+)\)$/;

export function parseTransitText(raw: string): ParsedTransitTarget {
  const trimmed = raw.trim();
  const match = trimmed.match(TRANSIT_PATTERN);

  if (!match) {
    return { raw, matched: false };
  }

  const [, stationCode, deviceName, coordinateText] = match;
  return {
    raw,
    matched: true,
    stationCode,
    deviceName,
    coordinateText,
  };
}

/**
 * Trạm nào được tự tạo `devices` khi parse thành công.
 * Theo mục 3.7 & mục 1: CHỈ ADN1 được quản lý chặt — trạm khác (kể cả 2T9)
 * dù match được regex vẫn KHÔNG tạo devices, chỉ giữ raw_text.
 */
export function isManagedStationCode(stationCode: string): boolean {
  return stationCode.trim().toUpperCase() === "ADN1";
}
