import { supabase } from "@/lib/supabase";
import { matchTrunkPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";

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
}

export interface DeviceRackPortRefs {
  own: DeviceRackCircuitRef[];
  next: DeviceRackCircuitRef[];
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

// Build map portNumber -> { own, next } cho ĐÚNG 1 rack (so theo rackCode đã
// chuẩn hóa) — quét toàn bộ circuits 1 lần rồi lọc, thay vì query riêng cho
// từng port (2224 dòng, đủ nhẹ để lấy 1 lần cho 1 lượt xem trang).
export async function fetchDeviceRackPortRefs(
  rackCode: string,
  trunkPorts: TrunkPortRow[]
): Promise<Map<number, DeviceRackPortRefs>> {
  const { data, error } = await supabase.from("circuits").select("id, name, device_position_own, device_position_next");
  if (error) throw error;
  const circuits = (data ?? []) as RawCircuit[];

  const normalizedTarget = rackCode.replace(/\s+/g, "").toUpperCase();
  const map = new Map<number, DeviceRackPortRefs>();

  function record(text: string | null, circuit: RawCircuit, field: "own" | "next") {
    if (!text) return;
    const match = matchTrunkPosition(text, trunkPorts);
    if (!match.matched || !match.rackCode) return;
    if (match.rackCode.replace(/\s+/g, "").toUpperCase() !== normalizedTarget) return;
    if (match.invalidPortNumbers && match.invalidPortNumbers.length > 0) return;
    for (const p of match.resolvedPorts ?? []) {
      if (!map.has(p.portNumber)) map.set(p.portNumber, { own: [], next: [] });
      map.get(p.portNumber)![field].push({ id: circuit.id, name: circuit.name });
    }
  }

  for (const c of circuits) {
    record(c.device_position_own, c, "own");
    record(odfPartOf(c.device_position_next), c, "next");
  }
  return map;
}
