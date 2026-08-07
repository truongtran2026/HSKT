import type { SupabaseClient } from "@supabase/supabase-js";
import { matchTrunkPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { isStandbyCircuitName } from "@/lib/text";

// Trang chi tiết rack ODF/DDF thiết bị (domain='device') KHÔNG có
// `port_circuit_links` thật (xem architecture.md mục "Hồ sơ ODF Thiết bị
// theo rack/port" — luồng thiết bị được định nghĩa toàn hệ thống là "circuit
// KHÔNG có port_circuit_links"). Vị trí ODF của nó chỉ là text tự do trên
// chính `circuits` — nên phải ĐỐI CHIẾU NGƯỢC (từ port suy ra luồng nào nhắc
// tới) bằng cách quét toàn bộ circuits qua matchTrunkPosition(), thay vì
// join bảng nối như PortTable.tsx (dùng cho domain='trunk').
export interface DeviceRackCircuitRef {
  id: string;
  name: string;
  // TOÀN BỘ port (trong rack đang xem) mà CHÍNH luồng này chiếm — dùng để
  // hiện "Luồng sử dụng sợi a,b" ở cột Ghi chú (DeviceRackPortView.tsx) và để
  // quyết định gộp 2 port liền kề thành 1 dòng (yêu cầu người dùng
  // 2026-07-28) — KHÔNG phải chỉ port đang xét, mà toàn bộ danh sách port
  // resolvedPorts trả về từ matchTrunkPosition() cho đúng lần match này.
  portNumbers: number[];
}

export interface DeviceRackPortRefs {
  own: DeviceRackCircuitRef[];
  next: DeviceRackCircuitRef[];
}

export interface RackPortStatusCounts {
  inUse: number;
  standby: number;
  empty: number;
}

interface RawCircuit {
  id: string;
  name: string;
  device_position_own: string | null;
  device_position_next: string | null;
}

// "next" có thể ghép "<ODF> - <thiết bị>(<trib>)" (cấu trúc 2) — chỉ lấy
// đúng phần ODF trước khi so khớp port, giống hệt cách app đang chuẩn hóa
// (xem lib/parsers/transit-text.ts splitOdfDeviceStructure, dùng ở
// DeviceCircuitList.tsx). KHÔNG được so khớp thẳng trên chuỗi gộp — sẽ quét
// nhầm cả chữ số trong tên thiết bị/trib (đã gặp lỗi này thật khi khảo sát
// dữ liệu, xem architecture.md).
function odfPartOf(rawNext: string | null): string | null {
  if (!rawNext) return null;
  const split = splitOdfDeviceStructure(rawNext);
  return split.matched ? split.odfPart ?? null : rawNext;
}

function keyOf(rackCode: string, portNumber: number): string {
  return `${rackCode.replace(/\s+/g, "").toUpperCase()}#${portNumber}`;
}

// Quét TOÀN BỘ circuits ĐÚNG 1 LẦN, đối chiếu qua matchTrunkPosition(), trả
// về map "rackCodeChuẩnHóa#portNumber" -> refs (own/next) cho MỌI rack domain
// bất kỳ cùng lúc — dùng làm nền chung cho cả 2 nhu cầu bên dưới:
// fetchDeviceRackPortRefs (1 rack, trang chi tiết) và
// fetchDeviceRackPortStatusCounts (TẤT CẢ rack, trang danh sách) — tránh lặp
// lại query + so khớp riêng cho từng rack (112 rack domain='device' hiện có).
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
async function fetchAllDeviceRackPortRefs(client: SupabaseClient, trunkPorts: TrunkPortRow[]): Promise<Map<string, DeviceRackPortRefs>> {
  const supabase = client;
  const { data, error } = await supabase.from("circuits").select("id, name, device_position_own, device_position_next");
  if (error) throw error;
  const circuits = (data ?? []) as RawCircuit[];

  const map = new Map<string, DeviceRackPortRefs>();

  function record(text: string | null, circuit: RawCircuit, field: "own" | "next") {
    if (!text) return;
    const match = matchTrunkPosition(text, trunkPorts);
    if (!match.matched || !match.rackCode) return;
    if (match.invalidPortNumbers && match.invalidPortNumbers.length > 0) return;
    const resolvedPorts = match.resolvedPorts ?? [];
    const portNumbers = resolvedPorts.map((p) => p.portNumber);
    for (const p of resolvedPorts) {
      const key = keyOf(match.rackCode, p.portNumber);
      if (!map.has(key)) map.set(key, { own: [], next: [] });
      map.get(key)![field].push({ id: circuit.id, name: circuit.name, portNumbers });
    }
  }

  for (const c of circuits) {
    record(c.device_position_own, c, "own");
    record(odfPartOf(c.device_position_next), c, "next");
  }
  return map;
}

// Build map portNumber -> { own, next } cho ĐÚNG 1 rack (so theo rackCode đã
// chuẩn hóa) — dùng ở trang chi tiết rack (DeviceRackPortView).
export async function fetchDeviceRackPortRefs(
  client: SupabaseClient,
  rackCode: string,
  trunkPorts: TrunkPortRow[]
): Promise<Map<number, DeviceRackPortRefs>> {
  const all = await fetchAllDeviceRackPortRefs(client, trunkPorts);
  const normalizedTarget = rackCode.replace(/\s+/g, "").toUpperCase();
  const result = new Map<number, DeviceRackPortRefs>();
  for (const [key, refs] of all) {
    const sep = key.lastIndexOf("#");
    if (key.slice(0, sep) !== normalizedTarget) continue;
    result.set(Number(key.slice(sep + 1)), refs);
  }
  return result;
}

// "Đang dùng/Dự phòng/Trống" cho danh sách rack ODF thiết bị (yêu cầu người
// dùng 2026-07-28: số liệu cũ đọc thẳng `ports.status` toàn hiện 0/48 sai —
// cột đó được suy đoán lúc import theo tên rack, KHÔNG hề cập nhật khi luồng
// thiết bị gán/xóa vị trí qua device_position_own/next (luồng thiết bị không
// đụng gì tới bảng ports thật, xem lib/portStatus.ts). Tính lại ĐÚNG bằng
// cách đối chiếu port với chính dữ liệu luồng thật, cùng nguyên tắc
// derivePortStatus() bên trung kế: có luồng tham chiếu (own/next) mà TÊN khớp
// isStandbyCircuitName() ("DP..."/"dự phòng") -> Dự phòng; có luồng tham
// chiếu (bất kỳ tên khác) -> Đang dùng; không ai nhắc tới -> Trống.
export async function fetchDeviceRackPortStatusCounts(
  client: SupabaseClient,
  racks: { id: string; code: string; portCount: number }[],
  trunkPorts: TrunkPortRow[]
): Promise<Map<string, RackPortStatusCounts>> {
  const all = await fetchAllDeviceRackPortRefs(client, trunkPorts);
  const result = new Map<string, RackPortStatusCounts>();
  for (const rack of racks) {
    let inUse = 0;
    let standby = 0;
    let empty = 0;
    for (let n = 1; n <= rack.portCount; n++) {
      const refs = all.get(keyOf(rack.code, n));
      const names = refs ? [...refs.own, ...refs.next].map((r) => r.name) : [];
      if (names.length === 0) empty++;
      else if (names.some((name) => isStandbyCircuitName(name))) standby++;
      else inUse++;
    }
    result.set(rack.id, { inUse, standby, empty });
  }
  return result;
}
