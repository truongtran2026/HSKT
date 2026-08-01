import { supabase } from "@/lib/supabase";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { matchTrunkPosition, formatCanonicalOdfPosition, matchBareTrunkLink, type TrunkPortRow } from "@/lib/trunkPorts";

// Rà soát TOÀN BỘ cột "Chuyển tiếp" (transit_links.raw_text) bên ODF trung kế
// tìm dòng CHƯA đúng chuẩn form đã ban hành (yêu cầu người dùng 2026-07-28,
// cùng tinh thần "positionConflicts" đã làm ở DeviceCircuitList.tsx: chỉ LIỆT
// KÊ để người dùng tự rà — KHÔNG tự đoán/sửa). Công nhận ĐÚNG 2 form (yêu cầu
// người dùng 2026-07-29):
//   1. "ODF x/y (a,b) - ADN1.thiết bị (port)"      (splitOdfDeviceStructure)
//   2. "ODF x/y (a,b) - Tên ODF trung kế"          (matchBareTrunkLink, tọa độ
//      trỏ thẳng sang 1 rack trung kế khác, không qua thiết bị)
// Ngoài 2 form này, rất nhiều trường hợp khác vẫn có thể hợp lệ (vd đi thẳng
// ra trạm khác không qua thiết bị/ODF ADN1 nào) — chỉ người dùng có đủ bối
// cảnh thực tế trạm ADN1 để phân biệt đâu là lỗi thật, nên không tự đoán thêm
// form nào khác ngoài 2 form đã xác nhận ở trên.
//
// Dòng đã bấm "Ack" (transit_links.format_ack = true) — người dùng xác nhận
// đã xem, biết đây không theo 2 form trên nhưng vẫn đúng thực tế — bị loại
// khỏi kết quả vĩnh viễn cho tới khi có cách "un-Ack" (chưa yêu cầu).
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
  format_ack: boolean;
  ports: RawPort | RawPort[] | null;
}

// PostgREST trả về quan hệ 1-nhiều dạng object đơn hay mảng tùy ràng buộc
// unique có/không (bài học từ scripts/sync-missing-trunk-circuits.ts,
// architecture.md mục 15) — dò cả 2 dạng cho chắc thay vì giả định 1 kiểu.
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// Tham số `rackId` TÙY CHỌN (thêm 2026-08-01, Fix 2 tối ưu — trang chi tiết 1
// rack trước đó kéo NGUYÊN bảng transit_links rồi lọc bằng .filter() ở JS,
// dù chỉ cần đúng 1 rack) — có `rackId` thì lọc NGAY Ở POSTGRES theo
// ports.rack_id (chỉ gửi về đúng dòng của rack đó); KHÔNG có (undefined) thì
// giữ NGUYÊN hành vi cũ — quét cả bảng theo .range() — vì trang danh sách
// (/odf-trunk) và trang Chất lượng dữ liệu (/data-quality) vẫn cần cảnh báo
// TOÀN TRẠM, không được đổi.
//
// LƯU Ý: `trunkPorts` vẫn phải là TOÀN BỘ port trung kế dù có lọc theo
// rackId — đây là "từ điển tra ngược" cho matchBareTrunkLink/matchTrunkPosition
// bên dưới, vì 1 dòng "Chuyển tiếp" của rack A hoàn toàn có thể trỏ sang 1
// port ở rack B. Thu nhỏ trunkPorts theo rackId sẽ làm sai kết quả đối chiếu.
export async function fetchNonConformingTransitLinks(trunkPorts: TrunkPortRow[], rackId?: string): Promise<NonConformingTransitLink[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];

  for (let from = 0; ; from += pageSize) {
    // transit_links có 2 FK khác nhau tới ports (source_port_id VÀ
    // target_port_id) — phải chỉ đích danh tên ràng buộc
    // "transit_links_source_port_id_fkey" thì PostgREST mới hết mơ hồ, nếu
    // không sẽ báo lỗi PGRST201 "more than one relationship was found".
    //
    // Cách A (đã test thật trên dữ liệu sống, rack ODF1/1 -> đúng 30 dòng,
    // khớp số liệu trước khi sửa) — đổi embed `ports` sang inner-join
    // (`!inner`) rồi lọc thẳng `.eq("ports.rack_id", rackId)`: vì fkey đã
    // được chỉ đích danh nên inner-join không còn mơ hồ, PostgREST lọc gọn
    // ở 1 query duy nhất, không cần vòng lấy port.id riêng (Cách B, dự
    // phòng) như đề xuất ban đầu.
    let query = supabase
      .from("transit_links")
      .select(
        rackId
          ? "id, raw_text, format_ack, ports:ports!transit_links_source_port_id_fkey!inner(id, port_number, rack_id, racks(code, domain))"
          : "id, raw_text, format_ack, ports:ports!transit_links_source_port_id_fkey(id, port_number, rack_id, racks(code, domain))"
      )
      .order("id", { ascending: true });
    if (rackId) query = query.eq("ports.rack_id", rackId);
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  const result: NonConformingTransitLink[] = [];
  for (const row of all) {
    if (row.format_ack) continue; // Đã Ack — không hiện lại (yêu cầu người dùng 2026-07-29).
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
      // "Form 2" hợp lệ: tọa độ ODF trỏ thẳng sang 1 rack TRUNG KẾ khác,
      // không qua thiết bị (yêu cầu người dùng 2026-07-29) — trước đây MỌI
      // dòng không có đuôi " - Thiết bị (port)" đều bị liệt vào đây, kể cả
      // dạng này (báo nhầm/false positive).
      const bareMatch = matchBareTrunkLink(raw, trunkPorts);
      if (bareMatch && bareMatch.rackDomain === "trunk") continue;
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
