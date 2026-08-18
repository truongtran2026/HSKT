import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, normalizeDevicePositionKey, looksLikeRealPositionText } from "@/lib/deviceNotes";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";

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

// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function fetchDevicePositionMap(client: SupabaseClient): Promise<DevicePositionMapRow[]> {
  const supabase = client;
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
export async function syncDevicePositionMapNames(client: SupabaseClient, oldNames: string[], newName: string): Promise<void> {
  const supabase = client;
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

// Dọn device_position_map khi 1/nhiều thiết bị bị XÓA HẲN (yêu cầu người dùng
// 2026-07-28, trang "Danh mục thiết bị") — device_position_map không có FK
// thật tới devices (khớp bằng tên, xem đầu file), nên xóa thiết bị không tự
// động dọn thư viện: nếu không gọi hàm này, thư viện sẽ còn sót gợi ý (tên
// thiết bị + vị trí ODF) cho 1 thiết bị không còn tồn tại nữa.
export async function deleteDevicePositionMapForNames(client: SupabaseClient, names: string[]): Promise<void> {
  const supabase = client;
  const keys = new Set(names.map((n) => normalizeDeviceNameKey(n)).filter((k) => k));
  if (keys.size === 0) return;

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
    for (const r of page) if (keys.has(normalizeDeviceNameKey(r.device_name))) matchingIds.push(r.id);
    if (page.length < pageSize) break;
  }
  if (matchingIds.length === 0) return;

  const chunkSize = 200;
  for (let i = 0; i < matchingIds.length; i += chunkSize) {
    const batch = matchingIds.slice(i, i + chunkSize);
    const { error } = await supabase.from("device_position_map").delete().in("id", batch);
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
  client: SupabaseClient,
  deviceName: string,
  devicePosition: string,
  odfPosition: string
): Promise<{ grown: boolean }> {
  const supabase = client;
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

// Gợi ý "mẫu port/trib đã dùng" cho 1 thiết bị cụ thể (yêu cầu người dùng
// 2026-07-29, ô "Chuyển tiếp" bên trung kế tách ô Thiết bị/Port) — dữ liệu
// thật cho thấy nhiều kiểu viết khác nhau cùng tồn tại cho cùng 1 khái niệm
// (vd "1-23-10", "1/23/10", "S23/10", "S23-10"), KHÔNG có 1 chuẩn chung nào
// để tự đoán/chuyển đổi an toàn giữa các kiểu — nên CHỈ liệt kê giá trị ĐÃ
// DÙNG THẬT cho đúng thiết bị này (lấy từ device_position_map.device_position
// đã tải sẵn 1 lần, không query lại mỗi lần gõ) để người dùng tự chọn/soi
// theo, không tự bịa ra 1 kiểu viết chuẩn hóa mới.
export function distinctPositionsForDevice(deviceName: string, all: DevicePositionMapRow[]): string[] {
  const key = normalizeDeviceNameKey(deviceName);
  if (!key) return [];
  const set = new Set<string>();
  for (const r of all) {
    if (r.devicePosition && normalizeDeviceNameKey(r.deviceName) === key) set.add(r.devicePosition);
  }
  return [...set].sort();
}

export interface DevicePositionLibraryMatch {
  deviceName: string;
  devicePosition: string | null;
  odfPosition: string | null;
}

// Tra ngược "Vị trí ODF" -> dòng thư viện, KHÔNG cần biết trước thiết bị nào
// đang cắm vào đó — quét toàn bộ thư viện tìm đúng 1 dòng có odfPosition khớp
// (yêu cầu người dùng 2026-08-17, dùng cho Ô1 "Vị trí ODF (tiếp theo)" bên Hồ
// sơ đấu nối; dùng lại 2026-08-18 cho Ô1 "Chuyển tiếp" bên ODF trung kế —
// PortTable.tsx — cùng 1 thư viện device_position_map nên tách ra đây dùng
// chung, tránh 2 bản logic dò lệch nhau). odfValue nên đã chuẩn hóa "ODF x/y
// (a,b)" trước khi gọi (xem formatCanonicalOdfPosition) — thư viện lưu đúng
// dạng này nên so khớp thô (chỉ chuẩn hóa khoảng trắng/dấu) là đủ.
export function findLibraryMatchByOdfAny(odfValue: string, rows: DevicePositionMapRow[]): DevicePositionLibraryMatch | null {
  const target = normalizeDevicePositionKey(odfValue);
  if (!target) return null;
  const row = rows.find((m) => normalizeDevicePositionKey(m.odfPosition ?? "") === target);
  if (!row) return null;
  return { deviceName: row.deviceName, devicePosition: row.devicePosition, odfPosition: row.odfPosition };
}

export interface RelatedCircuitRef {
  id: string;
  name: string;
  side: "own" | "next"; // "own": chính luồng của thiết bị/Trib này đang dùng dòng thư viện; "next": luồng của THIẾT BỊ KHÁC đang trỏ tới đúng vị trí ODF này
  deviceName: string | null;
  tribText: string | null;
}

interface RawCircuitForRelatedScan {
  id: string;
  name: string;
  trib_text: string | null;
  device_position_own: string | null;
  device_position_next: string | null;
  devices: { name: string } | { name: string }[] | null;
}

function deviceNameOfRawCircuit(c: RawCircuitForRelatedScan): string | null {
  const d = c.devices;
  if (!d) return null;
  return Array.isArray(d) ? (d[0]?.name ?? null) : d.name;
}

// Thư viện chỉ là gợi ý được "làm giàu" TỪ chính circuits (xem
// growDevicePositionMapByTrib/maybeGrowLibrary ở DeviceCircuitList.tsx) —
// không phải nguồn sự thật. Sửa/xóa 1 dòng thư viện mà vẫn còn luồng THẬT
// đang tham chiếu đúng vị trí đó là dữ liệu lệch nhau (yêu cầu người dùng
// 2026-08-17: "thư viện xóa mà luồng vẫn còn thì ko logic") — quét trước để
// chủ động cảnh báo/đề xuất xóa luôn, KHÔNG tự động xóa (destructive, phải
// để người dùng xác nhận từng luồng).
export async function findCircuitsUsingLibraryRow(
  client: SupabaseClient,
  row: { deviceName: string; devicePosition: string; odfPosition: string }
): Promise<RelatedCircuitRef[]> {
  if (!looksLikeRealPositionText(row.odfPosition)) return []; // "Kết nối trực tiếp" dùng chung nhiều Trib, không phải 1 vị trí duy nhất để đối chiếu.
  const nameKey = normalizeDeviceNameKey(row.deviceName);
  const tribKey = normalizeDevicePositionKey(row.devicePosition);
  const odfKey = normalizeDevicePositionKey(row.odfPosition);

  const supabase = client;
  const pageSize = 1000;
  const circuits: RawCircuitForRelatedScan[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("circuits")
      .select("id, name, trib_text, device_position_own, device_position_next, devices(name)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawCircuitForRelatedScan[];
    circuits.push(...page);
    if (page.length < pageSize) break;
  }

  const result: RelatedCircuitRef[] = [];
  for (const c of circuits) {
    const ownDeviceName = deviceNameOfRawCircuit(c);
    const isOwnMatch =
      ownDeviceName != null &&
      normalizeDeviceNameKey(ownDeviceName) === nameKey &&
      normalizeDevicePositionKey(c.trib_text ?? "") === tribKey &&
      normalizeDevicePositionKey(c.device_position_own ?? "") === odfKey;
    if (isOwnMatch) {
      result.push({ id: c.id, name: c.name, side: "own", deviceName: ownDeviceName, tribText: c.trib_text });
      continue; // 1 circuit chỉ đúng 1 chiều — đã khớp "own" thì không cần soát "next" nữa.
    }
    if (!c.device_position_next) continue;
    const split = splitOdfDeviceStructure(c.device_position_next);
    const odfPart = split.matched ? (split.odfPart ?? "") : c.device_position_next;
    if (normalizeDevicePositionKey(odfPart) === odfKey) {
      result.push({ id: c.id, name: c.name, side: "next", deviceName: ownDeviceName, tribText: c.trib_text });
    }
  }
  return result;
}

export interface LibraryOwnPositionDuplicate {
  deviceName: string;
  positionText: string;
  entries: { id: string; devicePosition: string }[];
}

// Rà soát DỮ LIỆU CŨ trong chính thư viện theo cùng rule uniqueness vừa thêm
// ở validate Thêm/Sửa tay (DevicePositionMapClient.tsx, yêu cầu người dùng
// 2026-08-03): 1 thiết bị không được có 2 Trib khác nhau cùng chung 1 vị trí
// ODF/DDF thật (trừ "Kết nối trực tiếp"). Group theo device_name (KHÔNG theo
// deviceId như findDeviceOwnPositionDuplicates ở lib/deviceCircuits.ts — bảng
// này không có FK thật tới devices, chỉ khớp bằng tên chuẩn hóa) — chỉ liệt
// kê để người dùng tự sửa, validate mới chỉ chặn được dữ liệu THÊM SAU này.
export function findLibraryOwnPositionDuplicates(rows: DevicePositionMapRow[]): LibraryOwnPositionDuplicate[] {
  const byDevice = new Map<string, DevicePositionMapRow[]>();
  for (const r of rows) {
    const key = normalizeDeviceNameKey(r.deviceName);
    if (!key) continue;
    const list = byDevice.get(key) ?? [];
    list.push(r);
    byDevice.set(key, list);
  }
  const result: LibraryOwnPositionDuplicate[] = [];
  for (const list of byDevice.values()) {
    const byPosition = new Map<string, { positionText: string; entries: LibraryOwnPositionDuplicate["entries"]; tribKeys: Set<string> }>();
    for (const r of list) {
      const pos = r.odfPosition;
      if (!pos || !looksLikeRealPositionText(pos)) continue;
      const posKey = normalizeDevicePositionKey(pos);
      if (!posKey) continue;
      const tribKey = normalizeDevicePositionKey(r.devicePosition ?? "");
      const entry = byPosition.get(posKey) ?? { positionText: pos, entries: [], tribKeys: new Set<string>() };
      entry.entries.push({ id: r.id, devicePosition: r.devicePosition ?? "(trống)" });
      if (tribKey) entry.tribKeys.add(tribKey);
      byPosition.set(posKey, entry);
    }
    for (const entry of byPosition.values()) {
      if (entry.tribKeys.size > 1) {
        result.push({ deviceName: list[0].deviceName, positionText: entry.positionText, entries: entry.entries });
      }
    }
  }
  return result;
}
