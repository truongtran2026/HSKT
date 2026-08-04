import { supabase } from "@/lib/supabase";
import { fetchAllOdfPorts, matchTrunkPosition, matchBareTrunkLink, type TrunkPortRow } from "@/lib/trunkPorts";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { splitOdfDeviceStructure } from "@/lib/parsers/transit-text";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import { writeTransitForPorts } from "@/lib/transitLinks";

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

// "Chuyển tiếp" bên trung kế (transit_links.raw_text) là chỗ kỹ sư đọc để
// biết port này đi đâu — autoCreateTrunkMirrorForCircuit/syncAllTrunkMirrorGaps
// (mục 39/56) trước đây CHỈ tạo `circuits`+`port_circuit_links`, QUÊN ghi
// luôn dòng này, khiến mirror mới tạo trông "trống" — "Kiểm tra đồng bộ" báo
// bên trung kế thiếu dữ liệu dù đã liên kết đúng (ca thật người dùng
// 2026-08-03, ADN1.ASBR#2-MX2020 (2/1/8) đi ODF 1/2 (47,48)). Dùng ĐÚNG định
// dạng `applySyncFromDevice()` đang dùng (lib/circuitPairSync.ts) — "<Vị trí
// ODF thiết bị> - <Tên thiết bị> (<Trib>)" — không viết lại quy ước khác rồi
// lệch nhau (bài học mục 34/35).
export function buildTransitRawTextFromDevice(sourceCircuit: DeviceCircuitRow): string | null {
  if (!sourceCircuit.devicePositionOwn || !sourceCircuit.deviceName || !sourceCircuit.tribText) return null;
  return `${sourceCircuit.devicePositionOwn} - ${sourceCircuit.deviceName} (${sourceCircuit.tribText})`;
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
  | {
      status: "occupied";
      rackCode: string;
      portNumbers: number[];
      occupantCircuitId: string;
      occupantCircuitName: string;
    }
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
      .select("id, port_number, port_circuit_links(id, circuit_id, circuits(name))")
      .eq("rack_id", cand.rackId)
      .in("port_number", cand.portNumbers);
    if (liveErr) return { status: "error", message: liveErr.message };
    type RawLink = { id: string; circuit_id: string; circuits: { name: string } | { name: string }[] | null };
    type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupant = rows.map((r) => firstLink(r.port_circuit_links)).find((l): l is RawLink => l !== null);
    if (occupant) {
      // Đã có luồng khác chiếm port này — KHÔNG tự ghi đè/bỏ qua âm thầm nữa
      // (yêu cầu người dùng 2026-08-02, bước 3/6): báo về để tầng gọi (UI)
      // hỏi xác nhận, tự xử lý (khớp thì liên kết, lệch thì xóa-rồi-tạo-lại).
      const occupantName = Array.isArray(occupant.circuits) ? occupant.circuits[0]?.name : occupant.circuits?.name;
      return {
        status: "occupied",
        rackCode: cand.rackCode,
        portNumbers: cand.portNumbers,
        occupantCircuitId: occupant.circuit_id,
        occupantCircuitName: occupantName ?? "(không rõ tên)",
      };
    }

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

    const rawText = buildTransitRawTextFromDevice(sourceCircuit);
    if (rawText) {
      // Ghi cho TOÀN BỘ port của circuit vừa tạo (2026-08-04, xem
      // lib/transitLinks.ts) — trước đây chỉ ghi orderedPortIds[0], để sợi
      // thứ 2 (nếu có) không có "Chuyển tiếp" dù cùng 1 luồng. An toàn 100%
      // ở đây vì circuit vừa insert xong, chưa có dữ liệu cũ nào để bảo vệ.
      try {
        await writeTransitForPorts(orderedPortIds, rawText);
      } catch (e) {
        return { status: "error", message: e instanceof Error ? e.message : String(e) };
      }
    }

    createdAny = { rackCode: cand.rackCode, portNumbers: cand.portNumbers };
  }

  return createdAny ? { status: "created", ...createdAny } : { status: "no-gap" };
}

