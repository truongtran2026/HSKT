import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, looseDeviceNameSegments } from "@/lib/deviceNotes";
import type { DeviceRow } from "@/lib/devices";

// Bảng device_aliases (migration 20260801000001) — mỗi dòng là 1 cách gõ đã
// được người dùng XÁC NHẬN là cùng 1 thiết bị thật (xem architecture.md mục
// 43). Bảng nhỏ, tải 1 lần cho cả trang giống fetchDevices(), không cần lazy.
export interface DeviceAliasRow {
  id: string;
  deviceId: string;
  aliasText: string;
  normalizedKey: string;
}

// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function fetchDeviceAliases(client: SupabaseClient): Promise<DeviceAliasRow[]> {
  const supabase = client;
  const { data, error } = await supabase.from("device_aliases").select("id, device_id, alias_text, normalized_key");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    deviceId: r.device_id as string,
    aliasText: r.alias_text as string,
    normalizedKey: r.normalized_key as string,
  }));
}

// Ghi 1 cách gõ đã xác nhận — ignoreDuplicates để KHÔNG âm thầm cướp 1
// normalized_key đã trỏ tới thiết bị khác nếu chẳng may trùng (an toàn hơn
// upsert ghi đè), lỗi (nếu có) không chặn luồng lưu chính ở nơi gọi.
export async function saveDeviceAlias(client: SupabaseClient, deviceId: string, aliasText: string): Promise<void> {
  const supabase = client;
  const normalizedKey = normalizeDeviceNameKey(aliasText);
  if (!normalizedKey) return;
  const { error } = await supabase
    .from("device_aliases")
    .upsert({ device_id: deviceId, alias_text: aliasText, normalized_key: normalizedKey }, { onConflict: "normalized_key", ignoreDuplicates: true });
  if (error) throw error;
}

// Cấp 1+2: khớp CHÍNH XÁC sau chuẩn hóa (đúng cơ chế cũ) rồi tới alias đã
// biết chắc (KHÔNG cần hỏi lại người dùng — đã xác nhận từ trước).
export function resolveDeviceByExactOrAlias(
  typedName: string,
  devices: DeviceRow[],
  aliases: DeviceAliasRow[]
): DeviceRow | null {
  const key = normalizeDeviceNameKey(typedName);
  if (!key) return null;
  const exact = devices.find((d) => normalizeDeviceNameKey(d.name) === key);
  if (exact) return exact;
  const aliasHit = aliases.find((a) => a.normalizedKey === key);
  if (!aliasHit) return null;
  return devices.find((d) => d.id === aliasHit.deviceId) ?? null;
}

// true nếu `shorter` là TIỀN TỐ đúng thứ tự của `longer` (từng đoạn khớp
// chính xác — so sánh mảng, KHÔNG so chuỗi đã join, để tránh lỗi biên "1" bị
// coi là tiền tố chuỗi của "12"). Bắt được ca thật 2026-08-01: người dùng gõ
// tắt "ADN1.OMEMSPP#01" (thiếu "-" + thiếu hậu tố "RMT2") cho thiết bị đã lưu
// đầy đủ "ADN1.OME-MSPP#1 RMT2" — đoạn hóa 2 chuỗi này là ["omemspp","1"] và
// ["omemspp","1","rmt","2"], vế đầu là tiền tố đúng thứ tự của vế sau.
function isSegmentPrefix(shorter: string[], longer: string[]): boolean {
  if (shorter.length === 0 || shorter.length >= longer.length) return false;
  return shorter.every((seg, i) => seg === longer[i]);
}

// Cấp 3: KHÔNG khớp chính xác/alias — thử so khớp lỏng (khớp đủ HOẶC gõ tắt
// là tiền tố của tên đầy đủ hơn), chỉ trả về gợi ý khi ra ĐÚNG 1 ứng viên
// (>=2 ứng viên nghĩa là mơ hồ, không tự đoán — đúng triết lý "không tự
// đoán" xuyên suốt dự án; vd gõ "PE2" ngắn/chung chung khớp tiền tố nhiều
// thiết bị thì tự động KHÔNG gợi ý gì, an toàn).
export function findLooseDeviceCandidate(typedName: string, devices: DeviceRow[]): DeviceRow | null {
  const typedSegments = looseDeviceNameSegments(typedName);
  if (typedSegments.length === 0) return null;
  const typedKey = typedSegments.join(" ");
  const matches = devices.filter((d) => {
    const deviceSegments = looseDeviceNameSegments(d.name);
    return deviceSegments.join(" ") === typedKey || isSegmentPrefix(typedSegments, deviceSegments);
  });
  return matches.length === 1 ? matches[0] : null;
}
