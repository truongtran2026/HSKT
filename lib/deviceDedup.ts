import { distance } from "fastest-levenshtein";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import type { DeviceRow } from "@/lib/devices";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

// Trang "Chất lượng dữ liệu" (yêu cầu người dùng 2026-07-29) — tìm CẶP thiết
// bị có tên GẦN GIỐNG nhau (gõ nhầm 1-2 ký tự, thiếu/thừa dấu "#"...) nhưng
// CHƯA cùng key sau normalizeDeviceNameKey() (nếu đã cùng key thì mọi luồng
// tạo/gán thiết bị trong app đều tự khớp vào 1 thiết bị rồi, không thể tồn
// tại 2 dòng devices khác nhau cùng key — TRỪ dữ liệu import gốc từ trước khi
// các chỗ tạo devices có kiểm tra này). CHỈ liệt kê để người dùng tự quyết
// định gộp bên nào vào bên nào hay bỏ qua — KHÔNG tự gộp, vì "gần giống" có
// thể là 2 thiết bị thật khác nhau (vd "P1"/"P2" khác 1 ký tự). N=150 thiết
// bị hiện tại nên so O(N^2) ở app layer (không cần bật pg_trgm) là đủ nhanh.
// circuits: danh sách luồng CỤ THỂ đang gắn device_id này (id+name) — thêm
// 2026-07-30 sau khi người dùng gặp khó: chỉ thấy "2 luồng" nhưng không biết
// đó là luồng nào/nằm ở đâu để kiểm tra (luồng domain=device không gán port
// nào nên KHÔNG nằm trong bất kỳ Rack ODF trung kế nào — dễ hiểu lầm đi tìm
// sai chỗ). Hiện link nhảy thẳng tới đúng dòng ở "Hồ sơ đấu nối" (component
// DeviceCircuitList.tsx đã có sẵn cơ chế cuộn-tới-dòng qua hash #dc-<id>, xem
// rowAnchor()/useEffect đọc window.location.hash trong file đó).
export interface DeviceDupCandidate {
  deviceA: { id: string; name: string; circuitCount: number; circuits: { id: string; name: string }[] };
  deviceB: { id: string; name: string; circuitCount: number; circuits: { id: string; name: string }[] };
  editDistance: number;
}

// Ngưỡng: distance <= 2 và độ dài key > 4 — tránh báo nhầm tên ngắn (vd "P1"
// vs "P2" chỉ khác 1 ký tự nhưng chắc chắn là 2 thiết bị khác nhau thật).
const MAX_EDIT_DISTANCE = 2;
const MIN_KEY_LENGTH = 4;

