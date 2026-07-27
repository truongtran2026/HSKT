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

// Tách "cấu trúc 2" của cột Chuyển tiếp (yêu cầu người dùng 2026-07-27):
// "<tọa độ ODF> - <thiết bị>(<port>)", vd "ODF7/4/17,18 - ADN1.PE2 (et-13/0/0)".
// Khảo sát thật 503 dòng transit_links: 297 dòng khớp mẫu này ("cấu trúc 1" —
// chỉ có 1 trong 2 phần, hoặc thứ tự ngược lại, hoặc text tự do khác — CHƯA
// xét ở đây, cứ để matched=false).
//
// Neo vào " - " có khoảng trắng 2 bên (KHÔNG khớp dấu "-" dính liền trong tên
// như "S2-5" hay "ADN1_NPB-CGS...") NGAY TRƯỚC cụm cuối chuỗi dạng "tên(port)"
// — dùng (.+) GREEDY ở phần đầu để luôn bắt đúng dấu " - " CUỐI CÙNG trước
// cụm (port) kết thúc chuỗi, dù phần tọa độ ODF phía trước có dấu ngoặc/gạch
// ngang riêng của nó (vd "ODF 11/3 (09,10) - ...").
export interface OdfDeviceSplit {
  raw: string;
  matched: boolean;
  odfPart?: string;
  /** Ghép sẵn "device (port)" — đưa thẳng vào parseTransitText() để tách tiếp station/device/port. */
  devicePortText?: string;
}

const ODF_DEVICE_SPLIT_PATTERN = /^(.+)\s-\s([^()]+?)\s*\(([^()]+)\)\s*$/;

export function splitOdfDeviceStructure(raw: string): OdfDeviceSplit {
  const trimmed = raw.trim();
  const match = trimmed.match(ODF_DEVICE_SPLIT_PATTERN);
  if (!match) return { raw, matched: false };

  const [, odfPart, deviceName, port] = match;
  return {
    raw,
    matched: true,
    odfPart: odfPart.trim(),
    devicePortText: `${deviceName.trim()} (${port.trim()})`,
  };
}
