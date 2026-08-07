import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";

// Đối xứng với lib/transitPositionMismatches.ts nhưng so "circuits" (Hồ sơ
// đấu nối) thay vì "transit_links" (Chuyển tiếp bên trung kế). Phát hiện được
// nhờ sửa khóa maybeGrowLibrary() ở DeviceCircuitList.tsx sang (Thiết bị,
// Trib) đúng nghiệp vụ (2026-08-03): khi Trib đã có trong thư viện nhưng ODF
// vừa lưu ghi khác đi, hàm đó KHÔNG tự ghi đè (có thể lần lưu này sai, hoặc
// thư viện đang sai) — dòng lệch được giữ nguyên ở cả 2 nơi cho tới khi người
// dùng tự xử lý ở đây.
export interface DeviceCircuitLibraryMismatch {
  circuitId: string;
  circuitName: string;
  deviceName: string;
  trib: string;
  circuitOdfPosition: string; // circuits.device_position_own
  libraryOdfPosition: string; // device_position_map.odf_position
  devicePositionMapId: string;
}

export function findDeviceCircuitLibraryMismatches(
  circuits: DeviceCircuitRow[],
  devicePositionMap: DevicePositionMapRow[]
): DeviceCircuitLibraryMismatch[] {
  const result: DeviceCircuitLibraryMismatch[] = [];
  for (const c of circuits) {
    if (!c.deviceName || !c.tribText || !c.devicePositionOwn) continue;
    const nameKey = normalizeDeviceNameKey(c.deviceName);
    const tribKey = normalizeDevicePositionKey(c.tribText);
    const candidates = devicePositionMap.filter(
      (m) => normalizeDeviceNameKey(m.deviceName) === nameKey && normalizeDevicePositionKey(m.devicePosition ?? "") === tribKey
    );
    if (candidates.length === 0) continue; // Chưa có trong thư viện — không phải mismatch, lần lưu sau tự thêm.
    const distinctOdf = new Set(candidates.map((m) => normalizeDevicePositionKey(m.odfPosition ?? "")));
    if (distinctOdf.size > 1) continue; // Dữ liệu cũ còn >1 dòng trùng Trib (trước khi có validate) — mơ hồ, không đoán.
    const lib = candidates[0];
    if (normalizeDevicePositionKey(c.devicePositionOwn) === normalizeDevicePositionKey(lib.odfPosition ?? "")) continue; // Đã khớp.
    result.push({
      circuitId: c.id,
      circuitName: c.name,
      deviceName: c.deviceName,
      trib: c.tribText,
      circuitOdfPosition: c.devicePositionOwn,
      libraryOdfPosition: lib.odfPosition ?? "",
      devicePositionMapId: lib.id,
    });
  }
  return result;
}

// 3 hướng xử lý — cùng tinh thần transitPositionMismatches.ts (không có
// nguồn nào mặc định "đúng", người dùng tự chọn).
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function applyLibraryFromCircuit(client: SupabaseClient, m: DeviceCircuitLibraryMismatch): Promise<void> {
  const supabase = client;
  const { error } = await supabase.from("device_position_map").update({ odf_position: m.circuitOdfPosition }).eq("id", m.devicePositionMapId);
  if (error) throw error;
}

export async function applyCircuitFromLibrary(client: SupabaseClient, m: DeviceCircuitLibraryMismatch): Promise<void> {
  const supabase = client;
  const { error } = await supabase.from("circuits").update({ device_position_own: m.libraryOdfPosition }).eq("id", m.circuitId);
  if (error) throw error;
}

export async function applyCustomPosition(client: SupabaseClient, m: DeviceCircuitLibraryMismatch, customOdfPosition: string): Promise<void> {
  const supabase = client;
  const trimmed = customOdfPosition.trim();
  if (!trimmed) throw new Error("Chưa nhập tọa độ ODF mới.");
  const { error: circuitErr } = await supabase.from("circuits").update({ device_position_own: trimmed }).eq("id", m.circuitId);
  if (circuitErr) throw circuitErr;
  const { error: libErr } = await supabase.from("device_position_map").update({ odf_position: trimmed }).eq("id", m.devicePositionMapId);
  if (libErr) throw libErr;
}
