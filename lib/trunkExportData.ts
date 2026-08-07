import type { SupabaseClient } from "@supabase/supabase-js";

// Dữ liệu xuất Excel "ODF trung kế" (yêu cầu người dùng 2026-08-07) — RIÊNG
// khỏi TrunkPortRow (lib/trunkPorts.ts, dùng chung rất nhiều nơi) vì export
// cần thêm execution_station_text/notes mà TrunkPortRow không mang theo (cố
// tình không thêm vào TrunkPortRow để tránh ảnh hưởng các nơi khác đang dùng
// type đó). Copy cấu trúc query từ getRackAndPorts()
// (app/odf-trunk/[rackId]/page.tsx) nhưng bỏ giới hạn 1 rack, lọc domain
// 'trunk'. 1 dòng kết quả = 1 port (không gộp Tx/Rx — CLAUDE.md nguyên tắc
// #1, đúng cấu trúc file Excel gốc: mỗi port 1 dòng thật).
export interface TrunkExportRow {
  rackId: string;
  rackCode: string;
  rackCableRouteName: string | null;
  portNumber: number;
  fiberNumber: number | null;
  circuitName: string | null;
  interfaceType: string | null;
  transitText: string | null;
  counterpartText: string | null;
  responsePlanText: string | null;
  executionStationText: string | null;
  notes: string | null;
}

interface RawRack {
  id: string;
  code: string;
  cable_route_name: string | null;
}
interface RawCircuit {
  name: string;
  interface_type: string | null;
  counterpart_text: string | null;
  response_plan_text: string | null;
  execution_station_text: string | null;
  notes: string | null;
}
interface RawLink {
  link_role: "tx" | "rx" | "single";
  circuits: RawCircuit | RawCircuit[] | null;
}
interface RawPort {
  port_number: number;
  fiber_number: number | null;
  racks: RawRack | RawRack[] | null;
  port_circuit_links: RawLink | RawLink[] | null;
  transit_links: { raw_text: string | null }[] | { raw_text: string | null } | null;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export async function fetchTrunkExportRows(client: SupabaseClient): Promise<TrunkExportRow[]> {
  const pageSize = 1000;
  const rows: TrunkExportRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from("ports")
      .select(
        `port_number, fiber_number,
         racks!inner ( id, code, domain, cable_route_name ),
         port_circuit_links ( link_role, circuits ( name, interface_type, counterpart_text, response_plan_text, execution_station_text, notes ) ),
         transit_links!transit_links_source_port_id_fkey ( raw_text )`
      )
      .eq("racks.domain", "trunk")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawPort[];
    for (const p of page) {
      const rack = firstOf(p.racks);
      if (!rack) continue;
      const link = firstOf(p.port_circuit_links);
      const circuit = link ? firstOf(link.circuits) : null;
      const transit = firstOf(p.transit_links);
      rows.push({
        rackId: rack.id,
        rackCode: rack.code,
        rackCableRouteName: rack.cable_route_name,
        portNumber: p.port_number,
        fiberNumber: p.fiber_number,
        circuitName: circuit?.name ?? null,
        interfaceType: circuit?.interface_type ?? null,
        transitText: transit?.raw_text ?? null,
        counterpartText: circuit?.counterpart_text ?? null,
        responsePlanText: circuit?.response_plan_text ?? null,
        executionStationText: circuit?.execution_station_text ?? null,
        notes: circuit?.notes ?? null,
      });
    }
    if (page.length < pageSize) break;
  }
  // Phân trang theo "id" (con trỏ ổn định, xem lib/trunkPorts.ts) không theo
  // đúng thứ tự rack/port — sắp lại ở đây 1 lần sau khi tải đủ, cho file xuất
  // ra dễ đọc (nhóm theo rack, port tăng dần trong rack), thay vì xen kẽ ngẫu
  // nhiên giữa các rack.
  rows.sort((a, b) => a.rackCode.localeCompare(b.rackCode) || a.portNumber - b.portNumber);
  return rows;
}
