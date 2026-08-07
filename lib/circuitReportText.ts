import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { matchBareTrunkLink, matchTrunkPosition, type TrunkPortRow } from "@/lib/trunkPorts";

// Sinh đoạn text mô tả toàn tuyến 1 luồng theo đúng cú pháp viết tay người
// dùng dùng để báo cáo lãnh đạo (yêu cầu 2026-08-07) — tick 1 luồng ở Hồ sơ
// ODF trung kế HOẶC Hồ sơ đấu nối là ra ngay đoạn text này, không cần gõ tay.
// 2 hàm build*() ở đây là pure function (không đụng Supabase/React) — dễ test
// tay bằng đúng ví dụ người dùng đưa trước khi lắp vào UI, xem
// scripts/_tmp-test-report-text.ts lúc phát triển (đã xóa sau khi khớp).

// Chỉ ghi thêm "(sợi a,b)" khi fiber KHÁC port — đúng quy ước đã có sẵn ở
// components/odf-trunk/PortTable.tsx (dòng ~1899: `fiberNumber != null &&
// fiberNumber !== portNumber`). Viết thành hàm dùng chung ở đây thay vì lặp
// lại logic tại nhiều nơi.
function fiberSuffix(portNumbers: number[], fiberNumbers: (number | null)[]): string {
  if (portNumbers.length === 0 || portNumbers.length !== fiberNumbers.length) return "";
  const allSameOrNull = fiberNumbers.every((f, i) => f == null || f === portNumbers[i]);
  if (allSameOrNull) return "";
  if (fiberNumbers.some((f) => f == null)) return "";
  return ` (sợi ${fiberNumbers.join(",")})`;
}

// "ODF x/y (a,b)" — chỉ vị trí + số port, không kèm tuyến cáp/sợi (dùng
// `formatCanonicalOdfPosition`-style padding: 1 port thì không đệm số 0, từ 2
// port trở lên đệm 2 chữ số, đúng quy ước đã có ở lib/trunkPorts.ts).
function odfPositionOnly(rackCode: string, portNumbers: number[]): string {
  const spacedRackCode = rackCode.replace(/^ODF(?!\s)/, "ODF ");
  const portText = portNumbers.length === 1 ? String(portNumbers[0]) : portNumbers.map((p) => String(p).padStart(2, "0")).join(",");
  return `${spacedRackCode} (${portText})`;
}

// Vị trí + tuyến cáp (nếu có) + sợi (nếu KHÁC port) — thứ tự đúng quy ước
// dữ liệu thật đang lưu: "ODF x/y (port) - tên tuyến cáp (sợi)".
function odfLabelWithCable(rackCode: string, portNumbers: number[], fiberNumbers: (number | null)[], cableRouteName: string | null): string {
  const base = odfPositionOnly(rackCode, portNumbers);
  const cableSuffix = cableRouteName ? ` - ${cableRouteName}` : "";
  return `${base}${cableSuffix}${fiberSuffix(portNumbers, fiberNumbers)}`;
}

// ============================================================================
// 1. Hồ sơ ODF trung kế — đứng ở 1 port/nhóm port cụ thể của 1 rack trung kế.
// ============================================================================
export interface TrunkPortReportInput {
  rackCode: string;
  rackCableRouteName: string | null;
  portNumbers: number[];
  fiberNumbers: (number | null)[];
  circuitName: string;
  counterpartText: string | null;
  /** transitText của CHÍNH (các) port đang tick — cột "Chuyển tiếp". */
  transitText: string | null;
  trunkPorts: TrunkPortRow[];
}

