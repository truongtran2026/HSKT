import { supabase } from "@/lib/supabase";
import { fetchAllOdfPorts, matchTrunkPosition, matchBareTrunkLink, type TrunkPortRow } from "@/lib/trunkPorts";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";

// scripts/sync-missing-trunk-circuits.ts (2026-07-28, xem architecture.md mục
// 15) tự tạo 1 `circuits` MỚI bên trung kế cho mỗi luồng thiết bị có
// device_position_own/next khớp 1 port trung kế thật nhưng port đó đang
// "trống" — 2 dòng circuit này nhận ra nhau qua cột thật `circuits.mirror_of_id`
// (migration `20260731000001_circuits_mirror_of.sql`, `on delete cascade`) —
// xóa luồng gốc ở BẤT KỲ đâu (kể cả nút "Xóa hẳn thiết bị" ở /devices, kể cả
// script quản trị sau này) thì Postgres TỰ xóa mirror theo, không cần code
// nhớ gọi đúng hàm. Trước 2026-07-31 chỉ nhận diện qua text cố định trong
// `notes` ("...luồng gốc id <uuid>."), không có ràng buộc CSDL nào — đã gặp
// bug thật (mirror mồ côi, xem architecture.md mục 32) nên đổi sang cột thật.
//
// 2 hàm dưới vẫn cần ở tầng app: (1) tra trước để BÁO trong confirm() luồng
// mirror nào sắp bị xóa theo (tường minh, tránh bất ngờ), (2) dọn `ports.status`
// + `transit_links` của các port được giải phóng — 2 việc này KHÔNG tự động
// qua cascade (cascade chỉ xóa được chính dòng `circuits` mirror + kéo theo
// `port_circuit_links` của nó, không đụng tới `ports`/`transit_links`, xem
// mục 16 lý do tương tự).
export interface MirrorTrunkMatch {
  originCircuitId: string;
  circuitId: string;
  circuitName: string;
  portIds: string[];
}

interface RawMirrorRow {
  id: string;
  name: string;
  mirror_of_id: string;
  port_circuit_links: { port_id: string }[] | { port_id: string } | null;
}

export async function findMirrorTrunkCircuits(originIds: string[]): Promise<Map<string, MirrorTrunkMatch>> {
  const result = new Map<string, MirrorTrunkMatch>();
  if (originIds.length === 0) return result;

  const { data, error } = await supabase
    .from("circuits")
    .select("id, name, mirror_of_id, port_circuit_links(port_id)")
    .in("mirror_of_id", originIds);
  if (error) throw error;

  for (const row of (data ?? []) as unknown as RawMirrorRow[]) {
    const links = row.port_circuit_links;
    const arr = Array.isArray(links) ? links : links ? [links] : [];
    result.set(row.mirror_of_id, { originCircuitId: row.mirror_of_id, circuitId: row.id, circuitName: row.name, portIds: arr.map((l) => l.port_id) });
  }
  return result;
}

// Dọn phần KHÔNG tự cascade khi (các) luồng gốc đã bị xóa (bởi caller, TRƯỚC
// khi gọi hàm này — chính việc xóa luồng gốc đã tự kéo theo xóa mirror qua
// `on delete cascade`, không cần xóa tay ở đây nữa): (1) transit_links của
// các port sắp giải phóng (cùng lý do mục 16 — port trống thì "Chuyển tiếp"
// cũ vô nghĩa), (2) đưa ports.status các port đó về `unused`.
export async function cleanupAfterMirrorCascade(matches: MirrorTrunkMatch[]): Promise<void> {
  const portIds = matches.flatMap((m) => m.portIds);
  if (portIds.length === 0) return;

  const { error: transitErr } = await supabase.from("transit_links").delete().in("source_port_id", portIds);
  if (transitErr) throw transitErr;

  const { error: statusErr } = await supabase.from("ports").update({ status: "unused" }).in("id", portIds);
  if (statusErr) throw statusErr;
}

