import type { SupabaseClient } from "@supabase/supabase-js";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { looseDeviceNameSegments, normalizeDevicePositionKey } from "@/lib/deviceNotes";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";

// Phát hiện: ô "Chuyển tiếp" (transit_links.raw_text) bên ODF trung kế ghi
// dạng "ODF x/y (a,b) - Thiết bị (trib)" NHƯNG phần tọa độ ODF ("ODF x/y
// (a,b)") KHÁC với tọa độ ghi trong device_position_map (thư viện "Vị trí
// thiết bị" — danh mục tra cứu độc lập, xem architecture.md mục 3.10 điểm 2)
// cho ĐÚNG thiết bị+trib đó — yêu cầu người dùng 2026-08-02, phát hiện từ ca
// thật ADN1.P2(2/1/2).
//
// SỬA 2026-08-02 (cùng ngày, sau phản hồi người dùng): bản đầu tự động coi
// device_position_map LUÔN đúng và chỉ cho sửa 1 chiều (ghi đè Chuyển tiếp) —
// người dùng chỉ ra đây là ÁP ĐẶT sai: device_position_map đến từ 1 đợt import
// Excel riêng (126 file thiết bị, 2026-07-25 — xem scripts/import-device-v2.ts),
// đáng tin hơn vì độc lập với file trung kế, NHƯNG vẫn chỉ là 1 nguồn dữ liệu
// có thể tự nó sai — và CẢ HAI có thể cùng sai (cần nhập tay giá trị thật).
// Đổi hẳn: KHÔNG còn gắn nhãn "đúng"/"sai" nào nữa, chỉ liệt kê 2 giá trị
// NGANG HÀNG + để người dùng tự chọn 1 trong 3 hướng xử lý (xem 3 hàm apply*
// bên dưới, dùng ở TransitPositionMismatchTab.tsx):
//   1. Dùng giá trị Chuyển tiếp -> ghi đè LẠI THƯ VIỆN (device_position_map
//      tự nó sai, để lại raw_text nguyên).
//   2. Dùng giá trị Vị trí thiết bị -> ghi đè Chuyển tiếp (hành vi CŨ, giữ
//      lại làm 1 trong 3 lựa chọn chứ không còn tự động).
//   3. Nhập giá trị khác -> cả 2 nguồn đều sai, người dùng gõ tọa độ ĐÚNG
//      (theo kiến thức thực địa), ghi vào CẢ 2 nơi cho khớp nhau.
//
// CHỈ liệt kê khi khớp được ĐÚNG 1 dòng device_position_map cho thiết bị+trib
// đó (tên so khớp LỎNG qua looseDeviceNameSegments — cùng thuật toán mục 43).
// Nếu khớp NHIỀU dòng có tọa độ khác nhau (mơ hồ) hoặc KHÔNG khớp dòng nào —
// bỏ qua, không đoán đại.
export interface TransitPositionMismatch {
  transitLinkId: string;
  rackId: string;
  rackCode: string;
  portId: string;
  portNumber: number;
  rawText: string;
  /** Tọa độ ODF hiện ghi trong Chuyển tiếp (trung kế). */
  transitOdfPart: string;
  /** Phần "Thiết bị (trib)" trong Chuyển tiếp — GIỮ NGUYÊN ở cả 3 hướng xử lý. */
  devicePortText: string;
  deviceName: string;
  trib: string;
  /** Tọa độ ODF hiện ghi trong thư viện Vị trí thiết bị. */
  libraryOdfPosition: string;
  /** id dòng device_position_map tương ứng — cần để sửa được thư viện. */
  devicePositionMapId: string;
}

interface RawRack {
  code: string;
  domain: string;
}
interface RawPort {
  id: string;
  port_number: number;
  rack_id: string;
  racks: RawRack | RawRack[] | null;
}
interface RawRow {
  id: string;
  raw_text: string | null;
  ports: RawPort | RawPort[] | null;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
}

// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function findTransitPositionMismatches(client: SupabaseClient, devicePositionMap: DevicePositionMapRow[]): Promise<TransitPositionMismatch[]> {
  const supabase = client;
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transit_links")
      .select("id, raw_text, ports:ports!transit_links_source_port_id_fkey(id, port_number, rack_id, racks(code, domain))")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  const result: TransitPositionMismatch[] = [];
  for (const row of all) {
    const port = firstOf(row.ports);
    if (!port) continue;
    const rack = firstOf(port.racks);
    if (!rack || rack.domain !== "trunk") continue;
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue;

    const split = splitOdfDeviceStructure(raw);
    if (!split.matched || !split.odfPart || !split.deviceName || !split.port) continue;

    const typedKey = looseDeviceNameSegments(split.deviceName).join(" ");
    const tribKey = normalizeDevicePositionKey(split.port);
    const candidates = devicePositionMap.filter(
      (p) =>
        p.devicePosition &&
        p.odfPosition &&
        looseDeviceNameSegments(p.deviceName).join(" ") === typedKey &&
        normalizeDevicePositionKey(p.devicePosition) === tribKey
    );
    if (candidates.length === 0) continue;

    const odfNumbers = extractNumbers(split.odfPart);
    const distinctLibrary = new Set(candidates.map((c) => c.odfPosition));
    if (distinctLibrary.size > 1) continue; // Mơ hồ (nhiều tọa độ khác nhau cho cùng thiết bị+trib) — không đoán.

    const libraryOdfPosition = candidates[0].odfPosition!;
    const libraryNumbers = extractNumbers(libraryOdfPosition);
    if (JSON.stringify(libraryNumbers) === JSON.stringify(odfNumbers)) continue; // Đã khớp, không phải lỗi.

    result.push({
      transitLinkId: row.id,
      rackId: port.rack_id,
      rackCode: rack.code,
      portId: port.id,
      portNumber: port.port_number,
      rawText: raw,
      transitOdfPart: split.odfPart,
      devicePortText: split.devicePortText ?? `${split.deviceName} (${split.port})`,
      deviceName: split.deviceName,
      trib: split.port,
      libraryOdfPosition,
      devicePositionMapId: candidates[0].id,
    });
  }
  return result;
}

// 3 hướng xử lý — người dùng chọn ở UI (TransitPositionMismatchTab.tsx),
// KHÔNG có hướng nào tự động mặc định.

// Hướng 1: Chuyển tiếp đúng -> ghi đè thư viện Vị trí thiết bị theo Chuyển tiếp.
export async function applyLibraryFromTransit(client: SupabaseClient, m: TransitPositionMismatch): Promise<void> {
  const supabase = client;
  const { error } = await supabase.from("device_position_map").update({ odf_position: m.transitOdfPart }).eq("id", m.devicePositionMapId);
  if (error) throw error;
}

// Hướng 2: Thư viện Vị trí thiết bị đúng -> ghi đè Chuyển tiếp theo thư viện
// (giữ nguyên phần "Thiết bị (trib)").
export async function applyTransitFromLibrary(client: SupabaseClient, m: TransitPositionMismatch): Promise<void> {
  const supabase = client;
  const newRawText = `${m.libraryOdfPosition} - ${m.devicePortText}`;
  const { error } = await supabase.from("transit_links").update({ raw_text: newRawText }).eq("id", m.transitLinkId);
  if (error) throw error;
}

// Hướng 3: CẢ HAI đều sai -> người dùng tự gõ tọa độ đúng, ghi vào CẢ 2 nơi
// cho khớp nhau lại.
export async function applyCustomPosition(client: SupabaseClient, m: TransitPositionMismatch, customOdfPosition: string): Promise<void> {
  const supabase = client;
  const trimmed = customOdfPosition.trim();
  if (!trimmed) throw new Error("Chưa nhập tọa độ ODF mới.");
  const newRawText = `${trimmed} - ${m.devicePortText}`;
  const { error: transitErr } = await supabase.from("transit_links").update({ raw_text: newRawText }).eq("id", m.transitLinkId);
  if (transitErr) throw transitErr;
  const { error: libErr } = await supabase.from("device_position_map").update({ odf_position: trimmed }).eq("id", m.devicePositionMapId);
  if (libErr) throw libErr;
}
