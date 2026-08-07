import type { SupabaseClient } from "@supabase/supabase-js";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { matchTrunkPosition, formatCanonicalOdfPosition, matchBareTrunkLink, type TrunkPortRow } from "@/lib/trunkPorts";

// Bước 4e của HSKT-dot-1-brief.md ("Luồng có 2 sợi ghi Chuyển tiếp khác
// nhau") — CHỈ liệt kê để rà, KHÔNG có nút tự sửa (khác các tab
// mismatch khác trong /data-quality). Lý do: rà dữ liệu sống 2026-08-04 xác
// nhận đúng 11 ca thuộc nhóm này là thiết bị khuếch đại quang/DWDM
// (MLA/SRA/CPL/WDM) có Tx/Rx đi 2 port THẬT khác nhau — người dùng xác nhận
// đây là dữ liệu ĐÚNG, không phải lỗi (xem writeTransitForPorts() bên dưới,
// architecture.md mục 65). Tab này tồn tại để DỄ THẤY nhóm ngoại lệ này (biết
// chúng đang được bảo vệ, không bị code nào âm thầm ép đồng nhất) và để bắt
// được ca THẬT SỰ SAI nếu phát sinh thêm sau này — không phải để "dọn về 0".
export interface DivergentTransitEntry {
  portId: string;
  portNumber: number;
  rackId: string;
  rackCode: string;
  rackDomain: "trunk" | "device";
  rawText: string;
}

export interface DivergentTransitGroup {
  circuitId: string;
  circuitName: string;
  entries: DivergentTransitEntry[];
}