// "Phương án 1" người dùng chọn 2026-07-31 khi bàn về ca "trung kế đã có
// luồng đúng, nhưng Hồ sơ đấu nối thiết bị chưa có" (xem
// lib/reverseDeviceTrunkAudit.ts + components/data-quality/
// TrunkMissingDeviceMirrorTab.tsx) — CHỦ ĐỘNG xóa luồng trung kế CŨ (có thể
// sai format tên thiết bị, vd "ADN1.MPE8" thay vì đúng chuẩn "ADN1.MPE#8")
// để GIẢI PHÓNG port, thay vì cố tự dò/match tên thiết bị từ text (rủi ro tạo
// trùng thiết bị mới, xem bài học mục 35 PSS64/BB330G). Khi người dùng sau đó
// tự bổ sung ĐÚNG luồng bên "Hồ sơ đấu nối" (tên thiết bị chuẩn từ danh mục
// `devices`, đúng Trib), autoCreateTrunkMirrorForCircuit() (mục 39) sẽ TỰ tạo
// lại mirror trung kế đúng chuẩn — hàm này chỉ cần dọn sạch chỗ cũ, KHÔNG cần
// "tạo lại" gì ở đây.
//
// Chỉ xóa THẬT khi người dùng đã tick xác nhận ở UI (KHÔNG tick = Phương án
// 2 = giữ nguyên, tự đi bổ sung bên Hồ sơ đấu nối, không đụng gì tới trung
// kế) — caller (component) chịu trách nhiệm hỏi xác nhận TRƯỚC khi gọi hàm
// này, dùng CHÍNH findMirrorTrunkCircuits() ở trên để biết trước những mirror
// nào sẽ mất theo (truyền lại qua tham số, tránh gọi lại 2 lần).
export async function deleteTrunkCircuitToResync(trunkCircuitId: string, cascadedMirrors: MirrorTrunkMatch[]): Promise<void> {
  const { data: linkRows, error: linkErr } = await supabase.from("port_circuit_links").select("port_id").eq("circuit_id", trunkCircuitId);
  if (linkErr) throw linkErr;
  const ownPortIds = (linkRows ?? []).map((r) => r.port_id);

  // Xóa port_circuit_links + circuit của CHÍNH luồng này trước — `circuits.
  // mirror_of_id ... on delete cascade` (mục 33) sẽ tự xóa theo mọi mirror
  // (nếu có) TRỎ VÀO circuit này, kéo theo port_circuit_links của MIRROR đó
  // cũng tự mất (cùng cơ chế cascade). Phần ports.status/transit_links của cả
  // 2 phía (chính nó + mirror) KHÔNG tự cascade — dọn tay ở dưới.
  const { error: unlinkErr } = await supabase.from("port_circuit_links").delete().eq("circuit_id", trunkCircuitId);
  if (unlinkErr) throw unlinkErr;
  const { error: circuitErr } = await supabase.from("circuits").delete().eq("id", trunkCircuitId);
  if (circuitErr) throw circuitErr;

  if (ownPortIds.length > 0) {
    const { error: statusErr } = await supabase.from("ports").update({ status: "unused" }).in("id", ownPortIds);
    if (statusErr) throw statusErr;
    const { error: transitErr } = await supabase.from("transit_links").delete().in("source_port_id", ownPortIds);
    if (transitErr) throw transitErr;
  }

  if (cascadedMirrors.length > 0) await cleanupAfterMirrorCascade(cascadedMirrors);
}

function odfPartOf(raw: string | null): string | null {
  if (!raw) return null;
  const split = splitOdfDeviceStructure(raw);
  return split.matched ? split.odfPart ?? null : raw;
}

export interface TrunkMirrorCandidate {
  field: "own" | "next";
  rawText: string;
  rackId: string;
  rackCode: string;
  portNumbers: number[]; // đã sắp theo đúng thứ tự gõ trong text (tx trước, rx sau)
}