// Loại "anh em đánh số" — phát hiện khi chạy thử trên dữ liệu thật 150 thiết
// bị: ngưỡng distance<=2 riêng nó báo ra 199 cặp, ĐA SỐ là nhiễu vì thiết bị
// viễn thông rất hay đặt tên kiểu "TP5000#1".."TP5000#15" (15 thiết bị THẬT
// khác nhau, chỉ khác số thứ tự) — 1 cặp số liền nhau luôn có distance nhỏ
// dù là 2 thiết bị hoàn toàn khác nhau. Quy tắc lọc: tách CHỮ SỐ CUỐI CÙNG
// trong chuỗi ra riêng (vd "tp5000#3" -> phần chữ "tp5000#" + số "3"); nếu 2
// tên CÙNG phần chữ nhưng KHÁC giá trị số -> chắc chắn là 2 thiết bị đánh số
// khác nhau, loại khỏi kết quả. Cùng phần chữ NHƯNG cùng giá trị số (chỉ khác
// cách đệm số 0, vd "01" so "1") thì VẪN giữ lại — đó là dấu hiệu thật của 1
// thiết bị bị ghi 2 kiểu. Không bắt được hết mọi trường hợp số nằm GIỮA chuỗi
// (vd "RNC 34705E_KHA" số nằm trước "_KHA") nên vẫn tách số cuối cùng bất kỳ
// đâu trong chuỗi (matchAll toàn chuỗi, lấy occurrence CUỐI), không chỉ số ở
// cuối chuỗi.
function splitLastNumber(key: string): { skeleton: string; value: number } | null {
  const matches = [...key.matchAll(/\d+/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const start = last.index ?? 0;
  const end = start + last[0].length;
  return { skeleton: key.slice(0, start) + key.slice(end), value: parseInt(last[0], 10) };
}

function looksLikeNumberedSiblings(keyA: string, keyB: string): boolean {
  const a = splitLastNumber(keyA);
  const b = splitLastNumber(keyB);
  if (!a || !b) return false;
  return a.skeleton === b.skeleton && a.value !== b.value;
}

export function findFuzzyDuplicateDevices(
  devices: DeviceRow[],
  circuits: DeviceCircuitRow[],
  ignoredPairs: IgnoredDevicePair[]
): DeviceDupCandidate[] {
  const circuitsByDevice = new Map<string, { id: string; name: string }[]>();
  for (const c of circuits) {
    if (!c.deviceId) continue;
    const list = circuitsByDevice.get(c.deviceId) ?? [];
    list.push({ id: c.id, name: c.name });
    circuitsByDevice.set(c.deviceId, list);
  }
  const ignoredKeys = new Set(ignoredPairs.map((p) => ignoredPairKey(p.deviceAId, p.deviceBId)));

  const keyed = devices.map((d) => ({ device: d, key: normalizeDeviceNameKey(d.name) })).filter((x) => x.key.length > MIN_KEY_LENGTH);

  const result: DeviceDupCandidate[] = [];
  for (let i = 0; i < keyed.length; i++) {
    for (let j = i + 1; j < keyed.length; j++) {
      const a = keyed[i];
      const b = keyed[j];
      const d = distance(a.key, b.key);
      if (d > MAX_EDIT_DISTANCE) continue;
      if (looksLikeNumberedSiblings(a.key, b.key)) continue;
      if (ignoredKeys.has(ignoredPairKey(a.device.id, b.device.id))) continue;
      const circuitsA = circuitsByDevice.get(a.device.id) ?? [];
      const circuitsB = circuitsByDevice.get(b.device.id) ?? [];
      result.push({
        deviceA: { id: a.device.id, name: a.device.name, circuitCount: circuitsA.length, circuits: circuitsA },
        deviceB: { id: b.device.id, name: b.device.name, circuitCount: circuitsB.length, circuits: circuitsB },
        editDistance: d,
      });
    }
  }
  return result.sort((a, b) => a.editDistance - b.editDistance);
}

// Phần lõi RỦI RO của applyBulkRename() (DeviceCategoryClient.tsx) tách ra
// dùng chung với trang "Chất lượng dữ liệu" (yêu cầu người dùng 2026-07-29)
// — CHỈ đúng phần "chuyển luồng + xóa thiết bị nguồn", KHÔNG gồm phần xử lý
// tên đích/đồng bộ device_position_map vì 2 nơi gọi cần xử lý phần đó khác
// nhau (DeviceCategoryClient còn cho đổi tên đích; trang mới thì đích giữ
// nguyên tên đang có) — mỗi nơi tự gọi syncDevicePositionMapNames() riêng
// sau khi hàm này chạy xong, giữ đúng hành vi "lưu xong mới đồng bộ, đồng bộ
// lỗi không coi là lưu thất bại" đã có ở applyBulkRename.
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function mergeDeviceInto(client: SupabaseClient, sourceId: string, targetId: string): Promise<void> {
  const supabase = client;
  const { error: relinkErr } = await supabase.from("circuits").update({ device_id: targetId }).eq("device_id", sourceId);
  if (relinkErr) throw relinkErr;
  const { error: delErr } = await supabase.from("devices").delete().eq("id", sourceId);
  if (delErr) throw delErr;
}

export interface IgnoredDevicePair {
  id: string;
  deviceAId: string;
  deviceBId: string;
}

interface RawIgnoredPair {
  id: string;
  device_a_id: string;
  device_b_id: string;
}

function sortedPair(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

export function ignoredPairKey(idA: string, idB: string): string {
  return sortedPair(idA, idB).join("|");
}

export async function fetchIgnoredDevicePairs(client: SupabaseClient): Promise<IgnoredDevicePair[]> {
  const supabase = client;
  const { data, error } = await supabase.from("device_dedup_ignored").select("id, device_a_id, device_b_id");
  if (error) throw error;
  return ((data ?? []) as RawIgnoredPair[]).map((r) => ({ id: r.id, deviceAId: r.device_a_id, deviceBId: r.device_b_id }));
}

// "Bỏ qua" 1 cặp nghi trùng (yêu cầu người dùng 2026-07-29) — xác nhận đây là
// 2 thiết bị thật khác nhau, đừng gợi ý lại cặp này nữa. Lưu DB (không phải
// state trình duyệt) để còn nguyên sau F5/đổi máy, cùng tinh thần transit_
// links.format_ack ở mục 26.
export async function ignoreDevicePair(client: SupabaseClient, idA: string, idB: string): Promise<void> {
  const supabase = client;
  const [a, b] = sortedPair(idA, idB);
  const { error } = await supabase.from("device_dedup_ignored").insert({ device_a_id: a, device_b_id: b });
  if (error) throw error;
}
