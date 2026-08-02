import { supabase } from "@/lib/supabase";
import { matchTrunkPosition, formatCanonicalOdfPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { normalizeDevicePositionKey } from "@/lib/deviceNotes";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import { findUnlinkedMirrorPairs } from "@/lib/unlinkedMirrorPairs";

// Kiểm tra ĐỒNG BỘ ĐẦY ĐỦ 1 cặp luồng thiết bị-trung kế (yêu cầu người dùng
// 2026-08-02, sau khi chỉ ra ca ADN1.P2(2/1/2) mà cách rà trước đó — mục 44
// (chỉ đồng bộ TÊN) và mục 47 (chỉ so 1 chiều với device_position_map) — đều
// "không logic": phải so trực tiếp CẢ 3 điểm dữ liệu giữa 2 hồ sơ theo đúng
// ánh xạ vật lý (không phải so cùng tên cột với nhau):
//
//   [Thiết bị @ trib]  --(Vị trí ODF thiết bị = phần ODF trong Chuyển tiếp)-->
//   [ODF thiết bị]     --(Vị trí ODF tiếp theo = vị trí port THẬT bên trung kế)-->
//   [ODF trung kế, nơi luồng trung kế thật sự nằm]
//
// tức là:
//   - Tên luồng (2 bên)                      so trực tiếp
//   - device_position_own (bên thiết bị)     so với PHẦN ODF trong Chuyển tiếp (bên trung kế)
//   - device_position_next (bên thiết bị)    so với VỊ TRÍ PORT THẬT (bên trung kế, canonical)
//
// Phần "Thiết bị (port)" trong Chuyển tiếp KHÔNG được so/đưa vào Tên luồng —
// chỉ dùng để XÁC ĐỊNH đúng cặp thiết bị+trib cần đối chiếu (đã có sẵn qua
// mirror_of_id nếu đã liên kết, hoặc qua khớp vị trí nếu chưa).
//
// Áp dụng cho CẢ 2 loại cặp (yêu cầu người dùng chọn "cả 2"):
//   - CHƯA liên kết (tái dùng findUnlinkedMirrorPairs — đã khớp đúng vị trí
//     own/next, chỉ thiếu mirror_of_id) — sync ở đây gắn LUÔN mirror_of_id.
//   - ĐÃ liên kết (mirror_of_id có sẵn) nhưng dữ liệu có thể đã LỆCH sau đó
//     (1 bên bị sửa tay sau khi liên kết) — loại hoàn toàn MỚI, chưa từng rà.
export interface CircuitPairDetail {
  deviceCircuitId: string;
  deviceName: string;
  deviceOwnPosition: string | null;
  deviceNextPosition: string | null;
  /** Tên THIẾT BỊ (không phải tên luồng) + trib riêng của nó — dùng để dựng
   *  lại "Thiết bị (port)" khi ghi Chuyển tiếp từ chiều thiết bị -> trung kế. */
  deviceDeviceName: string | null;
  deviceTrib: string | null;

  trunkCircuitId: string;
  trunkName: string;
  /** Vị trí port THẬT của luồng trung kế, dạng chuẩn "ODF x/y (a,b)" — luôn
   *  có (không thể trống, vì đây là nơi luồng đang thực sự nằm). */
  trunkOwnPositionCanonical: string;
  /** Phần ODF tách được từ Chuyển tiếp (transit_links.raw_text) tại port
   *  trung kế — null nếu chưa có Chuyển tiếp hoặc không đúng dạng "ODF... -
   *  Thiết bị (port)". */
  trunkTransitOdfPart: string | null;
  /** Phần "Thiết bị (port)" GIỮ NGUYÊN khi ghi lại Chuyển tiếp theo chiều
   *  trung kế đúng (không đổi, chỉ đổi phần ODF phía trước). */
  trunkTransitDevicePortText: string | null;
  /** Phần Trib tách được từ Chuyển tiếp (vd "2/1/2" trong "...- AĐN1.P2
   *  (2/1/2)") — thêm 2026-08-02 (yêu cầu người dùng: "port trib cũng phải
   *  đồng bộ luôn chứ... thống nhất 1 tên thôi"). null nếu chưa có Chuyển
   *  tiếp hoặc không đúng dạng. */
  trunkTransitTrib: string | null;
  trunkTransitLinkId: string | null;
  trunkFirstPortId: string;

  rackId: string;
  rackCode: string;
  portNumbers: number[];
  isLinked: boolean;

  nameMatch: boolean;
  /** null = không đủ dữ liệu 1 trong 2 bên để so (không phải lỗi). */
  ownPositionMatch: boolean | null;
  nextPositionMatch: boolean | null;
  /** So sánh CHUỖI đã chuẩn hóa (hoa/thường, khoảng trắng) — KHÔNG cố quy đổi
   *  giữa các kiểu viết Trib khác nhau (vd "1/24/9" vs "S24-9" thật sự khác
   *  hệ ký hiệu, không có thuật toán an toàn để tự đoán tương đương — xem
   *  distinctPositionsForDevice). Đồng bộ vẫn làm được (copy nguyên văn từ
   *  bên nguồn), chỉ riêng việc TỰ PHÁT HIỆN 2 kiểu viết là "giống nhau" khi
   *  CHƯA liên kết là bài toán khác, ngoài phạm vi ở đây. */
  tribMatch: boolean | null;
  similarity: number;
}

function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
}