// Dò xem Ô "Vị trí ODF (thiết bị)"/"Vị trí ODF (tiếp theo)" của 1 luồng thiết
// bị có khớp đúng 1 rack/port TRUNG KẾ THẬT nhưng port đó đang TRỐNG không —
// tách ra dùng CHUNG cho cả scripts/sync-missing-trunk-circuits.ts (rà soát
// hàng loạt) lẫn autoCreateTrunkMirrorForCircuit() bên dưới (tạo ngay lúc lưu
// form, DeviceCircuitList.tsx) — tránh viết lại thuật toán 2 nơi rồi lệch
// nhau (bài học architecture.md mục 34/35).
export function findTrunkMirrorCandidates(
  circuit: Pick<DeviceCircuitRow, "devicePositionOwn" | "devicePositionNext">,
  trunkPorts: TrunkPortRow[],
  rackIdByCode: Map<string, string>
): TrunkMirrorCandidate[] {
  const candidates: TrunkMirrorCandidate[] = [];

  // matchText: PHẦN ODF THUẦN dùng để so khớp (own vốn đã thuần; next phải
  // tách qua odfPartOf trước — KHÔNG được đưa thẳng text gốc có thể ghép thêm
  // "- Thiết bị (Trib)" vào matchTrunkPosition, nếu không chữ số trong tên/trib
  // sẽ bị đọc nhầm thành port, xem architecture.md mục 13).
  function collect(field: "own" | "next", matchText: string, rawText: string) {
    const match = matchTrunkPosition(matchText, trunkPorts);
    if (!match.matched || match.rackDomain !== "trunk" || !match.rackCode) return;
    if (match.invalidPortNumbers && match.invalidPortNumbers.length > 0) return;
    const ports = match.resolvedPorts ?? [];
    if (ports.length === 0) return;
    if (ports.every((p) => p.inUse)) return; // đã đồng bộ đầy đủ, không việc gì phải làm
    const rackId = rackIdByCode.get(match.rackCode);
    if (!rackId) return;
    candidates.push({ field, rawText, rackId, rackCode: match.rackCode, portNumbers: ports.map((p) => p.portNumber) });
  }

  if (circuit.devicePositionOwn) collect("own", circuit.devicePositionOwn, circuit.devicePositionOwn);
  const nextOdf = odfPartOf(circuit.devicePositionNext);
  if (nextOdf) collect("next", nextOdf, circuit.devicePositionNext ?? "");

  return candidates;
}

// Phát hiện 2026-07-31 (người dùng, sau khi thêm luồng ADN1.ASBR#2-MX2020
// (7/1/2) đi ODF1/10 (35,36) nhưng bên ODF1/10 KHÔNG tự có luồng): CÙNG loại
// lỗ hổng đã sửa cho thiết bị-thiết bị (mục 38, lib/deviceDeviceSync.ts) —
// cơ chế tạo mirror trung kế trước giờ CHỈ chạy qua script dọn dữ liệu cũ
// (sync-missing-trunk-circuits.ts), chưa từng gắn vào form Thêm/Sửa luồng
// trên UI. Gọi hàm này thẳng từ submitCreate()/saveEdit() (DeviceCircuitList.tsx)
// ngay sau khi lưu xong 1 luồng — TÁI DÙNG ĐÚNG findTrunkMirrorCandidates ở
// trên, không cần DRY RUN vì đây là 1 luồng đơn lẻ người dùng vừa chủ động
// lưu, không phải sửa hàng loạt. Xóa/dọn cascade khi xóa luồng gốc đã có sẵn
// qua mirror_of_id + findMirrorTrunkCircuits/cleanupAfterMirrorCascade ở trên
// (chỉ cần gắn đúng mirror_of_id lúc tạo, không cần thêm gì cho chiều xóa).
export async function autoCreateTrunkMirrorForCircuit(
  sourceCircuitId: string
): Promise<
  | { status: "created"; rackCode: string; portNumbers: number[] }
  | { status: "no-gap" }
  | { status: "error"; message: string }
