import { supabase } from "@/lib/supabase";
import { extractDeviceNameFromNotes, looksLikeRealPositionText, normalizeDevicePositionKey } from "@/lib/deviceNotes";

// Luồng thuộc ODF/DDF thiết bị (file M3.TD-1_2) — lần import đầu CHỈ tạo
// circuits cho file này, KHÔNG tạo racks/ports/devices thật (xem
// architecture.md mục 7.2: định dạng tọa độ quá đa dạng giữa các loại thiết
// bị, để chuẩn hóa dần ở giai đoạn 7 thay vì đoán hàng loạt lúc import).
// Vì vậy nhận diện "luồng thiết bị" = luồng CHƯA gán port nào cả (khác với
// luồng trung kế luôn có port_circuit_links).
export interface DeviceCircuitRow {
  id: string;
  name: string;
  interfaceType: string | null;
  tribText: string | null;
  counterpartText: string | null;
  notes: string | null;
  deviceName: string | null; // suy từ dòng "Thiết bị: ..." đầu tiên trong notes
  deviceId: string | null; // đã chuẩn hóa qua /odf-device/chuan-hoa hay chưa
  devicePositionOwn: string | null; // vị trí ODF/DDF cáp CHÍNH thiết bị này đấu ra
  devicePositionNext: string | null; // vị trí ODF tiếp theo / nhảy lên ODF trung kế đi ra ngoài
  updatedAt: string; // lần cuối sửa (migration circuits.updated_at, 2026-07-27)
}

interface RawRow {
  id: string;
  name: string;
  interface_type: string | null;
  trib_text: string | null;
  counterpart_text: string | null;
  notes: string | null;
  device_id: string | null;
  device_position_own: string | null;
  device_position_next: string | null;
  updated_at: string;
  devices: { name: string } | null;
  port_circuit_links: { id: string }[] | null;
}

// Xem lib/trunkPorts.ts để biết lý do PHẢI phân trang + sort có tiêu chí phụ
// "id" (duy nhất) — cùng 1 lớp lỗi đã gặp thực tế ở trang Tìm kiếm nhanh.
async function fetchAllCircuits(): Promise<RawRow[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("circuits")
      .select(
        "id, name, interface_type, trib_text, counterpart_text, notes, device_id, device_position_own, device_position_next, updated_at, devices(name), port_circuit_links(id)"
      )
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function fetchDeviceCircuits(): Promise<DeviceCircuitRow[]> {
  const all = await fetchAllCircuits();
  return all
    .filter((r) => !r.port_circuit_links || r.port_circuit_links.length === 0)
    .map((r) => ({
      id: r.id,
      name: r.name,
      interfaceType: r.interface_type,
      tribText: r.trib_text,
      counterpartText: r.counterpart_text,
      notes: r.notes,
      // Ưu tiên tên chuẩn đã lưu ở devices.name (qua /odf-device/chuan-hoa) —
      // chỉ dùng tên thô tách từ notes khi CHƯA chuẩn hóa, tránh trường hợp
      // đã chuẩn hóa xong nhưng danh sách vẫn hiện tên cũ chưa gộp.
      deviceName: r.devices?.name ?? extractDeviceNameFromNotes(r.notes),
      deviceId: r.device_id,
      devicePositionOwn: r.device_position_own,
      devicePositionNext: r.device_position_next,
      updatedAt: r.updated_at,
    }));
}

export interface DevicePositionConflict {
  positionText: string;
  entries: { deviceName: string; circuitName: string; circuitId: string }[];
}

// Tách ra từ DeviceCircuitList.tsx (yêu cầu người dùng 2026-07-29, dùng lại ở
// trang "Chất lượng dữ liệu" mới) — 1 vị trí ODF/DDF ("Vị trí ODF thiết bị")
// bị GÁN cho từ 2 thiết bị khác nhau trở lên, thường là lỗi gõ nhầm/chưa rà
// (khác trường hợp "own" của thiết bị A trùng "next" của thiết bị B, đó là
// BÌNH THƯỜNG — chỗ nhảy dây đấu nối, không tính ở đây, xem comment gốc tại
// nơi gọi cũ). Nhận thẳng DeviceCircuitRow[] (không tự fetch) để dùng chung
// được data đã tải sẵn ở cả 2 nơi gọi, không query lại.
export function findDevicePositionConflicts(circuits: DeviceCircuitRow[]): DevicePositionConflict[] {
  const map = new Map<
    string,
    { positionText: string; entries: DevicePositionConflict["entries"]; deviceIds: Set<string> }
  >();
  for (const c of circuits) {
    if (!c.deviceId) continue;
    const position = c.devicePositionOwn;
    if (!position || !looksLikeRealPositionText(position)) continue;
    const key = normalizeDevicePositionKey(position);
    if (!key) continue;
    const entry = map.get(key) ?? { positionText: position, entries: [], deviceIds: new Set<string>() };
    entry.entries.push({ deviceName: c.deviceName ?? "(không rõ)", circuitName: c.name, circuitId: c.id });
    entry.deviceIds.add(c.deviceId);
    map.set(key, entry);
  }
  // Bỏ deviceIds (Set) khỏi kết quả trả về — không serialize được qua ranh
  // giới Server Component -> Client Component props (dùng ở app/data-quality/
  // page.tsx), chỉ cần dùng nội bộ để lọc.
  return [...map.values()].filter((v) => v.deviceIds.size > 1).map((v) => ({ positionText: v.positionText, entries: v.entries }));
}
