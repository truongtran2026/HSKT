import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchCircuitOptions } from "@/lib/circuitOptions";
import { fetchDevices } from "@/lib/devices";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import PortTable, { type PortView } from "@/components/odf-trunk/PortTable";
import RackHeader from "@/components/odf-trunk/RackHeader";
import RackAdminPanel from "@/components/odf-trunk/RackAdminPanel";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ, đặc biệt quan trọng ở đây vì trang này còn hiển thị dữ liệu vừa
// sửa/xóa (router.refresh() từ PortTable cần lấy được dữ liệu thật mới nhất).
export const dynamic = "force-dynamic";

interface RackInfo {
  id: string;
  code: string;
  cable_route_name: string | null;
  odf_type: "welded" | "distribution";
  port_count: number;
  station_id: string;
  domain: "trunk" | "device";
}

// Kết quả embed thô từ Supabase — port_circuit_links/transit_links có thể trả
// về mảng (kể cả khi port_id là unique) tùy version PostgREST, nên xử lý cả 2
// dạng (mảng hoặc object đơn) ở normalizePort() bên dưới cho an toàn.
interface RawPort {
  id: string;
  port_number: number;
  fiber_number: number | null;
  status: string;
  port_circuit_links: RawLink | RawLink[] | null;
  transit_links: { id: string; raw_text: string | null }[] | { id: string; raw_text: string | null } | null;
}
interface RawLink {
  link_role: "tx" | "rx" | "single";
  circuits: RawCircuit | RawCircuit[] | null;
}
interface RawCircuit {
  id: string;
  name: string;
  interface_type: string | null;
  counterpart_text: string | null;
  response_plan_text: string | null;
  execution_station_text: string | null;
  notes: string | null;
  circuit_role: string;
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function normalizePort(raw: RawPort): PortView {
  const link = firstOf(raw.port_circuit_links);
  const circuit = link ? firstOf(link.circuits) : null;
  const transit = firstOf(raw.transit_links);
  return {
    id: raw.id,
    portNumber: raw.port_number,
    fiberNumber: raw.fiber_number,
    status: raw.status,
    linkRole: link?.link_role ?? null,
    circuit: circuit
      ? {
          id: circuit.id,
          name: circuit.name,
          interfaceType: circuit.interface_type,
          counterpartText: circuit.counterpart_text,
          responsePlanText: circuit.response_plan_text,
          executionStationText: circuit.execution_station_text,
          notes: circuit.notes,
          circuitRole: circuit.circuit_role,
        }
      : null,
    transitText: transit?.raw_text ?? null,
    transitLinkId: transit?.id ?? null,
  };
}

async function getRackAndPorts(rackId: string) {
  const { data: rack, error: rackErr } = await supabase
    .from("racks")
    .select("id, code, cable_route_name, odf_type, port_count, station_id, domain")
    .eq("id", rackId)
    .maybeSingle();
  if (rackErr) throw rackErr;
  if (!rack) return null;

  const { data: rawPorts, error: portsErr } = await supabase
    .from("ports")
    .select(
      `id, port_number, fiber_number, status,
       port_circuit_links ( link_role, circuits ( id, name, interface_type, counterpart_text, response_plan_text, execution_station_text, notes, circuit_role ) ),
       transit_links!transit_links_source_port_id_fkey ( id, raw_text )`
    )
    .eq("rack_id", rackId)
    .order("port_number", { ascending: true });
  if (portsErr) throw portsErr;

  const ports = ((rawPorts ?? []) as unknown as RawPort[]).map(normalizePort);
  return { rack: rack as RackInfo, ports };
}

export default async function RackDetailPage({ params }: { params: { rackId: string } }) {
  // fetchAllOdfPorts (không phải fetchAllTrunkPorts) — "Chuyển tiếp" có thể
  // trỏ tới rack trung kế HOẶC ODF/DDF nội bộ (domain='device'), cần cả 2 để
  // nhận diện/chuẩn hóa đúng (yêu cầu người dùng 2026-07-27).
  const [data, options, devices, trunkPorts] = await Promise.all([
    getRackAndPorts(params.rackId),
    fetchCircuitOptions(),
    fetchDevices(),
    fetchAllOdfPorts(),
  ]);
  if (!data) notFound();
  const { rack, ports } = data;
  // Rack ODF/DDF nội bộ (domain='device', thêm 2026-07-27) dùng lại NGUYÊN
  // trang này (đúng yêu cầu "dùng lại đúng bảng/nút bấm đã có") — chỉ khác
  // link "quay lại" phải trỏ đúng danh sách của nó, không phải danh sách rack
  // trung kế.
  const backHref = rack.domain === "device" ? "/odf-device/odf-ddf-noi-bo" : "/odf-trunk";
  const backLabel = rack.domain === "device" ? "← Danh sách ODF/DDF nội bộ" : "← Danh sách rack";

  return (
    <div>
      <Link href={backHref} className="text-sm text-primary-600 hover:underline">
        {backLabel}
      </Link>
      <div className="mt-2">
        <RackHeader
          rack={{
            id: rack.id,
            code: rack.code,
            cableRouteName: rack.cable_route_name,
            odfType: rack.odf_type,
            portCount: rack.port_count,
          }}
        />
      </div>

      <RackAdminPanel
        rackId={rack.id}
        stationId={rack.station_id}
        code={rack.code}
        cableRouteName={rack.cable_route_name}
        portCount={rack.port_count}
      />

      <div className="mt-6">
        <PortTable
          rackId={rack.id}
          initialPorts={ports}
          options={options}
          devices={devices}
          stationId={rack.station_id}
          trunkPorts={trunkPorts}
        />
      </div>
    </div>
  );
}
