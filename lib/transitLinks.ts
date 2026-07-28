import { supabase } from "@/lib/supabase";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { matchTrunkPosition, formatCanonicalOdfPosition, type TrunkPortRow } from "@/lib/trunkPorts";

// Rà soát TOÀN BỘ cột "Chuyển tiếp" (transit_links.raw_text) bên ODF trung kế
// tìm dòng CHƯA đúng chuẩn form đã ban hành "ODF x/y (a,b) - ADN1.thiết bị
// (port)" (yêu cầu người dùng 2026-07-28, cùng tinh thần "positionConflicts"
// đã làm ở DeviceCircuitList.tsx: chỉ LIỆT KÊ để người dùng tự rà — KHÔNG tự
// đoán/sửa, vì rất nhiều trường hợp không khớp cấu trúc 2 vẫn hoàn toàn hợp
// lệ (vd đi thẳng ra trạm khác không qua thiết bị ADN1 nào, hoặc mới chỉ có
// tọa độ ODF chưa rõ thiết bị đích) — chỉ người dùng có đủ bối cảnh thực tế
// trạm ADN1 để phân biệt đâu là lỗi thật.
export interface NonConformingTransitLink {
  id: string;
  rawText: string;
  rackId: string;
  rackCode: string;
  portId: string;
  portNumber: number;
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

// PostgREST trả về quan hệ 1-nhiều dạng object đơn hay mảng tùy ràng buộc
// unique có/không (bài học từ scripts/sync-missing-trunk-circuits.ts,
// architecture.md mục 15) — dò cả 2 dạng cho chắc thay vì giả định 1 kiểu.
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function fetchNonConformingTransitLinks(trunkPorts: TrunkPortRow[]): Promise<NonConformingTransitLink[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    // transit_links có 2 FK khác nhau tới ports (source_port_id VÀ
    // target_port_id) — phải chỉ đích danh tên ràng buộc
    // "transit_links_source_port_id_fkey" thì PostgREST mới hết mơ hồ,
    // nếu không sẽ báo lỗi PGRST201 "more than one relationship was found".
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

  const result: NonConformingTransitLink[] = [];
  for (const row of all) {
    const port = firstOf(row.ports);
    if (!port) continue;
    const rack = firstOf(port.racks);
    // Chỉ tính ODF trung kế — "Chuyển tiếp" (transit_links) chỉ có ý nghĩa ở
    // đây, ODF/DDF nội bộ (domain=device) dùng device_position_own/next
    // (cột khác trên circuits), chưa từng ghi transit_links.
    if (!rack || rack.domain !== "trunk") continue;
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue; // Không có gì để đánh giá chuẩn form.

    const item = { id: row.id, rawText: raw, rackId: port.rack_id, rackCode: rack.code, portId: port.id, portNumber: port.port_number };
    const split = splitOdfDeviceStructure(raw);
    if (!split.matched) {
      result.push(item);
      continue;
    }
    // Khớp cấu trúc NGOÀI "ODF... - Thiết bị (port)" nhưng phần ODF bên
    // trong vẫn có thể sai định dạng (vd "ODF2/10/33,34" thay vì đúng chuẩn
    // "ODF 2/10 (33,34)") — splitOdfDeviceStructure() không tự đệ quy kiểm
    // tra phần này (lọt lưới cũ, người dùng phát hiện qua dữ liệu thật port
    // 23/24 rack ODF1/1, 2026-07-28). Tái dùng ĐÚNG cơ chế
    // matchTrunkPosition/formatCanonicalOdfPosition mà PortTable.tsx đã dùng
    // để tự chuẩn hóa lúc rời khỏi ô "Vị trí ODF" (onBlur) — chỉ báo lỗi khi
    // khớp CHẮC CHẮN được 1 rack/port trung kế thật và bản chuẩn hóa khác
    // chữ đang lưu, không đoán khi không khớp được gì (tránh báo nhầm những
    // trường hợp hợp lệ khác không phải rack trung kế).
    const trunkMatch = matchTrunkPosition(split.odfPart ?? "", trunkPorts);
    const canonicalOdf = formatCanonicalOdfPosition(trunkMatch);
    if (canonicalOdf && canonicalOdf !== split.odfPart) {
      result.push(item);
    }
  }
  return result;
}