export interface MirrorGapScanSummary {
  created: number;
  linked: number;
  /** `sourceHref` (yêu cầu người dùng 2026-08-02: "mỗi lần vướng lại phải
   *  hỏi bạn lấy dữ liệu từ đâu... có cách nào ghi sẵn không" — sau khi phải
   *  tự lần theo tay 1 ca thật GSCQ ADN1-2T9-QNM) — link bấm thẳng tới ĐÚNG
   *  dòng chứa dữ liệu NGUỒN gây ra xung đột, kèm `detail` phải nói rõ chữ
   *  gốc + field nào (không chỉ nói "đang có luồng khác" suông). */
  conflicts: { sourceName: string; detail: string; sourceHref?: string }[];
  errors: string[];
}

// Giới hạn phạm vi quét (yêu cầu người dùng 2026-08-02: "quét toàn bộ thì sẽ
// bị chồng lấp đang đúng tự nhiên ở đâu nhập thêm vào thành sai... nên quét
// theo ODF trung kế; quét theo ODF thiết bị ra; quét theo thiết bị" — thay vì
// luôn quét CẢ TRẠM, cho chọn hẹp lại để giảm rủi ro/blast radius mỗi lượt
// quét). Tất cả optional — bỏ trống hết = quét toàn trạm như trước (hành vi
// cũ vẫn còn nguyên, chỉ thêm khả năng thu hẹp). So khớp bằng CHUỖI (rack
// code/tên thiết bị) thay vì id — đơn giản, tái dùng đúng field đã có sẵn
// trên từng dòng (rackCode/deviceName), không cần join thêm.
export interface MirrorScanScope {
  /** Giới hạn theo 1 rack ODF TRUNG KẾ cụ thể (vd "ODF 1/1") — áp cho vị trí
   *  ĐÍCH (nơi sẽ tạo/kiểm tra mirror), hoặc vị trí NGUỒN khi quét trung
   *  kế-trung kế (khớp 1 trong 2 là đủ). */
  trunkRackCode?: string;
  /** Giới hạn theo 1 rack ODF/DDF THIẾT BỊ cụ thể (vd "ODF 9/1") — áp cho
   *  `device_position_own`/`targetOwnPosition` (so bằng includes(), không
   *  cần tách chuẩn — chỉ để thu hẹp phạm vi quét, không phải validate). */
  deviceRackCode?: string;
  /** Giới hạn theo 1 thiết bị cụ thể (tên đã chuẩn hóa trong danh mục
   *  `devices`) — khớp cả khi thiết bị đó là NGUỒN lẫn ĐÍCH của 1 cặp. */
  deviceName?: string;
}

function circuitInScope(c: Pick<DeviceCircuitRow, "deviceName" | "devicePositionOwn">, scope?: MirrorScanScope): boolean {
  if (!scope) return true;
  if (scope.deviceName && (c.deviceName ?? "").trim() !== scope.deviceName.trim()) return false;
  if (scope.deviceRackCode && !(c.devicePositionOwn ?? "").includes(scope.deviceRackCode)) return false;
  return true;
}

