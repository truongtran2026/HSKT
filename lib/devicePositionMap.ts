import { supabase } from "@/lib/supabase";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";

// Tra cứu "thiết bị + vị trí thiết bị -> vị trí ODF/DDF" — xem migration
// 20260724000001_device_position_map.sql. Bảng độc lập, KHÔNG đụng
// circuits/devices, vì 1 thiết bị có thể có nhiều vị trí ra ODF/DDF khác nhau.
export interface DevicePositionMapRow {
  id: string;
  deviceName: string;
  devicePosition: string | null;
  odfPosition: string | null;
}

interface RawRow {
  id: string;
  device_name: string;
  device_position: string | null;
  odf_position: string | null;
}

export async function fetchDevicePositionMap(): Promise<DevicePositionMapRow[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("device_position_map")
      .select("id, device_name, device_position, odf_position")
      .order("device_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.map((r) => ({
    id: r.id,
    deviceName: r.device_name,
    devicePosition: r.device_position,
    odfPosition: r.odf_position,
  }));
}

// Đồng bộ device_position_map khi 1 thiết bị bị đổi tên/gộp ở trang "Chuẩn
// hóa thiết bị" (yêu cầu người dùng 2026-07-27): trước đây đổi tên thiết bị
// ở đó không đụng gì tới device_position_map, nên các dòng thư viện đang
// khớp tên CŨ (hoặc khớp 1 trong các biến thể tên gốc lấy từ ghi chú) lập
// tức rơi vào "Chưa phân loại" — người dùng phải mở khung "Chuẩn hóa tên
// thiết bị chưa khớp" ở tab Vị trí thiết bị làm lại LẦN NỮA cho đúng cùng 1
// thiết bị. Gọi hàm này ngay sau khi đổi tên/gộp/tạo mới ở Chuẩn hóa thiết bị
// để chỉ cần làm 1 lần duy nhất.
export async function syncDevicePositionMapNames(oldNames: string[], newName: string): Promise<void> {
  const newKey = normalizeDeviceNameKey(newName);
  const oldKeys = new Set(oldNames.map((n) => normalizeDeviceNameKey(n)).filter((k) => k && k !== newKey));
  if (oldKeys.size === 0) return;

  const pageSize = 1000;
  const matchingIds: string[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("device_position_map")
      .select("id, device_name")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as { id: string; device_name: string }[];
    for (const r of page) if (oldKeys.has(normalizeDeviceNameKey(r.device_name))) matchingIds.push(r.id);
    if (page.length < pageSize) break;
  }
  if (matchingIds.length === 0) return;

  const chunkSize = 200;
  for (let i = 0; i < matchingIds.length; i += chunkSize) {
    const batch = matchingIds.slice(i, i + chunkSize);
    const { error } = await supabase.from("device_position_map").update({ device_name: newName }).in("id", batch);
    if (error) throw error;
  }
}