// Thuần (không async) — `trunkPorts` (fetchAllOdfPorts) đã có sẵn
// `transitText`/`circuit` cho từng port, không cần query Supabase riêng.
export function findDivergentTransitGroups(trunkPorts: TrunkPortRow[]): DivergentTransitGroup[] {
  const byCircuit = new Map<string, TrunkPortRow[]>();
  for (const port of trunkPorts) {
    if (!port.circuit) continue;
    const list = byCircuit.get(port.circuit.id) ?? [];
    list.push(port);
    byCircuit.set(port.circuit.id, list);
  }

  const result: DivergentTransitGroup[] = [];
  for (const [circuitId, ports] of byCircuit) {
    if (ports.length < 2) continue;
    const nonEmpty = ports.filter((p) => (p.transitText ?? "").trim() !== "");
    const distinct = new Set(nonEmpty.map((p) => p.transitText!.trim()));
    if (distinct.size < 2) continue;
    result.push({
      circuitId,
      circuitName: ports[0].circuit!.name || "(chưa đặt tên)",
      entries: nonEmpty.map((p) => ({
        portId: p.portId,
        portNumber: p.portNumber,
        rackId: p.rackId,
        rackCode: p.rackCode,
        rackDomain: p.rackDomain,
        rawText: p.transitText!.trim(),
      })),
    });
  }
  return result.sort((a, b) => a.circuitName.localeCompare(b.circuitName));
}

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
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function fetchNonConformingTransitLinks(
  client: SupabaseClient,
  trunkPorts: TrunkPortRow[],
  rackId?: string
): Promise<NonConformingTransitLink[]> {
  const supabase = client;
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

export interface WriteTransitResult {
  // "protected": port đã có sẵn ≥2 giá trị KHÁC nhau — không ghi gì đè lên
  // (xem giải thích ở writeTransitForPorts). "written": đã ghi/xóa bình
  // thường (có thể là ghi cho toàn bộ port, hoặc chỉ điền port đang trống).
  status: "written" | "protected";
}

// ĐƯỜNG GHI DUY NHẤT cho "Chuyển tiếp" (transit_links.raw_text) — thêm
// 2026-08-04 (rà soát toàn dự án 2026-08-03). Trước đây có 6 nơi ghi với 2
// hành vi khác nhau: PortTable.saveEdit() ghi ĐỦ mọi port đang active của
// luồng, còn applySyncFromDevice()/mirrorTrunkCircuits.ts (2 chỗ)/
// scripts/sync-missing-trunk-circuits.ts/scripts/backfill-transit-links-for-
// mirrors.ts chỉ ghi port ĐẦU TIÊN. Hệ quả: đồng bộ 1 luồng 2 sợi qua các
// đường ghi thiếu có thể để lại 1 port mang raw_text CŨ — PortTable kiểm tra
// `group.ports[0].transitText === group.ports[1].transitText` để quyết định
// gộp ô (rowspan) nên tách thành 2 dòng ngay lúc vừa "đồng bộ cho khớp", và
// fetchNonConformingTransitLinks quét từng dòng độc lập nên port lệch bị báo
// nhầm "chưa chuẩn form". Người dùng xác nhận (BB-1): 2 sợi Tx/Rx của CÙNG 1
// luồng bình thường luôn chuyển tiếp về CÙNG 1 chỗ.
//
// NGOẠI LỆ đã xác nhận bằng dữ liệu thật (rà soát 2026-08-04, KHÔNG suy đoán):
// quét toàn bộ `transit_links` phát hiện 11 luồng — toàn bộ đều là thiết bị
// khuếch đại quang/DWDM (MLA/SRA/CPL/WDM) — có Tx/Rx đi 2 port THẬT khác
// nhau (vd "CPL/MLA2/Port 5 (Tx Out)" / "CPL/MLA2/Port 8 (Rx IN)"). Người
// dùng xác nhận đây là dữ liệu ĐÚNG, không phải lỗi nhập liệu. Vì vậy hàm này
// KHÔNG được ép đồng nhất mù quáng — nếu các port truyền vào ĐANG có sẵn ≥2
// giá trị raw_text KHÁC nhau (không rỗng), coi đây là luồng thuộc nhóm ngoại
// lệ hợp lệ: chỉ điền vào port đang TRỐNG (nếu có), giữ NGUYÊN mọi port đã có
// giá trị — không ghi đè bất cứ gì. Điều này an toàn cho MỌI nơi gọi, kể cả
// PortTable.saveEdit() (chỉ gộp ô khi 2 port đã ĐANG giống nhau nên hiếm khi
// trúng nhánh này) và mirror tự tạo (luôn là port hoàn toàn mới, không có gì
// để bảo vệ).
export async function writeTransitForPorts(client: SupabaseClient, portIds: string[], rawText: string | null): Promise<WriteTransitResult> {
  const supabase = client;
  if (portIds.length === 0) return { status: "written" };
  const text = (rawText ?? "").trim();

  const { data: existingRows, error: readErr } = await supabase
    .from("transit_links")
    .select("id, source_port_id, raw_text")
    .in("source_port_id", portIds);
  if (readErr) throw readErr;

  const existingByPort = new Map<string, { id: string; rawText: string | null }>();
  for (const r of (existingRows ?? []) as { id: string; source_port_id: string; raw_text: string | null }[]) {
    existingByPort.set(r.source_port_id, { id: r.id, rawText: r.raw_text });
  }

  const nonNullValues = new Set(
    portIds
      .map((id) => existingByPort.get(id)?.rawText ?? null)
      .filter((v): v is string => v !== null && v.trim() !== "")
  );
  if (nonNullValues.size >= 2) {
    // Nhóm ngoại lệ khuếch đại/DWDM — chỉ điền chỗ trống, không đụng port đã có giá trị.
    const missingIds = portIds.filter((id) => {
      const v = existingByPort.get(id)?.rawText;
      return !v || !v.trim();
    });
    if (missingIds.length > 0 && text) {
      const { error } = await supabase
        .from("transit_links")
        .insert(missingIds.map((id) => ({ source_port_id: id, target_type: "text_only" as const, raw_text: text })));
      if (error) throw error;
    }
    return { status: "protected" };
  }

  if (!text) {
    const ids = [...existingByPort.values()].map((v) => v.id);
    if (ids.length > 0) {
      const { error } = await supabase.from("transit_links").delete().in("id", ids);
      if (error) throw error;
    }
    return { status: "written" };
  }

  const toUpdateIds = [...existingByPort.values()].map((v) => v.id);
  if (toUpdateIds.length > 0) {
    const { error } = await supabase.from("transit_links").update({ raw_text: text }).in("id", toUpdateIds);
    if (error) throw error;
  }
  const toInsert = portIds
    .filter((id) => !existingByPort.has(id))
    .map((id) => ({ source_port_id: id, target_type: "text_only" as const, raw_text: text }));
  if (toInsert.length > 0) {
    const { error } = await supabase.from("transit_links").insert(toInsert);
    if (error) throw error;
  }
  return { status: "written" };
}