// "Nếu bên hồ sơ còn lại đang trống thì sync luôn chứ sao phải đợi sửa lại
// bên hồ sơ đúng 1 chút gì đó... rồi mới kích hoạt" (yêu cầu người dùng
// 2026-08-02): `autoCreateTrunkMirrorForCircuit` (mục 39/54) CHỈ chạy khi
// LƯU đúng 1 luồng thiết bị cụ thể — tồn đọng CŨ (đã có từ trước, chưa ai
// sửa/lưu lại) không có gì tự kích hoạt. Hàm này QUÉT TOÀN BỘ 1 lượt (tái
// dùng NGUYÊN `findTrunkMirrorCandidates`, cùng thuật toán
// `scripts/sync-missing-trunk-circuits.ts` đã dùng — không viết lại, tránh
// lệch nhau) — 1 lần fetch trunkPorts/circuits, chỉ query DB thêm cho từng
// ỨNG VIÊN thật (không phải mọi circuit), nên vẫn nhanh dù trạm có hàng nghìn
// luồng. Khác CLI script: (1) LUÔN ghi thật (không có DRY RUN — người dùng
// bấm nút tức đã chủ động muốn quét+lấp ngay), (2) "đã bị chiếm nhưng TÊN
// KHỚP HỆT" -> tự LIÊN KẾT ngay (đúng nguyên tắc bước 3/6, script CLI cũ
// chưa có), "TÊN KHÁC" -> KHÔNG tự xóa/tạo lại (quá rủi ro khi chạy hàng
// loạt không giám sát từng dòng) — chỉ liệt kê vào `conflicts` để người dùng
// tự vào từng luồng xử lý qua nút "Gỡ liên kết"/"Kiểm tra đồng bộ".
export async function syncAllTrunkMirrorGaps(scope?: MirrorScanScope): Promise<MirrorGapScanSummary> {
  const trunkPorts = await fetchAllOdfPorts();
  const circuits = await fetchDeviceCircuits();
  const rackIdByCode = new Map<string, string>();
  for (const p of trunkPorts) rackIdByCode.set(p.rackCode, p.rackId);

  const summary: MirrorGapScanSummary = { created: 0, linked: 0, conflicts: [], errors: [] };

  for (const sourceCircuit of circuits) {
    if (!circuitInScope(sourceCircuit, scope)) continue;
    const candidates = findTrunkMirrorCandidates(sourceCircuit, trunkPorts, rackIdByCode);
    for (const cand of candidates) {
      if (scope?.trunkRackCode && cand.rackCode !== scope.trunkRackCode) continue;
      const { data: liveRows, error: liveErr } = await supabase
        .from("ports")
        .select("id, port_number, port_circuit_links(id, circuit_id, circuits(name))")
        .eq("rack_id", cand.rackId)
        .in("port_number", cand.portNumbers);
      if (liveErr) {
        summary.errors.push(`${sourceCircuit.name}: ${liveErr.message}`);
        continue;
      }
      type RawLink = { id: string; circuit_id: string; circuits: { name: string } | { name: string }[] | null };
      type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
      const rows = (liveRows ?? []) as unknown as LiveRow[];
      function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
        if (!v) return null;
        return Array.isArray(v) ? v[0] ?? null : v;
      }
      const occupant = rows.map((r) => firstLink(r.port_circuit_links)).find((l): l is RawLink => l !== null);
      if (occupant) {
        const occupantName = Array.isArray(occupant.circuits) ? occupant.circuits[0]?.name : occupant.circuits?.name;
        if ((occupantName ?? "").trim() === sourceCircuit.name.trim()) {
          const { error: linkErr } = await supabase.from("circuits").update({ mirror_of_id: sourceCircuit.id }).eq("id", occupant.circuit_id);
          if (linkErr) summary.errors.push(`${sourceCircuit.name}: ${linkErr.message}`);
          else summary.linked++;
        } else {
          const fieldLabel = cand.field === "own" ? "Vị trí ODF (thiết bị)" : "Vị trí ODF (tiếp theo)";
          summary.conflicts.push({
            sourceName: sourceCircuit.name,
            detail: `${fieldLabel} ghi "${cand.rawText}" → trỏ tới port ${cand.rackCode} (${cand.portNumbers.join(
              ","
            )}), nhưng port đó đang có luồng khác: "${occupantName ?? "(không rõ tên)"}"`,
            sourceHref: `/odf-device/sua-luong#${rowAnchor(sourceCircuit.id)}`,
          });
        }
        continue;
      }

      const orderedPortIds = cand.portNumbers.map((n) => rows.find((r) => r.port_number === n)?.id).filter((id): id is string => !!id);
      if (orderedPortIds.length !== cand.portNumbers.length) continue;

      const { data: newCircuit, error: circErr } = await supabase
        .from("circuits")
        .insert({
          name: sourceCircuit.name,
          interface_type: sourceCircuit.interfaceType,
          counterpart_text: sourceCircuit.counterpartText,
          mirror_of_id: sourceCircuit.id,
          notes: `Tự tạo từ luồng thiết bị "${sourceCircuit.name}" (quét lấp đầy chỗ trống, /data-quality) — xem lib/mirrorTrunkCircuits.ts.`,
        })
        .select("id")
        .single();
      if (circErr || !newCircuit) {
        summary.errors.push(`${sourceCircuit.name}: ${circErr?.message ?? "không tạo được circuit"}`);
        continue;
      }

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
        summary.errors.push(`${sourceCircuit.name}: ${linkErr.message}`);
        continue;
      }

      const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
      if (statusErr) summary.errors.push(`${sourceCircuit.name}: tạo xong nhưng cập nhật ports.status lỗi: ${statusErr.message}`);

      const rawText = buildTransitRawTextFromDevice(sourceCircuit);
      if (rawText) {
        // Ghi cho TOÀN BỘ port (2026-08-04) — xem giải thích ở nhánh trên.
        try {
          await writeTransitForPorts(orderedPortIds, rawText);
        } catch (e) {
          summary.errors.push(`${sourceCircuit.name}: tạo xong nhưng ghi Chuyển tiếp lỗi: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      summary.created++;
    }
  }

  return summary;
}

// "Xóa bên đang chiếm rồi tạo lại theo đúng bên vừa lưu" (yêu cầu người dùng
// 2026-08-02, bước 3/6 — trả lời câu hỏi phân loại theo LOẠI cặp bằng: "cũng
// là odf, cũng có port, cũng có tên... như nhau mà có gì đâu mà phải phân
// loại lắm thế" — 1 CÁCH XỬ LÝ DUY NHẤT cho mọi hướng/loại cặp, không phân
// biệt trung kế/thiết bị). UI gọi hàm này SAU KHI người dùng xác nhận xóa
// (đã hiện rõ tên luồng đang chiếm port trong `confirm()`, xem
// DeviceCircuitList.tsx). Tái dùng ĐÚNG `deleteTrunkCircuitToResync` (mục 33)
// — xóa xong port sẽ trống, gọi lại `autoCreateTrunkMirrorForCircuit` là tự
// tạo đúng theo bên vừa lưu (KHÔNG viết lại logic tạo ở đây, tránh lệch nhau
// như bài học architecture.md mục 9).
export async function replaceOccupantAndCreateTrunkMirror(
  occupantCircuitId: string,
  sourceCircuitId: string
): ReturnType<typeof autoCreateTrunkMirrorForCircuit> {
  const cascaded = await findMirrorTrunkCircuits([occupantCircuitId]);
  await deleteTrunkCircuitToResync(occupantCircuitId, [...cascaded.values()]);
  return autoCreateTrunkMirrorForCircuit(sourceCircuitId);
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
  | {
      status: "occupied";
      rackCode: string;
      portNumbers: number[];
      occupantCircuitId: string;
      occupantCircuitName: string;
    }
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
    if (ports.length === 0) continue;
    const rackId = rackIdByCode.get(match.rackCode);
    if (!rackId) continue;
    const portNumbers = ports.map((p) => p.portNumber);

    // Rà sống lại ngay trước khi ghi (đúng pattern 2 hàm auto-mirror trên).
    const { data: liveRows, error: liveErr } = await supabase
      .from("ports")
      .select("id, port_number, port_circuit_links(id, circuit_id, circuits(name))")
      .eq("rack_id", rackId)
      .in("port_number", portNumbers);
    if (liveErr) return { status: "error", message: liveErr.message };
    type RawLink = { id: string; circuit_id: string; circuits: { name: string } | { name: string }[] | null };
    type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupant = rows.map((r) => firstLink(r.port_circuit_links)).find((l): l is RawLink => l !== null);
    if (occupant) {
      // Đối xứng `autoCreateTrunkMirrorForCircuit` — báo về để UI hỏi xác
      // nhận thay vì âm thầm bỏ qua (yêu cầu người dùng 2026-08-02, bước 3/6).
      const occupantName = Array.isArray(occupant.circuits) ? occupant.circuits[0]?.name : occupant.circuits?.name;
      return {
        status: "occupied",
        rackCode: match.rackCode,
        portNumbers,
        occupantCircuitId: occupant.circuit_id,
        occupantCircuitName: occupantName ?? "(không rõ tên)",
      };
    }

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

// Đối xứng `replaceOccupantAndCreateTrunkMirror` ở trên, cho cặp trung
// kế-trung kế (bước 3/6, cùng 1 cách xử lý DUY NHẤT cho mọi loại cặp).
export async function replaceOccupantAndCreateTrunkTrunkMirror(
  occupantCircuitId: string,
  sourceCircuitId: string
): ReturnType<typeof autoCreateTrunkTrunkMirrorForCircuit> {
  const cascaded = await findMirrorTrunkCircuits([occupantCircuitId]);
  await deleteTrunkCircuitToResync(occupantCircuitId, [...cascaded.values()]);
  return autoCreateTrunkTrunkMirrorForCircuit(sourceCircuitId);
}

// Đối xứng `syncAllTrunkMirrorGaps` ở trên, cho cặp trung kế-trung kế (quét
// TOÀN BỘ `transit_links` 1 lượt thay vì gọi lại `autoCreateTrunkTrunkMirrorForCircuit`
// cho từng luồng — hàm đó tự fetch trunkPorts MỖI LẦN gọi, quá tốn nếu lặp
// hàng trăm/nghìn lần). Phải tự phân trang `port_circuit_links`/`transit_links`
// (mặc định PostgREST chỉ trả 1000 dòng/lần — xem lib/deviceCircuits.ts).
export async function syncAllTrunkTrunkMirrorGaps(scope?: MirrorScanScope): Promise<MirrorGapScanSummary> {
  const summary: MirrorGapScanSummary = { created: 0, linked: 0, conflicts: [], errors: [] };
  const trunkPorts = await fetchAllOdfPorts();
  const rackIdByCode = new Map<string, string>();
  const rackCodeByPortId = new Map<string, string>();
  const portNumberByPortId = new Map<string, number>();
  for (const p of trunkPorts) {
    rackIdByCode.set(p.rackCode, p.rackId);
    rackCodeByPortId.set(p.portId, p.rackCode);
    portNumberByPortId.set(p.portId, p.portNumber);
  }

  const pageSize = 1000;
  const circuitIdByPortId = new Map<string, string>();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("port_circuit_links")
      .select("port_id, circuit_id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      summary.errors.push(error.message);
      return summary;
    }
    for (const r of data ?? []) circuitIdByPortId.set(r.port_id, r.circuit_id);
    if ((data ?? []).length < pageSize) break;
  }

  const transitRows: { source_port_id: string; raw_text: string | null }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transit_links")
      .select("source_port_id, raw_text")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      summary.errors.push(error.message);
      return summary;
    }
    transitRows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }

  const relevantCircuitIds = [...new Set(transitRows.map((r) => circuitIdByPortId.get(r.source_port_id)).filter((id): id is string => !!id))];
  const nameById = new Map<string, string>();
  const detailById = new Map<string, { interfaceType: string | null; counterpartText: string | null }>();
  for (let i = 0; i < relevantCircuitIds.length; i += pageSize) {
    const chunk = relevantCircuitIds.slice(i, i + pageSize);
    const { data, error } = await supabase.from("circuits").select("id, name, interface_type, counterpart_text").in("id", chunk);
    if (error) {
      summary.errors.push(error.message);
      return summary;
    }
    for (const c of data ?? []) {
      nameById.set(c.id, c.name);
      detailById.set(c.id, { interfaceType: c.interface_type, counterpartText: c.counterpart_text });
    }
  }

  for (const row of transitRows) {
    const sourceCircuitId = circuitIdByPortId.get(row.source_port_id);
    if (!sourceCircuitId) continue; // Chuyển tiếp gắn ở port TRỐNG (không thuộc luồng nào) -> ngoài phạm vi hàm này
    const sourceName = nameById.get(sourceCircuitId) ?? "";
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue;
    const match = matchBareTrunkLink(raw, trunkPorts);
    if (!match || match.rackDomain !== "trunk" || !match.rackCode) continue;
    if (scope?.trunkRackCode) {
      const sourceRackCode = rackCodeByPortId.get(row.source_port_id);
      if (sourceRackCode !== scope.trunkRackCode && match.rackCode !== scope.trunkRackCode) continue;
    }
    const matchedPorts = match.resolvedPorts ?? [];
    if (matchedPorts.length === 0) continue;
    const rackId = rackIdByCode.get(match.rackCode);
    if (!rackId) continue;
    const portNumbers = matchedPorts.map((p) => p.portNumber);

    const { data: liveRows, error: liveErr } = await supabase
      .from("ports")
      .select("id, port_number, port_circuit_links(id, circuit_id, circuits(name))")
      .eq("rack_id", rackId)
      .in("port_number", portNumbers);
    if (liveErr) {
      summary.errors.push(`${sourceName}: ${liveErr.message}`);
      continue;
    }
    type RawLink = { id: string; circuit_id: string; circuits: { name: string } | { name: string }[] | null };
    type LiveRow = { id: string; port_number: number; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupant = rows.map((r) => firstLink(r.port_circuit_links)).find((l): l is RawLink => l !== null);
    if (occupant) {
      const occupantName = Array.isArray(occupant.circuits) ? occupant.circuits[0]?.name : occupant.circuits?.name;
      if ((occupantName ?? "").trim() === sourceName.trim()) {
        const { error: le } = await supabase.from("circuits").update({ mirror_of_id: sourceCircuitId }).eq("id", occupant.circuit_id);
        if (le) summary.errors.push(`${sourceName}: ${le.message}`);
        else summary.linked++;
      } else {
        const sourceRackCode = rackCodeByPortId.get(row.source_port_id) ?? "?";
        const sourcePortNumber = portNumberByPortId.get(row.source_port_id);
        const sourceRackId = rackIdByCode.get(sourceRackCode);
        summary.conflicts.push({
          sourceName,
          detail: `Chuyển tiếp tại ${sourceRackCode}${
            sourcePortNumber !== undefined ? ` port ${sourcePortNumber}` : ""
          } ghi "${raw}" → trỏ tới port ${match.rackCode} (${portNumbers.join(
            ","
          )}), nhưng port đó đang có luồng khác: "${occupantName ?? "(không rõ tên)"}"`,
          sourceHref: sourceRackId ? `/odf-trunk/${sourceRackId}#port-${row.source_port_id}` : undefined,
        });
      }
      continue;
    }

    const orderedPortIds = portNumbers.map((n) => rows.find((r) => r.port_number === n)?.id).filter((id): id is string => !!id);
    if (orderedPortIds.length !== portNumbers.length) continue;

    const sourceDetail = detailById.get(sourceCircuitId);
    const { data: newCircuit, error: circErr } = await supabase
      .from("circuits")
      .insert({
        name: sourceName,
        interface_type: sourceDetail?.interfaceType ?? null,
        counterpart_text: sourceDetail?.counterpartText ?? null,
        mirror_of_id: sourceCircuitId,
        notes: `Tự tạo từ luồng trung kế "${sourceName}" (quét lấp đầy chỗ trống, /data-quality) — xem lib/mirrorTrunkCircuits.ts.`,
      })
      .select("id")
      .single();
    if (circErr || !newCircuit) {
      summary.errors.push(`${sourceName}: ${circErr?.message ?? "không tạo được circuit"}`);
      continue;
    }

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
      summary.errors.push(`${sourceName}: ${newLinkErr.message}`);
      continue;
    }

    const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
    if (statusErr) summary.errors.push(`${sourceName}: tạo xong nhưng cập nhật ports.status lỗi: ${statusErr.message}`);

    summary.created++;
  }

  return summary;
}