> {
  const trunkPorts = await fetchAllOdfPorts();
  const circuits = await fetchDeviceCircuits();
  const sourceCircuit = circuits.find((c) => c.id === sourceCircuitId);
  if (!sourceCircuit) return { status: "no-gap" };

  const rackIdByCode = new Map<string, string>();
  for (const p of trunkPorts) rackIdByCode.set(p.rackCode, p.rackId);

  const candidates = findTrunkMirrorCandidates(sourceCircuit, trunkPorts, rackIdByCode);
  if (candidates.length === 0) return { status: "no-gap" };

  let createdAny: { rackCode: string; portNumbers: number[] } | null = null;

  for (const cand of candidates) {
    // Rà sống lại ngay trước khi ghi (đúng pattern script sync) — tránh trùng
    // nếu port vừa bị luồng khác chiếm mất ở 1 nhịp trước đó.
    const { data: liveRows, error: liveErr } = await supabase
      .from("ports")
      .select("id, port_number, port_circuit_links(id)")
      .eq("rack_id", cand.rackId)
      .in("port_number", cand.portNumbers);
    if (liveErr) return { status: "error", message: liveErr.message };
    type RawLink = { id: string };
    type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupied = rows.some((r) => firstLink(r.port_circuit_links) !== null);
    if (occupied) continue; // đã có luồng khác chiếm (có thể do 1 gap khác của CHÍNH luồng này lấp), bỏ qua ca này

    const orderedPortIds = cand.portNumbers.map((n) => rows.find((r) => r.port_number === n)?.id).filter((id): id is string => !!id);
    if (orderedPortIds.length !== cand.portNumbers.length) continue;

    const { data: newCircuit, error: circErr } = await supabase
      .from("circuits")
      .insert({
        name: sourceCircuit.name,
        interface_type: sourceCircuit.interfaceType,
        counterpart_text: sourceCircuit.counterpartText,
        mirror_of_id: sourceCircuit.id,
        notes: `Tự tạo từ luồng thiết bị "${sourceCircuit.name}" — tự động ngay lúc lưu luồng gốc, xem lib/mirrorTrunkCircuits.ts.`,
      })
      .select("id")
      .single();
    if (circErr || !newCircuit) return { status: "error", message: circErr?.message ?? "không tạo được circuit" };

    const linkRows: { port_id: string; circuit_id: string; link_role: "tx" | "rx" | "single" }[] =
      orderedPortIds.length === 2
        ? [
            { port_id: orderedPortIds[0], circuit_id: newCircuit.id, link_role: "tx" },
            { port_id: orderedPortIds[1], circuit_id: newCircuit.id, link_role: "rx" },
          ]
        : [{ port_id: orderedPortIds[0], circuit_id: newCircuit.id, link_role: "single" }];
    const { error: linkErr } = await supabase.from("port_circuit_links").insert(linkRows);
    if (linkErr) {
      await supabase.from("circuits").delete().eq("id", newCircuit.id);
      return { status: "error", message: linkErr.message };
    }

    const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
    if (statusErr) return { status: "error", message: statusErr.message };

    createdAny = { rackCode: cand.rackCode, portNumbers: cand.portNumbers };
  }

  return createdAny ? { status: "created", ...createdAny } : { status: "no-gap" };
}

// Phát hiện 2026-07-31 (người dùng, sau khi tự phát hiện cùng lỗ hổng đã sửa
// ở mục 38/39 (device-device, device-trunk) NHƯNG chưa sửa cho trunk-trunk —
// yêu cầu thẳng: "khi nào thì mới sửa ca thật, chứ nói mới làm à" — không đợi
// có ca báo cụ thể nữa, sửa luôn vì đã biết chắc CÙNG 1 bug). Trường hợp này
// nguồn là 1 luồng TRUNG KẾ đã có (không phải luồng thiết bị) mà cột "Chuyển
// tiếp" (transit_links.raw_text) trỏ THẲNG sang 1 port trung kế KHÁC (không
// qua thiết bị nào — xem matchBareTrunkLink), nhưng port đó vẫn "trống". Gọi
// hàm này thẳng từ PortTable.tsx saveEdit() ngay sau khi lưu "Chuyển tiếp" —
// TÁI DÙNG chung tinh thần audit-trunk-trunk-sync.ts/sync-missing-trunk-
// trunk-circuits.ts (không đọc lại toàn bộ transit_links như script, chỉ cần
// đúng (các) port của CIRCUIT vừa lưu — đủ và nhanh hơn cho 1 lượt lưu đơn lẻ).
export async function autoCreateTrunkTrunkMirrorForCircuit(
  sourceCircuitId: string
): Promise<
  | { status: "created"; rackCode: string; portNumbers: number[] }
  | { status: "no-gap" }
  | { status: "error"; message: string }
