import { distance } from "fastest-levenshtein";
import { supabase } from "@/lib/supabase";
import { normalizeVN } from "@/lib/text";
import { matchTrunkPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import type { DeviceRow } from "@/lib/devices";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";

// Phát hiện 2026-08-02 (người dùng hỏi cụ thể ca ADN1.OMS3255(1/9/2) <-> ODF
// 1/1 (41,42)) — LOẠI THỨ 3 của "chưa đồng bộ", khác hẳn mục 38/39/40: ở đó
// port trung kế đích đang TRỐNG nên tự tạo mirror được ngay. Ở đây CẢ 2 PHÍA
// đã có sẵn 1 luồng ĐỘC LẬP (import từ Excel gốc từ trước khi có cột
// mirror_of_id, xem migration 20260731000001), khớp đúng own/next NHƯNG chưa
// được gắn `mirror_of_id` — `findTrunkMirrorCandidates()` (lib/
// mirrorTrunkCircuits.ts) bỏ qua các port này vì coi "đã có luồng chiếm chỗ =
// đã đồng bộ", không kiểm tra xem luồng chiếm chỗ đó có ĐÚNG là mirror không.
//
// Rà thật trên toàn bộ dữ liệu: 207 cặp thuộc loại này. Rà tay xác nhận thấy
// ĐA SỐ đúng là 1 luồng (chỉ khác format tên/dấu, giống ca OMS3255), nhưng có
// 1 số cặp tên 2 bên KHÁC HẲN nhau (nhiều khả năng là port bị dùng lại/dữ liệu
// cũ, KHÔNG phải cùng luồng) — gắn `mirror_of_id` nhầm sẽ khiến xóa 1 bên tự
// xóa lây bên kia (on delete cascade) dù 2 luồng không liên quan, RỦI RO CAO
// nếu tự động gắn hàng loạt. Theo đúng quyết định người dùng: CHỈ liệt kê +
// xếp hạng theo % giống tên để gợi ý độ tin cậy, người dùng tự tick xác nhận
// TỪNG cặp trước khi liên kết (không có "liên kết hàng loạt").
export interface UnlinkedMirrorPair {
  deviceCircuitId: string;
  deviceCircuitName: string;
  deviceInterfaceType: string | null;
  trunkCircuitId: string;
  trunkCircuitName: string;
  trunkInterfaceType: string | null;
  rackId: string;
  rackCode: string;
  firstPortId: string;
  portNumbers: number[];
  /** % giống nhau sau chuẩn hóa tên (Levenshtein) — CHỈ để sắp xếp/gợi ý độ
   *  tin cậy cho người dùng tự soi, KHÔNG dùng để tự quyết định liên kết. */
  similarity: number;
}

function normalizeForCompare(name: string): string {
  return normalizeVN(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function similarityPercent(a: string, b: string): number {
  const na = normalizeForCompare(a);
  const nb = normalizeForCompare(b);
  const maxLen = Math.max(na.length, nb.length, 1);
  return Math.round((1 - distance(na, nb) / maxLen) * 100);
}

interface Candidate {
  deviceCircuit: DeviceCircuitRow;
  trunkCircuitId: string;
  trunkCircuitName: string;
  trunkInterfaceType: string | null;
  rackId: string;
  rackCode: string;
  firstPortId: string;
  portNumbers: number[];
}

export async function findUnlinkedMirrorPairs(
  trunkPorts: TrunkPortRow[],
  deviceCircuits: DeviceCircuitRow[]
): Promise<UnlinkedMirrorPair[]> {
  const candidates: Candidate[] = [];
  const seenPairKeys = new Set<string>();

  for (const dc of deviceCircuits) {
    if (dc.mirrorOfId) continue; // chính nó đã là mirror của luồng khác -> không phải "gốc", bỏ qua
    const texts = [dc.devicePositionOwn, dc.devicePositionNext].filter((t): t is string => !!t);
    for (const text of texts) {
      const match = matchTrunkPosition(text, trunkPorts);
      if (!match.matched || match.rackDomain !== "trunk" || !match.rackCode || !match.resolvedPorts) continue;
      if (match.invalidPortNumbers && match.invalidPortNumbers.length > 0) continue;
      const occupied = match.resolvedPorts.filter((p) => p.inUse);
      if (occupied.length === 0) continue; // trống -> thuộc phạm vi mục 39 (tự tạo được), không phải ca này

      const firstOccupied = trunkPorts.find((p) => p.rackCode === match.rackCode && p.portNumber === occupied[0].portNumber);
      if (!firstOccupied || !firstOccupied.circuit) continue;

      if (firstOccupied.circuit.mirrorOfId) continue; // đã liên kết (đúng hoặc sang luồng khác) -> bỏ qua

      const pairKey = `${dc.id}|${firstOccupied.circuit.id}`;
      if (seenPairKeys.has(pairKey)) continue;
      seenPairKeys.add(pairKey);

      candidates.push({
        deviceCircuit: dc,
        trunkCircuitId: firstOccupied.circuit.id,
        trunkCircuitName: firstOccupied.circuit.name,
        trunkInterfaceType: firstOccupied.circuit.interfaceType,
        rackId: firstOccupied.rackId,
        rackCode: firstOccupied.rackCode,
        firstPortId: firstOccupied.portId,
        portNumbers: occupied.map((p) => p.portNumber).sort((a, b) => a - b),
      });
    }
  }

  const result: UnlinkedMirrorPair[] = [];
  for (const c of candidates) {
    result.push({
      deviceCircuitId: c.deviceCircuit.id,
      deviceCircuitName: c.deviceCircuit.name,
      deviceInterfaceType: c.deviceCircuit.interfaceType,
      trunkCircuitId: c.trunkCircuitId,
      trunkCircuitName: c.trunkCircuitName,
      trunkInterfaceType: c.trunkInterfaceType,
      rackId: c.rackId,
      rackCode: c.rackCode,
      firstPortId: c.firstPortId,
      portNumbers: c.portNumbers,
      similarity: similarityPercent(c.deviceCircuit.name, c.trunkCircuitName),
    });
  }

  return result.sort((a, b) => b.similarity - a.similarity);
}

// Người dùng tự tick xác nhận rồi mới gọi (component chịu trách nhiệm hỏi) —
// chiều liên kết: thiết bị = gốc (mirror_of_id giữ null), trung kế = mirror,
// đúng quy ước autoCreateTrunkMirrorForCircuit() (mục 39) đang dùng.
//
// syncNameFrom (yêu cầu người dùng 2026-08-02, sau khi hỏi lại "liên kết thì
// có đẩy dữ liệu qua lại không") — mặc định KHÔNG đồng bộ gì (chỉ gắn
// mirror_of_id, giữ nguyên tên/giao tiếp 2 bên như trước, đúng hành vi gốc).
// Nếu người dùng CHỌN 1 bên làm chuẩn (UI chỉ hiện lựa chọn này khi 2 tên
// khác nhau), ghi ĐÈ CHỈ name+interface_type của bên CÒN LẠI — không đụng
// counterpart_text/response_plan_text/execution_station_text/notes/trib_text/
// device_position_own/next (đây là các trường CHỈ có nghĩa riêng theo từng
// domain — vd device_position_own bên thiết bị không có khái niệm tương ứng
// bên trung kế — đồng bộ chúng không có ý nghĩa, khác hẳn name/interface_type
// vốn là 2 trường mô tả CÙNG 1 khái niệm ở cả 2 domain).
// Lõi dùng chung cho MỌI loại "liên kết mirror" trong file này (device-trunk
// lẫn device-device bên dưới) — gắn mirror_of_id rồi (tùy chọn) đồng bộ CHỈ
// name+interface_type từ 1 bên sang bên kia, tránh viết lại 2 lần cùng 1
// logic rồi lệch nhau sau này.
async function applyMirrorLink(originId: string, mirrorId: string, syncFrom?: "origin" | "mirror"): Promise<void> {
  const { error } = await supabase.from("circuits").update({ mirror_of_id: originId }).eq("id", mirrorId);
  if (error) throw error;
  if (!syncFrom) return;

  const sourceId = syncFrom === "origin" ? originId : mirrorId;
  const targetId = syncFrom === "origin" ? mirrorId : originId;
  const { data: sourceRow, error: readErr } = await supabase.from("circuits").select("name, interface_type").eq("id", sourceId).single();
  if (readErr) throw readErr;
  const { error: syncErr } = await supabase
    .from("circuits")
    .update({ name: sourceRow.name, interface_type: sourceRow.interface_type })
    .eq("id", targetId);
  if (syncErr) throw syncErr;
}

export async function linkMirrorPair(deviceCircuitId: string, trunkCircuitId: string, syncNameFrom?: "device" | "trunk"): Promise<void> {
  await applyMirrorLink(deviceCircuitId, trunkCircuitId, syncNameFrom === "device" ? "origin" : syncNameFrom === "trunk" ? "mirror" : undefined);
}

// ============================================================================
// LOẠI 4 — cặp luồng THIẾT BỊ-THIẾT BỊ (cả 2 đầu đều local ADN1) đã có sẵn cả
// 2 phía nhưng chưa liên kết mirror (phát hiện 2026-08-02, người dùng chỉ ra
// ngay sau khi xong loại device-trunk ở trên: "Còn trường hợp đấu nối giữa 02
// thiết bị nữa"). CÙNG BẢN CHẤT lỗ hổng: `findMissingDeviceMirrors()` (lib/
// deviceDeviceSync.ts, mục 38) coi "thiết bị đích đã có luồng khớp Trib" =
// "đã đồng bộ" (dòng `if (targetOwnTribs.has(targetTribKey)) continue`),
// không kiểm tra luồng khớp Trib đó có ĐÚNG là mirror (mirror_of_id trỏ đúng)
// hay chỉ là 2 dòng độc lập từ Excel gốc tình cờ khớp thiết bị+Trib.
//
// Rà thử toàn bộ dữ liệu: ~378 cặp DUY NHẤT (757 lượt phát hiện theo 2 chiều
// quét, mỗi cặp thật luôn hiện ra 2 lần vì cả 2 bên đều có thể là "nguồn" —
// đã khử trùng qua seenPairKeys bằng cặp id sắp xếp, KHÔNG phân biệt chiều).
export interface UnlinkedDeviceDevicePair {
  circuitAId: string;
  circuitAName: string;
  circuitAInterfaceType: string | null;
  circuitADeviceName: string | null;
  circuitATrib: string | null;
  circuitBId: string;
  circuitBName: string;
  circuitBInterfaceType: string | null;
  circuitBDeviceName: string | null;
  circuitBTrib: string | null;
  similarity: number;
}

// Thuần hàm tính toán (không query DB) — KHÁC findUnlinkedMirrorPairs (cần 1
// lượt tra mirror_of_id riêng vì TrunkPortRow không mang field này), ở đây
// DeviceCircuitRow đã có sẵn `mirrorOfId` cho CẢ 2 phía nên không cần fetch
// thêm gì.
export function findUnlinkedDeviceDevicePairs(deviceCircuits: DeviceCircuitRow[], devices: DeviceRow[]): UnlinkedDeviceDevicePair[] {
  const deviceIdByKey = new Map<string, { id: string; name: string }>();
  for (const d of devices) deviceIdByKey.set(normalizeDeviceNameKey(d.name), { id: d.id, name: d.name });

  const circuitsByDeviceId = new Map<string, DeviceCircuitRow[]>();
  for (const c of deviceCircuits) {
    if (!c.deviceId) continue;
    const list = circuitsByDeviceId.get(c.deviceId) ?? [];
    list.push(c);
    circuitsByDeviceId.set(c.deviceId, list);
  }

  const seenPairKeys = new Set<string>();
  const result: UnlinkedDeviceDevicePair[] = [];

  for (const c of deviceCircuits) {
    if (c.mirrorOfId) continue; // chính nó đã là mirror -> không phải "nguồn", bỏ qua
    const raw = c.devicePositionNext;
    if (!raw) continue;
    const split = splitOdfDeviceStructure(raw);
    if (!split.matched || !split.deviceName || !split.port) continue;

    const targetKey = normalizeDeviceNameKey(split.deviceName);
    const target = deviceIdByKey.get(targetKey);
    if (!target) continue; // không phải thiết bị local ADN1 đã biết
    if (c.deviceName && normalizeDeviceNameKey(c.deviceName) === targetKey) continue; // tự trỏ về chính nó

    const targetTribKey = normalizeDevicePositionKey(split.port);
    const targetCircuits = circuitsByDeviceId.get(target.id) ?? [];
    const occupant = targetCircuits.find((tc) => tc.tribText && normalizeDevicePositionKey(tc.tribText) === targetTribKey);
    if (!occupant) continue; // trống thật -> thuộc phạm vi mục 38 (tự tạo được), không phải ca này
    if (occupant.mirrorOfId) continue; // đã liên kết (đúng hoặc sang luồng khác) -> bỏ qua

    const pairKey = [c.id, occupant.id].sort().join("|");
    if (seenPairKeys.has(pairKey)) continue;
    seenPairKeys.add(pairKey);

    result.push({
      circuitAId: c.id,
      circuitAName: c.name,
      circuitAInterfaceType: c.interfaceType,
      circuitADeviceName: c.deviceName,
      circuitATrib: c.tribText,
      circuitBId: occupant.id,
      circuitBName: occupant.name,
      circuitBInterfaceType: occupant.interfaceType,
      circuitBDeviceName: occupant.deviceName,
      circuitBTrib: occupant.tribText,
      similarity: similarityPercent(c.name, occupant.name),
    });
  }

  return result.sort((a, b) => b.similarity - a.similarity);
}

export async function linkDeviceDevicePair(circuitAId: string, circuitBId: string, syncNameFrom?: "a" | "b"): Promise<void> {
  await applyMirrorLink(circuitAId, circuitBId, syncNameFrom === "a" ? "origin" : syncNameFrom === "b" ? "mirror" : undefined);
}
