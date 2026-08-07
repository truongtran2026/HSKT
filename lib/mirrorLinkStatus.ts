import type { SupabaseClient } from "@supabase/supabase-js";
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

// Gỡ liên kết mirror_of_id — yêu cầu người dùng 2026-08-02 ("Giải pháp: Nhất
// quán liên kết...", bước 1/6): trước đây KHÔNG có cách nào tách 2 luồng đã
// liên kết ra (đã grep toàn repo xác nhận), nên khi 1 luồng cần đổi sang đấu
// nối THẬT KHÁC (không phải sửa lỗi chính tả), người dùng bị kẹt không có
// đường thao tác đúng. Hàm này CHỈ set mirror_of_id = null — KHÔNG đụng tới
// bất kỳ trường dữ liệu nào khác của cả 2 bên (tên/vị trí/trib giữ nguyên,
// chỉ không còn coi là "cùng 1 luồng" để đối chiếu/tự đồng bộ nữa).
//
// `circuitId` truyền vào có thể là BÊN NÀO trong cặp — không cần biết trước
// ai đang giữ cột mirror_of_id thật (device-trunk: luôn là bên trung kế;
// device-device/trunk-trunk: là luồng được TẠO SAU, xem lib/deviceDeviceSync.ts
// và lib/mirrorTrunkCircuits.ts) — dò cả 2 chiều, cùng lý do
// computeMirrorLinkStatuses() ở trên cũng phải dò cả 2 chiều.
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function unlinkCircuitMirror(client: SupabaseClient, circuitId: string): Promise<void> {
  const supabase = client;
  const { data: self, error: selfErr } = await supabase.from("circuits").select("mirror_of_id").eq("id", circuitId).single();
  if (selfErr) throw selfErr;
  if (self?.mirror_of_id) {
    const { error } = await supabase.from("circuits").update({ mirror_of_id: null }).eq("id", circuitId);
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from("circuits").update({ mirror_of_id: null }).eq("mirror_of_id", circuitId);
  if (error) throw error;
}
