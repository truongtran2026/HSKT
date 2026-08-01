import { supabase } from "@/lib/supabase";
import { normalizeDeviceNameKey, looseDeviceNameKey } from "@/lib/deviceNotes";
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

export async function fetchDeviceAliases(): Promise<DeviceAliasRow[]> {
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
export async function saveDeviceAlias(deviceId: string, aliasText: string): Promise<void> {
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

// Cấp 3: KHÔNG khớp chính xác/alias — thử so khớp lỏng (looseDeviceNameKey),
// chỉ trả về gợi ý khi ra ĐÚNG 1 ứng viên (>=2 ứng viên nghĩa là mơ hồ, không
// tự đoán — đúng triết lý "không tự đoán" xuyên suốt dự án).
export function findLooseDeviceCandidate(typedName: string, devices: DeviceRow[]): DeviceRow | null {
  const key = looseDeviceNameKey(typedName);
  if (!key) return null;
  const matches = devices.filter((d) => looseDeviceNameKey(d.name) === key);
  return matches.length === 1 ? matches[0] : null;
}
