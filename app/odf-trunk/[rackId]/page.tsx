import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchCircuitOptions } from "@/lib/circuitOptions";
import { fetchDevices } from "@/lib/devices";
import { fetchDevicePositionMap } from "@/lib/devicePositionMap";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceRackPortRefs } from "@/lib/deviceRackPorts";
import { fetchNonConformingTransitLinks } from "@/lib/transitLinks";
import PortTable, { type PortView } from "@/components/odf-trunk/PortTable";
import DeviceRackPortView from "@/components/odf-device/DeviceRackPortView";
import DeleteRackButton from "@/components/odf-device/DeleteRackButton";
import RackHeader from "@/components/odf-trunk/RackHeader";
import RackAdminPanel from "@/components/odf-trunk/RackAdminPanel";
import TransitFormatWarning from "@/components/odf-trunk/TransitFormatWarning";

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
  const [data, options, devices, devicePositionMap, trunkPorts] = await Promise.all([
    getRackAndPorts(params.rackId),
    fetchCircuitOptions(),
    fetchDevices(),
    fetchDevicePositionMap(),
    fetchAllOdfPorts(),
  ]);
  if (!data) notFound();
  const { rack, ports } = data;
  // Rack ODF/DDF nội bộ (domain='device') dùng lại NGUYÊN trang này (đúng
  // yêu cầu "dùng lại đúng bảng/nút bấm đã có" — RackHeader/RackAdminPanel
  // không đổi gì) — chỉ khác link "quay lại" (nay trỏ về "/odf-device", nơi
  // danh sách 112 rack này chuyển tới, xem architecture.md) và phần bảng
  // port: domain='device' không có port_circuit_links thật nên không dùng
  // PortTable (chỉ đọc bảng nối đó) — dùng DeviceRackPortView (đối chiếu
  // text qua lib/deviceRackPorts.ts) thay thế, yêu cầu người dùng 2026-07-28.
  const backHref = rack.domain === "device" ? "/odf-device" : "/odf-trunk";
  const backLabel = rack.domain === "device" ? "← Hồ sơ ODF Thiết bị" : "← Danh sách rack";
  const devicePortRefs = rack.domain === "device" ? await fetchDeviceRackPortRefs(rack.code, trunkPorts) : null;
  // Lọc xuống đúng rack đang xem (yêu cầu người dùng 2026-07-28: khung cảnh
  // báo "Chuyển tiếp chưa chuẩn form" cũng phải hiện ở trang chi tiết, không
  // chỉ ở danh sách rack) — rack domain='device' luôn ra mảng rỗng (transit_
  // links chỉ ghi cho rack trung kế), TransitFormatWarning tự ẩn khi rỗng.
  //
  // Sửa 2026-08-01 (Fix 2 tối ưu): truyền rack.id để Postgres lọc sẵn theo
  // rack (xem lib/transitLinks.ts) thay vì kéo NGUYÊN bảng transit_links rồi
  // .filter() ở JS như trước — trunkPorts vẫn truyền ĐẦY ĐỦ toàn trạm (không
  // thu nhỏ), vì hàm này cần nó làm từ điển tra ngược cho các "Chuyển tiếp"
  // trỏ sang rack khác.
  const nonConformingTransit = await fetchNonConformingTransitLinks(trunkPorts, rack.id);

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
      {/* Xóa rack (yêu cầu người dùng 2026-07-28) — CHỈ domain='device': xóa
          rack trung kế rủi ro hơn nhiều (dữ liệu Excel gốc thật, có
          port_circuit_links/transit_links thật gắn theo, ngoài phạm vi yêu
          cầu lần này). */}
      {rack.domain === "device" && <DeleteRackButton rackId={rack.id} rackCode={rack.code} />}

      <div className="mt-6">
        <TransitFormatWarning items={nonConformingTransit} />
        {devicePortRefs ? (
          <DeviceRackPortView portCount={rack.port_count} portRefs={devicePortRefs} />
        ) : (
          <PortTable
            rackId={rack.id}
            initialPorts={ports}
            options={options}
            devices={devices}
            devicePositionMap={devicePositionMap}
            stationId={rack.station_id}
            trunkPorts={trunkPorts}
          />
        )}
      </div>
    </div>
  );
}