// `device_position_own`/`device_position_next` có thể là tọa độ ODF TRƠN
// (vd "ODF9/8(23,24)") HOẶC ghép thêm "- Thiết bị (port)"/"- Tên tuyến cáp"
// phía sau (xem combinePositionNext() — cả 2 dạng đều hợp lệ tùy người dùng
// có điền Ô2/Ô3 hay không). So số trực tiếp trên NGUYÊN chuỗi sẽ lẫn số của
// phần đuôi (tên tuyến cáp/port thiết bị cũng chứa số) gây báo lệch SAI dù
// phần tọa độ ODF thực ra khớp — phải tách lấy ĐÚNG phần ODF trước khi so.
function odfPartOnly(text: string): string {
  const split = splitOdfDeviceStructure(text);
  return split.matched && split.odfPart ? split.odfPart : text;
}

function numbersEqual(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  const na = extractNumbers(odfPartOnly(a));
  const nb = extractNumbers(odfPartOnly(b));
  if (na.length === 0 || nb.length === 0) return null;
  return JSON.stringify(na) === JSON.stringify(nb);
}

// Dùng khi LƯU 1 luồng đã liên kết (yêu cầu người dùng 2026-08-02: tự đồng
// bộ liên tục sau khi đã liên kết, có xác nhận + hiện rõ ánh xạ từng trường)
// để quyết định có đáng hiện `confirm()` không — KHÁC `numbersEqual` (dùng
// cho rà soát bứn, coi "không đủ số để so" là không kết luận được gì): ở đây
// chỉ cần biết "có nên báo cho người dùng không", nên khi không đủ số để so
// (case hiếm) vẫn coi là "có khác" (an toàn hơn — thà hỏi thừa còn hơn âm
// thầm bỏ lỡ 1 thay đổi thật).
export function hasPositionChanged(oldValue: string | null, newValue: string | null): boolean {
  const oldTrim = (oldValue ?? "").trim();
  const newTrim = (newValue ?? "").trim();
  if (!oldTrim && !newTrim) return false;
  if (!oldTrim || !newTrim) return true;
  const eq = numbersEqual(oldTrim, newTrim);
  return eq === null ? oldTrim !== newTrim : !eq;
}

