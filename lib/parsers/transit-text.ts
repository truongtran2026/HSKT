// Parser cho text dạng "STATION.DEVICE(COORD)" (architecture.md mục 3.6, 3.7,
// 4.1) — dùng khi nhập transit_links (cột "Chuyển tiếp" bên ODF trung kế) và
// từ 2026-07-26 dùng thêm cho ô "Đối phương" bên luồng thiết bị (xem
// DeviceCircuitList.tsx maybeCreateCounterpartDevice).
//
// Đây là bước "cố gắng nhận diện" — KHÔNG tự quyết định lưu gì. Theo đúng
// mục 3.7: nếu match được thiết bị thuộc ADN1, UI phải HỎI XÁC NHẬN trước
// khi tạo devices/transit_links mới, chưa tự tạo ngầm ở lớp parser này.
//
// Regex đã tinh chỉnh lại theo dữ liệu ADN1 thật (2026-07-26) — bản đầu giả
// định tên thiết bị không có khoảng trắng/dấu "#" nên KHÔNG khớp được các
// tên thật kiểu "PSS24X#3 BB1" (có "#" và khoảng trắng trước dấu "("). Dùng
// non-greedy + \s* trước "(" để bắt đúng phần thiết bị dù có khoảng trắng.

export interface ParsedTransitTarget {
  /** Toàn bộ text gốc, luôn giữ lại để không mất dữ liệu (raw_text). */
  raw: string;
  /** true nếu regex nhận diện được đúng dạng STATION.DEVICE(COORD). */
  matched: boolean;
  stationCode?: string;
  deviceName?: string;
  coordinateText?: string;
}

const TRANSIT_PATTERN = /^([A-Za-z0-9]+)\.(.+?)\s*\(([^)]+)\)\s*$/;

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