> {
  const { data: sourceCircuitRow, error: sourceErr } = await supabase
    .from("circuits")
    .select("name, interface_type, counterpart_text")
    .eq("id", sourceCircuitId)
    .single();
  if (sourceErr || !sourceCircuitRow) return { status: "no-gap" };

  const { data: linkRows, error: linkErr } = await supabase
    .from("port_circuit_links")
    .select("port_id")
    .eq("circuit_id", sourceCircuitId);
  if (linkErr) return { status: "error", message: linkErr.message };
  const sourcePortIds = (linkRows ?? []).map((r) => r.port_id);
  if (sourcePortIds.length === 0) return { status: "no-gap" }; // luồng thiết bị (không có port) -> không thuộc phạm vi hàm này

  const { data: transitRows, error: transitErr } = await supabase
    .from("transit_links")
    .select("raw_text")
    .in("source_port_id", sourcePortIds);
  if (transitErr) return { status: "error", message: transitErr.message };

  const trunkPorts = await fetchAllOdfPorts();
  const rackIdByCode = new Map<string, string>();
  for (const p of trunkPorts) rackIdByCode.set(p.rackCode, p.rackId);

  let createdAny: { rackCode: string; portNumbers: number[] } | null = null;

  for (const row of transitRows ?? []) {
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue;
    const match = matchBareTrunkLink(raw, trunkPorts);
    if (!match || match.rackDomain !== "trunk" || !match.rackCode) continue;
    const ports = match.resolvedPorts ?? [];
    if (ports.length === 0 || ports.every((p) => p.inUse)) continue;
    const rackId = rackIdByCode.get(match.rackCode);
    if (!rackId) continue;
    const portNumbers = ports.map((p) => p.portNumber);

    // Rà sống lại ngay trước khi ghi (đúng pattern 2 hàm auto-mirror trên).
    const { data: liveRows, error: liveErr } = await supabase
      .from("ports")
      .select("id, port_number, port_circuit_links(id)")
      .eq("rack_id", rackId)
      .in("port_number", portNumbers);
    if (liveErr) return { status: "error", message: liveErr.message };
    type RawLink = { id: string };
    type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupied = rows.some((r) => firstLink(r.port_circuit_links) !== null);
    if (occupied) continue;

    const orderedPortIds = portNumbers.map((n) => rows.find((r) => r.port_number === n)?.id).filter((id): id is string => !!id);
    if (orderedPortIds.length !== portNumbers.length) continue;

    const { data: newCircuit, error: circErr } = await supabase
      .from("circuits")
      .insert({
        name: sourceCircuitRow.name,
        interface_type: sourceCircuitRow.interface_type,
        counterpart_text: sourceCircuitRow.counterpart_text,
        mirror_of_id: sourceCircuitId,
        notes: `Tự tạo từ luồng trung kế "${sourceCircuitRow.name}" — tự động ngay lúc lưu luồng gốc, xem lib/mirrorTrunkCircuits.ts.`,
      })
      .select("id")
      .single();
    if (circErr || !newCircuit) return { status: "error", message: circErr?.message ?? "không tạo được circuit" };

    const newLinkRows: { port_id: string; circuit_id: string; link_role: "tx" | "rx" | "single" }[] =
      orderedPortIds.length === 2
        ? [
            { port_id: orderedPortIds[0], circuit_id: newCircuit.id, link_role: "tx" },
            { port_id: orderedPortIds[1], circuit_id: newCircuit.id, link_role: "rx" },
          ]
        : [{ port_id: orderedPortIds[0], circuit_id: newCircuit.id, link_role: "single" }];
    const { error: newLinkErr } = await supabase.from("port_circuit_links").insert(newLinkRows);
    if (newLinkErr) {
      await supabase.from("circuits").delete().eq("id", newCircuit.id);
      return { status: "error", message: newLinkErr.message };
    }

    const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
    if (statusErr) return { status: "error", message: statusErr.message };

    createdAny = { rackCode: match.rackCode, portNumbers };
  }

  return createdAny ? { status: "created", ...createdAny } : { status: "no-gap" };
}
