import { supabase } from "@/lib/supabase";

// Dữ liệu 1 port trung kế đã chuẩn hóa — dùng chung cho trang Tìm kiếm nhanh
// (giai đoạn 5) và Dashboard (giai đoạn 6), để cả 2 nơi cùng 1 nguồn dữ liệu
// và cùng cách phân trang/sắp xếp đã sửa lỗi (xem fetchAllTrunkPorts bên dưới).
export interface TrunkPortRow {
  portId: string;
  portNumber: number;
  fiberNumber: number | null;
  rackId: string;
  rackCode: string;
  cableRouteName: string | null;
  circuit: {
    id: string;
    name: string;
    interfaceType: string | null;
    counterpartText: string | null;
    responsePlanText: string | null;
  } | null;
}

interface RawRow {
  id: string;
  port_number: number;
  fiber_number: number | null;
  racks: { id: string; code: string; cable_route_name: string | null } | { id: string; code: string; cable_route_name: string | null }[] | null;
  port_circuit_links: RawLink | RawLink[] | null;
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
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// PostgREST giới hạn mặc định 1000 dòng/lần gọi — toàn trạm ADN1 có hơn 2000
// port trung kế nên PHẢI phân trang, nếu không sẽ âm thầm bỏ sót một phần
// rack (đã gặp thực tế: chỉ lấy được 1000/2016 port).
//
// QUAN TRỌNG: order() phải có tiêu chí PHỤ là "id" (duy nhất) chứ không chỉ
// port_number — vì port_number KHÔNG duy nhất trên toàn bảng (nhiều rack đều
// có port 25 chẳng hạn). Nếu chỉ sort theo port_number, Postgres không đảm
// bảo thứ tự ổn định cho các dòng trùng giá trị tại ranh giới trang, khiến
// .range() có thể LẤY TRÙNG 1 dòng ở 2 trang liền kề (đã gặp thực tế: đúng
// 10 port bị trùng, gây ra hiện tượng 1 port "Đang dùng" lại lọt vào danh
// sách lọc "Cổng trống").
async function fetchAllRawPorts(): Promise<RawRow[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("ports")
      .select(
        `id, port_number, fiber_number,
         racks!inner ( id, code, cable_route_name, domain ),
         port_circuit_links ( link_role, circuits ( id, name, interface_type, counterpart_text, response_plan_text ) )`
      )
      .eq("racks.domain", "trunk")
      .order("port_number", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

// Chỉ quét ODF trung kế (giai đoạn 5/6 theo CLAUDE.md) — ODF/DDF thiết bị sẽ
// được thêm vào khi làm giai đoạn 7.
export async function fetchAllTrunkPorts(): Promise<TrunkPortRow[]> {
  const rawRows = await fetchAllRawPorts();
  return rawRows.map((row) => {
    const rack = firstOf(row.racks)!;
    const link = firstOf(row.port_circuit_links);
    const circuit = link ? firstOf(link.circuits) : null;
    return {
      portId: row.id,
      portNumber: row.port_number,
      fiberNumber: row.fiber_number,
      rackId: rack.id,
      rackCode: rack.code,
      cableRouteName: rack.cable_route_name,
      circuit: circuit
        ? {
            id: circuit.id,
            name: circuit.name,
            interfaceType: circuit.interface_type,
            counterpartText: circuit.counterpart_text,
            responsePlanText: circuit.response_plan_text,
          }
        : null,
    };
  });
}