// So Trib CHUỖI đã chuẩn hóa (không quy đổi hệ ký hiệu, xem chú thích
// `tribMatch` trên CircuitPairDetail) — dùng cho tự đồng bộ liên tục sau khi
// đã liên kết (PortTable.tsx/DeviceCircuitList.tsx saveEdit()).
export function hasTribChanged(oldValue: string | null, newValue: string | null): boolean {
  const oldKey = normalizeDevicePositionKey(oldValue ?? "");
  const newKey = normalizeDevicePositionKey(newValue ?? "");
  return oldKey !== newKey;
}

function tribsEqual(a: string | null, b: string | null): boolean | null {
  if (!a || !b) return null;
  return normalizeDevicePositionKey(a) === normalizeDevicePositionKey(b);
}

interface TrunkGroup {
  rackId: string;
  rackCode: string;
  portIds: string[];
  portNumbers: number[];
  firstPortId: string;
  transitText: string | null;
  transitLinkId: string | null;
  mirrorOfId: string | null;
}

function groupTrunkPortsByCircuit(trunkPorts: TrunkPortRow[]): Map<string, TrunkGroup> {
  const groups = new Map<string, TrunkGroup>();
  for (const p of trunkPorts) {
    if (p.rackDomain !== "trunk" || !p.circuit) continue;
    const g = groups.get(p.circuit.id) ?? {
      rackId: p.rackId,
      rackCode: p.rackCode,
      portIds: [],
      portNumbers: [],
      firstPortId: p.portId,
      transitText: null,
      transitLinkId: null,
      mirrorOfId: p.circuit.mirrorOfId,
    };
    g.portIds.push(p.portId);
    g.portNumbers.push(p.portNumber);
    if (!g.transitText && p.transitText) {
      g.transitText = p.transitText;
      g.transitLinkId = p.transitLinkId;
    }
    groups.set(p.circuit.id, g);
  }
  return groups;
}

function trunkCanonicalPosition(rackCode: string, portNumbers: number[], trunkPorts: TrunkPortRow[]): string {
  const text = `${rackCode}(${portNumbers.join(",")})`;
  const match = matchTrunkPosition(text, trunkPorts);
  return formatCanonicalOdfPosition(match) ?? `${rackCode} (${portNumbers.join(",")})`;
}

function buildDetail(
  deviceCircuit: DeviceCircuitRow,
  trunkCircuitId: string,
  trunkName: string,
  group: TrunkGroup,
  isLinked: boolean,
  trunkPorts: TrunkPortRow[],
  similarity: number
): CircuitPairDetail {
  const trunkOwnPositionCanonical = trunkCanonicalPosition(group.rackCode, group.portNumbers, trunkPorts);
  const transitSplit = group.transitText ? splitOdfDeviceStructure(group.transitText) : null;
  const trunkTransitOdfPart = transitSplit?.matched ? transitSplit.odfPart ?? null : null;
  const trunkTransitDevicePortText = transitSplit?.matched ? transitSplit.devicePortText ?? null : null;
  const trunkTransitTrib = transitSplit?.matched ? transitSplit.port ?? null : null;

  return {
    deviceCircuitId: deviceCircuit.id,
    deviceName: deviceCircuit.name,
    deviceOwnPosition: deviceCircuit.devicePositionOwn,
    deviceNextPosition: deviceCircuit.devicePositionNext,
    deviceDeviceName: deviceCircuit.deviceName,
    deviceTrib: deviceCircuit.tribText,
    trunkCircuitId,
    trunkName,
    trunkOwnPositionCanonical,
    trunkTransitOdfPart,
    trunkTransitDevicePortText,
    trunkTransitTrib,
    trunkTransitLinkId: group.transitLinkId,
    trunkFirstPortId: group.firstPortId,
    rackId: group.rackId,
    rackCode: group.rackCode,
    portNumbers: [...group.portNumbers].sort((a, b) => a - b),
    isLinked,
    nameMatch: deviceCircuit.name.trim() === trunkName.trim(),
    ownPositionMatch: numbersEqual(deviceCircuit.devicePositionOwn, trunkTransitOdfPart),
    nextPositionMatch: numbersEqual(deviceCircuit.devicePositionNext, trunkOwnPositionCanonical),
    tribMatch: tribsEqual(deviceCircuit.tribText, trunkTransitTrib),
    similarity,
  };
}

