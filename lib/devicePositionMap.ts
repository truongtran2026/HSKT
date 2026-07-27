import { supabase } from "@/lib/supabase";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";

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

// Làm giàu thư viện theo chiều NGƯỢC với maybeGrowLibrary (DeviceCircuitList.tsx
// — kiểm tồn tại theo cặp device+ODF, dùng khi người dùng gõ thẳng vị trí ODF
// bên luồng thiết bị). Ở đây đã biết CHẮC device+trib(port) từ text "Chuyển
// tiếp" bên trung kế (yêu cầu người dùng 2026-07-27), nên kiểm tồn tại theo
// cặp device+TRIB: đã có thì tin thư viện, giữ nguyên (không đè); chưa có thì
// thêm dòng mới. Không tự sửa ngược lại raw_text bên trung kế theo thư viện
// trong đợt này, giữ đơn giản.
export async function growDevicePositionMapByTrib(
  deviceName: string,
  devicePosition: string,
  odfPosition: string
): Promise<{ grown: boolean }> {
  const nameKey = normalizeDeviceNameKey(deviceName);
  const tribKey = normalizeDevicePositionKey(devicePosition);
  if (!nameKey || !tribKey || !odfPosition.trim()) return { grown: false };

  const pageSize = 1000;
  let exists = false;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("device_position_map")
      .select("device_name, device_position")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as { device_name: string; device_position: string | null }[];
    if (
      page.some(
        (r) => normalizeDeviceNameKey(r.device_name) === nameKey && normalizeDevicePositionKey(r.device_position ?? "") === tribKey
      )
    ) {
      exists = true;
    }
    if (page.length < pageSize) break;
  }
  if (exists) return { grown: false };

  const { error: insErr } = await supabase
    .from("device_position_map")
    .insert({ device_name: deviceName, device_position: devicePosition, odf_position: odfPosition.trim() });
  if (insErr) throw insErr;
  return { grown: true };
}
