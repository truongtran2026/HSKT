import { normalizeVN } from "../text";

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
//
// Nới lỏng thêm lần nữa (2026-07-27) sau khi khảo sát thật ô "Đối phương":
// đa số dòng thuộc ADN1 được gõ "AĐN1." (có dấu Đ) chứ không phải "ADN1." —
// ký tự "Đ" nằm ngoài [A-Za-z0-9] nên bản cũ KHÔNG MATCH ĐƯỢC GÌ CẢ (không
// phải nhận nhầm trạm khác) cho 1153/1923 dòng, kể cả 38/503 dòng
// transit_links bên trung kế. Đổi mã trạm thành "mọi ký tự trừ dấu chấm/
// khoảng trắng/ngoặc mở, tới dấu chấm đầu tiên" — chấp nhận bất kỳ biến thể
// gõ dấu nào (không chỉ riêng "Đ"), rồi so khớp qua normalizeVN() bên dưới.
const TRANSIT_PATTERN = /^([^.\s(]+)\.(.+?)\s*\(([^)]+)\)\s*$/;

export interface ParsedTransitTarget {
  /** Toàn bộ text gốc, luôn giữ lại để không mất dữ liệu (raw_text). */
  raw: string;
  /** true nếu regex nhận diện được đúng dạng STATION.DEVICE(COORD). */
  matched: boolean;
  stationCode?: string;
  deviceName?: string;
  coordinateText?: string;
}

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
 *
 * Dùng normalizeVN (bỏ dấu, hạ chữ thường) thay vì so sánh chuỗi thô — dữ
 * liệu thật gõ cả "ADN1" lẫn "AĐN1" (dấu Đ) cho cùng 1 trạm (xem
 * TRANSIT_PATTERN ở trên), 2 cách viết phải được coi là MỘT.
 */
export function isManagedStationCode(stationCode: string): boolean {
  return normalizeVN(stationCode.trim()) === "adn1";
}

// Tách "cấu trúc 2" của cột Chuyển tiếp (yêu cầu người dùng 2026-07-27):
// "<tọa độ ODF> - <thiết bị>(<port>)", vd "ODF7/4/17,18 - ADN1.PE2 (et-13/0/0)".
// Khảo sát thật 503 dòng transit_links: 297 dòng khớp mẫu này ("cấu trúc 1" —
// chỉ có 1 trong 2 phần, hoặc thứ tự ngược lại, hoặc text tự do khác — CHƯA
// xét ở đây, cứ để matched=false).
//
// Neo vào " - " có khoảng trắng 2 bên (KHÔNG khớp dấu "-" dính liền trong tên
// như "S2-5" hay "ADN1_NPB-CGS...") NGAY SAU tọa độ ODF ở đầu chuỗi — dùng
// (.+?) LAZY ở phần đầu để bắt đúng dấu " - " ĐẦU TIÊN, dừng lại ngay khi
// phần còn lại đã khớp được "tên(port)" ở cuối chuỗi.
//
// Đổi từ GREEDY sang LAZY (2026-07-27) sau khi phát hiện thật: tên tuyến cáp
// trung kế (racks.cable_route_name) rất hay có dạng "96FO#1 ADN1 - 2T9" —
// TỰ NÓ đã chứa " - " (khảo sát thật: 19/30 tên tuyến cáp thật ở ADN1 có dấu
// này). Với bản GREEDY cũ, chuỗi ghép "ODF1/1 (01,02) - 96FO#1 ADN1 - 2T9
// (1,2)" (tính năng "Cáp quang (tiếp theo)") sẽ bị tách SAI — nuốt luôn nửa
// đầu tên tuyến cáp vào phần tọa độ ODF, vì (.+) greedy luôn neo vào dấu " - "
// CUỐI CÙNG. Đã kiểm tra thật 503 dòng transit_links + 2222 dòng
// device_position_next: đổi sang LAZY không phá ca nào đang chạy đúng (không
// có tọa độ ODF nào tự chứa " - " ở dữ liệu thật hiện có).
export interface OdfDeviceSplit {
  raw: string;
  matched: boolean;
  odfPart?: string;
  /** Ghép sẵn "device (port)" — đưa thẳng vào parseTransitText() để tách tiếp station/device/port. */
  devicePortText?: string;
  /** Tên thiết bị đứng riêng (KHÔNG có tiền tố trạm) — dùng khi thiết bị đích
   *  là node local, không cần parseTransitText (xem DeviceCircuitList.tsx
   *  "Thiết bị/Trib (tiếp theo)", thêm 2026-07-27). */
  deviceName?: string;
  /** Port/trib đứng riêng, cùng nguồn với devicePortText. */
  port?: string;
}

const ODF_DEVICE_SPLIT_PATTERN = /^(.+?)\s-\s([^()]+?)\s*\(([^()]+)\)\s*$/;

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
    deviceName: deviceName.trim(),
    port: port.trim(),
  };
}

// Chiều ngược lại của splitOdfDeviceStructure — ghép 3 ô rời (Vị trí ODF /
// Thiết bị / Trib "tiếp theo", xem DeviceCircuitList.tsx) thành lại ĐÚNG 1
// chuỗi lưu vào circuits.device_position_next (KHÔNG đổi schema — vẫn 1 cột
// text như architecture.md mục 3.4, chỉ tách 3 ô ở tầng UI/edit, giống hệt
// cách "Chuyển tiếp" bên trung kế đã làm). Yêu cầu người dùng 2026-07-27.
//
// Quy tắc ghép (dữ liệu thật device_position_next trước đây 100% chỉ là tọa
// độ ODF trơn, không kèm thiết bị — nên phải cho phép để trống Thiết bị/Trib
// mà vẫn hợp lệ):
//   - Cả 3 trống -> ""
//   - Chỉ có odfPart -> giữ nguyên "odfPart" (đúng dạng cũ, không ép phải có
//     thiết bị/trib)
//   - Có đủ odfPart + deviceName + trib -> "odfPart - deviceName (trib)"
//   - Có odfPart nhưng CHỈ 1 trong 2 (deviceName/trib) -> bỏ qua phần thiết
//     bị/trib (chưa đủ để ghép có ý nghĩa, tránh sinh chuỗi què như
//     "ODF... - (12)" hoặc "ODF... - PE2 ()")
export function combinePositionNext(odfPart: string, deviceName: string, trib: string): string {
  const odf = odfPart.trim();
  const device = deviceName.trim();
  const port = trib.trim();
  if (!odf) return device && port ? `${device} (${port})` : "";
  if (device && port) return `${odf} - ${device} (${port})`;
  return odf;
}