// Cặp ĐÃ liên kết (mirror_of_id có sẵn) — có thể đã LỆCH dữ liệu sau khi liên
// kết (1 bên bị sửa tay). Trả về TẤT CẢ cặp đã liên kết (không lọc lệch ở
// đây) — lọc lệch làm ở findMismatchedLinkedPairs bên dưới, giữ hàm này thuần
// "liệt kê cặp" để tái dùng cho cả việc kiểm tra 1 luồng cụ thể.
export function findLinkedDeviceTrunkPairs(trunkPorts: TrunkPortRow[], deviceCircuits: DeviceCircuitRow[]): CircuitPairDetail[] {
  const trunkGroups = groupTrunkPortsByCircuit(trunkPorts);
  const deviceById = new Map(deviceCircuits.map((d) => [d.id, d]));
  const trunkNameById = new Map<string, string>();
  for (const p of trunkPorts) {
    if (p.circuit) trunkNameById.set(p.circuit.id, p.circuit.name);
  }

  const result: CircuitPairDetail[] = [];
  for (const [trunkCircuitId, group] of trunkGroups) {
    if (!group.mirrorOfId) continue;
    const deviceCircuit = deviceById.get(group.mirrorOfId);
    if (!deviceCircuit) continue; // mirror_of_id trỏ sang 1 luồng KHÔNG phải "luồng thiết bị" (vd device-device) -> không thuộc phạm vi ở đây
    const trunkName = trunkNameById.get(trunkCircuitId) ?? "";
    result.push(buildDetail(deviceCircuit, trunkCircuitId, trunkName, group, true, trunkPorts, 100));
  }
  return result;
}

// Toàn bộ cặp thiết bị-trung kế cần rà (CẢ chưa liên kết lẫn đã liên kết) —
// dùng cho tab "Đồng bộ Thiết bị-Trung kế" (thay tab mục 44) VÀ cho nút
// "Kiểm tra đồng bộ" ở form sửa 1 luồng (lọc theo đúng 1 id trong kết quả).
export async function findAllDeviceTrunkPairs(
  trunkPorts: TrunkPortRow[],
  deviceCircuits: DeviceCircuitRow[]
): Promise<CircuitPairDetail[]> {
  const trunkGroups = groupTrunkPortsByCircuit(trunkPorts);
  const trunkNameById = new Map<string, string>();
  for (const p of trunkPorts) {
    if (p.circuit) trunkNameById.set(p.circuit.id, p.circuit.name);
  }

  const linked = findLinkedDeviceTrunkPairs(trunkPorts, deviceCircuits);

  const unlinked = await findUnlinkedMirrorPairs(trunkPorts, deviceCircuits);
  const deviceById = new Map(deviceCircuits.map((d) => [d.id, d]));
  const unlinkedDetails: CircuitPairDetail[] = [];
  for (const u of unlinked) {
    const deviceCircuit = deviceById.get(u.deviceCircuitId);
    const group = trunkGroups.get(u.trunkCircuitId);
    if (!deviceCircuit || !group) continue;
    const trunkName = trunkNameById.get(u.trunkCircuitId) ?? u.trunkCircuitName;
    unlinkedDetails.push(buildDetail(deviceCircuit, u.trunkCircuitId, trunkName, group, false, trunkPorts, u.similarity));
  }

  return [...linked, ...unlinkedDetails];
}

// Chỉ những cặp ĐÃ liên kết nhưng CÓ ít nhất 1 điểm dữ liệu lệch — LOẠI THỨ 6
// (mới, khác hẳn mục 44/45 vốn chỉ xét cặp CHƯA liên kết) — 1 bên bị sửa tay
// SAU KHI đã liên kết, không có cơ chế nào bắt được trước đây.
export function findMismatchedLinkedPairs(trunkPorts: TrunkPortRow[], deviceCircuits: DeviceCircuitRow[]): CircuitPairDetail[] {
  return findLinkedDeviceTrunkPairs(trunkPorts, deviceCircuits).filter(
    (d) => !d.nameMatch || d.ownPositionMatch === false || d.nextPositionMatch === false || d.tribMatch === false
  );
}

