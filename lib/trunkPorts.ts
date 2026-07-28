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
  rackDomain: "trunk" | "device";
  cableRouteName: string | null;
  circuit: {
    id: string;
    name: string;
    interfaceType: string | null;
    counterpartText: string | null;
    responsePlanText: string | null;
  } | null;
}

interface RawRack {
  id: string;
  code: string;
  cable_route_name: string | null;
  domain: "trunk" | "device";
}
interface RawRow {
  id: string;
  port_number: number;
  fiber_number: number | null;
  racks: RawRack | RawRack[] | null;
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
async function fetchAllRawPorts(domainFilter?: "trunk" | "device"): Promise<RawRow[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("ports")
      .select(
        `id, port_number, fiber_number,
         racks!inner ( id, code, cable_route_name, domain ),
         port_circuit_links ( link_role, circuits ( id, name, interface_type, counterpart_text, response_plan_text ) )`
      );
    if (domainFilter) query = query.eq("racks.domain", domainFilter);
    const { data, error } = await query
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

function toTrunkPortRow(row: RawRow): TrunkPortRow {
  const rack = firstOf(row.racks)!;
  const link = firstOf(row.port_circuit_links);
  const circuit = link ? firstOf(link.circuits) : null;
  return {
    portId: row.id,
    portNumber: row.port_number,
    fiberNumber: row.fiber_number,
    rackId: rack.id,
    rackCode: rack.code,
    rackDomain: rack.domain,
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
}

// Chỉ ODF trung kế (giai đoạn 5/6 theo CLAUDE.md — Tìm kiếm nhanh/Dashboard,
// không liên quan ODF/DDF nội bộ nên KHÔNG đổi hàm này, tránh ảnh hưởng 2 nơi
// đó ngoài ý muốn).
export async function fetchAllTrunkPorts(): Promise<TrunkPortRow[]> {
  const rawRows = await fetchAllRawPorts("trunk");
  return rawRows.map(toTrunkPortRow);
}

// CẢ trung kế lẫn ODF/DDF nội bộ (domain='device', thêm 2026-07-27 — xem
// scripts/import-internal-odf-racks.ts) — dùng cho việc nhận diện/chuẩn hóa Ô
// "Vị trí ODF" ở DeviceCircuitList.tsx và PortTable.tsx, vì cả 2 nơi cần khớp
// được CẢ 2 loại rack thật (khác đúng 1 chỗ: khớp domain='device' KHÔNG được
// coi là "đấu thẳng ra trung kế" — xem rackDomain trên TrunkPositionMatch).
export async function fetchAllOdfPorts(): Promise<TrunkPortRow[]> {
  const rawRows = await fetchAllRawPorts();
  return rawRows.map(toTrunkPortRow);
}

// ============================================================================
// Khớp "Vị trí ODF (tiếp theo)" (DeviceCircuitList.tsx) với rack/port trung kế
// THẬT — thêm 2026-07-27 theo yêu cầu người dùng: tự nhận diện luôn (không
// cần chọn tay "Thiết bị"/"Cáp quang trung kế" nữa). Rack/port bên ODF/DDF
// thiết bị KHÔNG được tạo thật trong hệ thống (xem architecture.md mục 7.2 —
// vẫn là text tự do), nên hễ khớp được 1 rack trung kế thật là CHẮC CHẮN
// thuộc trường hợp đấu thẳng ra trung kế, không nhầm lẫn được với trường hợp
// "thiết bị trung gian".
// ============================================================================

export interface TrunkPositionMatch {
  matched: boolean;
  rackCode?: string;
  /** 'trunk' = đấu thẳng ra tuyến cáp trung kế; 'device' = ODF/DDF nội bộ
   *  (đấu chéo thiết bị-thiết bị, KHÔNG coi là tuyến cáp — xem nơi gọi). */
  rackDomain?: "trunk" | "device";
  cableRouteName?: string | null;
  /** Số port trích được từ phần còn lại của text (0, 1 hoặc 2 số). */
  requestedPortNumbers?: number[];
  /** Port khớp được thật trong rack (kèm sợi + đã có luồng chưa). */
  resolvedPorts?: { portNumber: number; fiberNumber: number | null; inUse: boolean; circuitName?: string }[];
  /** Số port người dùng gõ nhưng KHÔNG có thật trong rack này — báo lỗi bắt sửa lại. */
  invalidPortNumbers?: number[];
}

// Thuật toán: so khớp PHẦN ĐẦU (đã bỏ hết khoảng trắng) với mã rack, LUÔN thử
// mã DÀI NHẤT trước — bắt buộc vì rất nhiều mã rack là tiền tố ký tự của mã
// khác (khảo sát thật: "ODF1/1" là tiền tố của "ODF1/10".."ODF1/14"), thử mã
// ngắn trước sẽ khớp nhầm ngay dòng đầu tiên gặp.
export function matchTrunkPosition(text: string, trunkPorts: TrunkPortRow[]): TrunkPositionMatch {
  const normalized = text.replace(/\s+/g, "").toUpperCase();
  if (!normalized) return { matched: false };

  const rackCodes = [...new Set(trunkPorts.map((p) => p.rackCode))].sort((a, b) => b.length - a.length);
  for (const rackCode of rackCodes) {
    const normalizedCode = rackCode.replace(/\s+/g, "").toUpperCase();
    if (!normalized.startsWith(normalizedCode)) continue;

    const remainder = normalized.slice(normalizedCode.length);
    const requestedPortNumbers = [...remainder.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
    const portsInRack = trunkPorts.filter((p) => p.rackCode === rackCode);
    const cableRouteName = portsInRack[0]?.cableRouteName ?? null;
    const rackDomain = portsInRack[0]?.rackDomain;

    if (requestedPortNumbers.length === 0) {
      // Mới gõ đúng mã rack, chưa có số port nào (vd đang gõ dở "ODF1/1").
      return { matched: true, rackCode, rackDomain, cableRouteName, requestedPortNumbers: [] };
    }

    const resolvedPorts: NonNullable<TrunkPositionMatch["resolvedPorts"]> = [];
    const invalidPortNumbers: number[] = [];
    for (const n of requestedPortNumbers) {
      const found = portsInRack.find((p) => p.portNumber === n);
      if (found) {
        resolvedPorts.push({ portNumber: n, fiberNumber: found.fiberNumber, inUse: !!found.circuit, circuitName: found.circuit?.name });
      } else {
        invalidPortNumbers.push(n);
      }
    }
    return { matched: true, rackCode, rackDomain, cableRouteName, requestedPortNumbers, resolvedPorts, invalidPortNumbers };
  }
  return { matched: false };
}

// Tra ngược: đã biết rack (từ matchTrunkPosition ở Ô1), gõ 1-2 số Sợi ở Ô3 ->
// tìm port tương ứng để viết lại Ô1 (yêu cầu người dùng 2026-07-27: "nhập sợi
// ở dưới thì suy ra port ở trên"). Trả về null nếu có sợi KHÔNG tồn tại trong
// rack này — bắt sửa lại, không suy đại khái. Sợi = fiber_number nếu có, hoặc
// chính port_number nếu fiber_number chưa ghi nhận (coi "port cùng sợi").
export function findPortsByFiberNumbers(
  rackCode: string,
  fiberNumbers: number[],
  trunkPorts: TrunkPortRow[]
): { portNumber: number; fiberNumber: number; inUse: boolean; circuitName?: string }[] | null {
  const portsInRack = trunkPorts.filter((p) => p.rackCode === rackCode);
  const result: { portNumber: number; fiberNumber: number; inUse: boolean; circuitName?: string }[] = [];
  for (const fn of fiberNumbers) {
    const found = portsInRack.find((p) => (p.fiberNumber ?? p.portNumber) === fn);
    if (!found) return null;
    result.push({ portNumber: found.portNumber, fiberNumber: fn, inUse: !!found.circuit, circuitName: found.circuit?.name });
  }
  return result;
}

// Tách "27,28" / "27" thành mảng số nguyên — dùng cho cả port lẫn sợi. null
// nếu có phần không phải số (bắt báo lỗi thay vì đoán).
export function parseNumberList(text: string): number[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const numbers = trimmed.split(",").map((s) => parseInt(s.trim(), 10));
  if (numbers.some((n) => Number.isNaN(n))) return null;
  return numbers;
}

// Chuẩn hóa lại chữ gõ tắt ở 1 ô "Vị trí ODF" đúng theo form đã ban hành
// "ODF x/y (a,b)" (yêu cầu người dùng 2026-07-27) — dùng CHUNG cho cả ô "Vị
// trí ODF (tiếp theo)" bên luồng thiết bị (DeviceCircuitList.tsx) VÀ ô
// "Chuyển tiếp" bên ODF trung kế (PortTable.tsx), vì cả 2 đều cần đối chiếu
// cùng 1 nguồn dữ liệu rack/port trung kế thật. CHỈ áp dụng khi đã khớp được
// 1 rack trung kế THẬT và mọi port gõ đều hợp lệ (còn sai thì để nguyên chữ
// gõ, gọi nơi khác đã có thông báo lỗi bắt sửa riêng — không tự sửa đè lên
// chỗ đang sai). 1 sợi thì không đệm số 0 (vd "(5)"), từ 2 sợi trở lên đệm 2
// chữ số cho đều (vd "(05,06)") — đúng 2 ví dụ người dùng đưa ra.
//
// racks.code THẬT trong DB lại KHÔNG có khoảng cách sau "ODF" (đã khảo sát
// toàn bộ 41 rack trung kế: "ODF1/1", "ODF2/7.1"... không dòng nào có
// khoảng cách) — nên tự chèn khoảng cách ở ĐÂY lúc dựng chuỗi hiển thị,
// KHÔNG sửa racks.code thật (ngoài phạm vi yêu cầu, ảnh hưởng nhiều chỗ
// khác). Việc rackCode luôn lấy từ DB (không phải chữ gõ tay của người
// dùng) cũng khiến "ODF" tự động thành chữ HOA sẵn dù gõ tắt chữ thường.
export function formatCanonicalOdfPosition(trunkMatch: TrunkPositionMatch): string | null {
  if (!trunkMatch.matched || !trunkMatch.rackCode) return null;
  if (trunkMatch.invalidPortNumbers && trunkMatch.invalidPortNumbers.length > 0) return null;
  const ports = trunkMatch.resolvedPorts ?? [];
  if (ports.length === 0) return null;
  const portText =
    ports.length === 1
      ? String(ports[0].portNumber)
      : ports.map((p) => String(p.portNumber).padStart(2, "0")).join(",");
  const spacedRackCode = trunkMatch.rackCode.replace(/^ODF(?!\s)/, "ODF ");
  return `${spacedRackCode} (${portText})`;
}