export function buildTrunkPortReportText(input: TrunkPortReportInput): string {
  const header = `Tên luồng: ${input.circuitName}`;
  const transit = (input.transitText ?? "").trim();

  if (transit) {
    // Trường hợp 1.1 — "Chuyển tiếp" trỏ tới 1 thiết bị: "<ODF> - <thiết bị>(<port>)".
    // Đứng cạnh thiết bị rồi thì KHÔNG kèm tên tuyến cáp ở vị trí port trung kế
    // hiện tại (Đối phương đã mô tả đủ đầu xa) — chỉ vị trí + sợi nếu khác.
    const split = splitOdfDeviceStructure(transit);
    if (split.matched && split.deviceName && split.port) {
      const ownLabel = `${odfPositionOnly(input.rackCode, input.portNumbers)}${fiberSuffix(input.portNumbers, input.fiberNumbers)}`;
      const body = `${split.deviceName} (${split.port}) -> ${split.odfPart} -> ${ownLabel} -> ${input.counterpartText ?? ""}`.trim();
      return `${header}\n${body}`;
    }

    // Trường hợp 1.2 — "Chuyển tiếp" chỉ là tọa độ ODF trần trỏ sang 1 rack
    // trung kế khác thật (không thiết bị, ADN1 chỉ chuyển tiếp cáp) — CẢ 2 đầu
    // đều kèm tên tuyến cáp (không có Đối phương/thiết bị nào mô tả thay).
    const bare = matchBareTrunkLink(transit, input.trunkPorts);
    if (bare?.matched && bare.rackCode && bare.rackDomain === "trunk") {
      const targetPortNumbers = (bare.resolvedPorts ?? []).map((p) => p.portNumber);
      const targetFiberNumbers = (bare.resolvedPorts ?? []).map((p) => p.fiberNumber);
      const ownLabel = odfLabelWithCable(input.rackCode, input.portNumbers, input.fiberNumbers, input.rackCableRouteName);
      const targetLabel = odfLabelWithCable(bare.rackCode, targetPortNumbers, targetFiberNumbers, bare.cableRouteName ?? null);
      return `${header}\n${ownLabel} -> ${targetLabel}`;
    }

    // Không nhận diện được — in nguyên text, không đoán bừa.
    const ownLabel = odfPositionOnly(input.rackCode, input.portNumbers);
    return `${header}\n${ownLabel} -> ${transit} (chuyển tiếp chưa chuẩn hóa — vào /data-quality để chuẩn hóa)`;
  }

  // Không có "Chuyển tiếp" nào ghi nhận.
  const ownLabel = odfPositionOnly(input.rackCode, input.portNumbers);
  return `${header}\n${ownLabel}${input.counterpartText ? ` -> ${input.counterpartText}` : ""}`;
}

// ============================================================================
// 2. Hồ sơ đấu nối — đứng ở 1 dòng luồng thiết bị.
// ============================================================================
export interface DeviceCircuitReportInput {
  name: string;
  deviceName: string | null;
  tribText: string | null;
  devicePositionOwn: string | null;
  devicePositionNext: string | null;
  trunkPorts: TrunkPortRow[];
}

// "device_position_next" khớp splitOdfDeviceStructure có 2 khả năng CÙNG hình
// dạng "<ODF> - <X>(<Y>)": (a) X thật ra là TÊN TUYẾN CÁP (đầu ODF trần chuyển
// tiếp ra tuyến, Y lặp lại số sợi) — giữ nguyên verbatim, không tách; (b) X là
// 1 THIẾT BỊ thật (kể cả thiết bị ADN1 khác) — tách " - " thành "->". Phân
// biệt bằng cách so X với `cableRouteName` THẬT của rack ứng với phần ODF —
// rack domain='device' luôn có cableRouteName=null nên không bao giờ nhầm
// sang case (a); rack domain='trunk' có cableRouteName thật, so khớp đúng
// chữ mới coi là case (a) (dữ liệu thật ghi nguyên tên tuyến cáp vào đó).
function isTrailingCableRouteName(odfPart: string, candidateName: string, trunkPorts: TrunkPortRow[]): boolean {
  const match = matchTrunkPosition(odfPart, trunkPorts);
  return !!(match.matched && match.cableRouteName && match.cableRouteName === candidateName);
}

export function buildDeviceCircuitReportText(input: DeviceCircuitReportInput): string {
  const header = `Tên luồng: ${input.name}`;
  const parts: string[] = [];

  if (input.deviceName) {
    parts.push(input.tribText ? `${input.deviceName} (${input.tribText})` : input.deviceName);
  }
  if (input.devicePositionOwn) {
    parts.push(input.devicePositionOwn);
  }

  const next = (input.devicePositionNext ?? "").trim();
  if (next) {
    const split = splitOdfDeviceStructure(next);
    if (split.matched && split.odfPart && split.deviceName && split.port && !isTrailingCableRouteName(split.odfPart, split.deviceName, input.trunkPorts)) {
      // Trỏ sang 1 thiết bị khác — tách hyphen thành 2 đoạn mũi tên riêng.
      parts.push(split.odfPart);
      parts.push(`${split.deviceName} (${split.port})`);
    } else {
      // Tọa độ ODF trần (có thể kèm tên tuyến cáp) — giữ nguyên verbatim.
      parts.push(next);
    }
  }

  return `${header}\n${parts.join(" -> ")}`;
}
