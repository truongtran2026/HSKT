import type { TrunkPortRow } from "@/lib/trunkPorts";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import type { UnlinkedMirrorPair, UnlinkedDeviceDevicePair } from "@/lib/unlinkedMirrorPairs";

// Huy hiệu trạng thái liên kết mirror NGAY trên từng dòng port/luồng (yêu cầu
// người dùng 2026-08-02, sau khi hỏi "làm sao biết được 2 bên là 1 luồng, đã
// liên kết hay chưa" — trước đó chỉ biết được qua 2 tab riêng ở /data-quality,
// phải rời trang đang sửa mới tra được). 3 trạng thái:
// - "linked": CHÍNH luồng này có mirror_of_id, HOẶC có 1 luồng khác ở BẤT KỲ
//   đâu (trung kế/thiết bị) trỏ mirror_of_id VỀ luồng này (nó là "gốc").
// - "candidate": chưa liên kết, nhưng khớp vị trí với 1 luồng khác (đúng loại
//   phát hiện của findUnlinkedMirrorPairs/findUnlinkedDeviceDevicePairs) —
//   NHIỀU KHẢ NĂNG là cùng 1 luồng, nên tự vào /data-quality xác nhận.
// - không có trong Map: không có gì để báo (không match vị trí nào, hoặc
//   không thuộc phạm vi mirror — vd trỏ ra trạm khác không quản lý).
//
// Tính rẻ (không query DB thêm) — TrunkPortRow.circuit đã mang sẵn
// `mirrorOfId` (thêm cùng ngày, xem lib/trunkPorts.ts) và DeviceCircuitRow đã
// có sẵn từ mục 43-45, nên toàn bộ chỉ là duyệt mảng JS thuần trên dữ liệu ĐÃ
// tải sẵn cho các mục đích khác của trang — không thêm round-trip Supabase
// nào.
export type MirrorLinkStatus = "linked" | "candidate";

export function computeMirrorLinkStatuses(
  trunkPorts: TrunkPortRow[],
  deviceCircuits: DeviceCircuitRow[],
  unlinkedMirrorPairs: UnlinkedMirrorPair[],
  unlinkedDeviceDevicePairs: UnlinkedDeviceDevicePair[]
): Record<string, MirrorLinkStatus> {
  const statusById: Record<string, MirrorLinkStatus> = {};

  // Tập id được tham chiếu làm "gốc" bởi 1 mirror_of_id nào đó, ở BẤT KỲ đâu
  // (trung kế lẫn thiết bị) — 1 luồng "gốc" tự nó không có mirror_of_id
  // (luôn null) nên phải dò NGƯỢC qua tập này mới biết nó có mirror hay không.
  const originIds = new Set<string>();
  for (const p of trunkPorts) {
    if (p.circuit?.mirrorOfId) originIds.add(p.circuit.mirrorOfId);
  }
  for (const c of deviceCircuits) {
    if (c.mirrorOfId) originIds.add(c.mirrorOfId);
  }

  for (const p of trunkPorts) {
    if (!p.circuit) continue;
    if (p.circuit.mirrorOfId || originIds.has(p.circuit.id)) statusById[p.circuit.id] = "linked";
  }
  for (const c of deviceCircuits) {
    if (c.mirrorOfId || originIds.has(c.id)) statusById[c.id] = "linked";
  }

  // "candidate" KHÔNG được ghi đè "linked" (dữ liệu 2 tab tính từ 1 lượt tải
  // khác trong cùng lần render trang — hiếm khi lệch, nhưng nếu lệch thì ưu
  // tiên trạng thái "linked" đã xác nhận chắc hơn).
  for (const pair of unlinkedMirrorPairs) {
    if (!statusById[pair.deviceCircuitId]) statusById[pair.deviceCircuitId] = "candidate";
    if (!statusById[pair.trunkCircuitId]) statusById[pair.trunkCircuitId] = "candidate";
  }
  for (const pair of unlinkedDeviceDevicePairs) {
    if (!statusById[pair.circuitAId]) statusById[pair.circuitAId] = "candidate";
    if (!statusById[pair.circuitBId]) statusById[pair.circuitBId] = "candidate";
  }

  return statusById;
}
