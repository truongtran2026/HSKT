import type { SupabaseClient } from "@supabase/supabase-js";

// Trang chi tiết /circuit/[id] (Đợt 4 audit, HSKT-audit-2026-08-03.md) — 1
// luồng có thể thuộc ODF trung kế (có port_circuit_links) HOẶC thuộc thiết bị
// (device_id set), và có thể là gốc/mirror của 1 luồng khác (mirror_of_id) —
// gom cả 3 khía cạnh vào 1 hàm fetch duy nhất cho trang permalink dùng chung,
// thay vì phải đoán trước loại luồng nào ở nơi gọi.
export interface CircuitDetail {
  id: string;
  name: string;
  interfaceType: string | null;
  circuitRole: "active" | "standby";
  counterpartText: string | null;
  responsePlanText: string | null;
  executionStationText: string | null;
  notes: string | null;
  tribText: string | null;
  devicePositionOwn: string | null;
  devicePositionNext: string | null;
  updatedAt: string;
  trunkPorts: { id: string; portNumber: number; rackId: string; rackCode: string }[];
  device: { id: string; name: string; fullLabel: string | null } | null;
  mirrorOrigin: { id: string; name: string } | null;
  mirrorChild: { id: string; name: string } | null;
}

export async function fetchCircuitDetail(client: SupabaseClient, id: string): Promise<CircuitDetail | null> {
  const supabase = client;

  const { data: c, error: cErr } = await supabase
    .from("circuits")
    .select(
      "id, name, interface_type, circuit_role, counterpart_text, response_plan_text, execution_station_text, notes, trib_text, device_position_own, device_position_next, updated_at, mirror_of_id, device_id, devices(id, name, full_label)"
    )
    .eq("id", id)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!c) return null;

  const { data: linkRows, error: linkErr } = await supabase
    .from("port_circuit_links")
    .select("ports(id, port_number, rack_id, racks(code))")
    .eq("circuit_id", id);
  if (linkErr) throw linkErr;

  // Supabase trả embed 1-1 (unique port_id) là object đơn hoặc mảng 1 phần tử
  // tùy version PostgREST — chuẩn hóa cả 2 dạng cho an toàn, cùng cách
  // app/odf-trunk/[rackId]/page.tsx đã làm với port_circuit_links.
  function firstOf<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  }
  const trunkPorts = (linkRows ?? [])
    .map((row: { ports: unknown }) => firstOf(row.ports as { id: string; port_number: number; rack_id: string; racks: unknown } | { id: string; port_number: number; rack_id: string; racks: unknown }[] | null))
    .filter((p): p is { id: string; port_number: number; rack_id: string; racks: unknown } => !!p)
    .map((p) => {
      const rack = firstOf(p.racks as { code: string } | { code: string }[] | null);
      return { id: p.id, portNumber: p.port_number, rackId: p.rack_id, rackCode: rack?.code ?? "?" };
    })
    .sort((a, b) => a.portNumber - b.portNumber);

  let mirrorOrigin: { id: string; name: string } | null = null;
  if (c.mirror_of_id) {
    const { data: origin } = await supabase.from("circuits").select("id, name").eq("id", c.mirror_of_id).maybeSingle();
    mirrorOrigin = origin ?? null;
  }
  // unique(mirror_of_id) (migration 20260804000003) — tối đa 1 luồng con.
  const { data: child } = await supabase.from("circuits").select("id, name").eq("mirror_of_id", id).maybeSingle();

  const rawDevice = firstOf(c.devices as { id: string; name: string; full_label: string | null } | { id: string; name: string; full_label: string | null }[] | null);
  const device = rawDevice ? { id: rawDevice.id, name: rawDevice.name, fullLabel: rawDevice.full_label } : null;

  return {
    id: c.id,
    name: c.name,
    interfaceType: c.interface_type,
    circuitRole: c.circuit_role,
    counterpartText: c.counterpart_text,
    responsePlanText: c.response_plan_text,
    executionStationText: c.execution_station_text,
    notes: c.notes,
    tribText: c.trib_text,
    devicePositionOwn: c.device_position_own,
    devicePositionNext: c.device_position_next,
    updatedAt: c.updated_at,
    trunkPorts,
    device,
    mirrorOrigin,
    mirrorChild: child ?? null,
  };
}