// ============================================================================
// Áp dụng đồng bộ — người dùng đã tick xác nhận + chọn 1 bên làm chuẩn (UI
// chịu trách nhiệm hỏi, xem CircuitPairSyncPanel.tsx). Nếu cặp CHƯA liên kết,
// cả 2 hướng đều gắn LUÔN mirror_of_id (chọn 1 bên làm chuẩn tức đã xác nhận
// đây là 1 luồng thật).
// ============================================================================

// Trung kế đúng -> đẩy dữ liệu sang thiết bị: Tên luồng, Vị trí ODF (tiếp
// theo) = vị trí port thật, Vị trí ODF (thiết bị) = phần ODF trong Chuyển
// tiếp (nếu có — không có thì bỏ qua, giữ nguyên phần này bên thiết bị), Trib
// = phần Trib tách được từ Chuyển tiếp (yêu cầu người dùng 2026-08-02: "port
// trib cũng phải đồng bộ luôn... thống nhất 1 tên thôi" — copy NGUYÊN VĂN từ
// Chuyển tiếp, không tự quy đổi hệ ký hiệu).
export async function applySyncFromTrunk(detail: CircuitPairDetail): Promise<void> {
  const update: Record<string, string | null> = {
    name: detail.trunkName,
    device_position_next: detail.trunkOwnPositionCanonical,
  };
  if (detail.trunkTransitOdfPart) update.device_position_own = detail.trunkTransitOdfPart;
  if (detail.trunkTransitTrib) update.trib_text = detail.trunkTransitTrib;
  const { error } = await supabase.from("circuits").update(update).eq("id", detail.deviceCircuitId);
  if (error) throw error;
  if (!detail.isLinked) {
    const { error: linkErr } = await supabase.from("circuits").update({ mirror_of_id: detail.deviceCircuitId }).eq("id", detail.trunkCircuitId);
    if (linkErr) throw linkErr;
  }
}

// Thiết bị đúng -> đẩy dữ liệu sang trung kế: Tên luồng, Chuyển tiếp = "<Vị
// trí ODF thiết bị> - <Tên thiết bị> (<Trib>)" (GIỮ chuẩn 1 dòng đã dùng —
// KHÔNG lấy tên luồng từ đây, chỉ là định danh thiết bị+port). Vị trí ODF
// (tiếp theo) không cần ghi gì bên trung kế — đó vốn CHÍNH LÀ vị trí port
// thật (không phải text lưu riêng), tự động đúng vì cặp được xác định qua
// đúng port này.
export async function applySyncFromDevice(detail: CircuitPairDetail): Promise<void> {
  const { error: nameErr } = await supabase.from("circuits").update({ name: detail.deviceName }).eq("id", detail.trunkCircuitId);
  if (nameErr) throw nameErr;

  if (detail.deviceOwnPosition && detail.deviceDeviceName && detail.deviceTrib) {
    const newRawText = `${detail.deviceOwnPosition} - ${detail.deviceDeviceName} (${detail.deviceTrib})`;
    if (detail.trunkTransitLinkId) {
      const { error } = await supabase.from("transit_links").update({ raw_text: newRawText }).eq("id", detail.trunkTransitLinkId);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("transit_links")
        .insert({ source_port_id: detail.trunkFirstPortId, target_type: "text_only", raw_text: newRawText });
      if (error) throw error;
    }
  }

  if (!detail.isLinked) {
    const { error: linkErr } = await supabase.from("circuits").update({ mirror_of_id: detail.deviceCircuitId }).eq("id", detail.trunkCircuitId);
    if (linkErr) throw linkErr;
  }
}
