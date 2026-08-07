// Vá dữ liệu CŨ bị thiếu `transit_links` cho các luồng mirror TRUNG KẾ đã
// được tự tạo trước khi sửa bug ở architecture.md mục 63 (người dùng
// 2026-08-03, ca thật ADN1.ASBR#2-MX2020 (2/1/8) đi ODF 1/2 (47,48): mirror
// đã tạo đúng — `circuits`+`port_circuit_links`+`mirror_of_id` đều ổn — nhưng
// `autoCreateTrunkMirrorForCircuit()`/`syncAllTrunkMirrorGaps()` trước đó QUÊN
// ghi `transit_links` tương ứng, khiến cột "Chuyển tiếp" trông trống dù đã
// liên kết đúng).
//
// Xác định "mirror trung kế tạo từ luồng thiết bị" bằng CẤU TRÚC dữ liệu
// (không dựa vào chữ trong `notes`, tránh bị lệch nếu ai đó từng sửa tay
// notes) — 1 dòng `circuits` được coi là ứng viên khi:
//   1. `mirror_of_id` trỏ tới 1 luồng THIẾT BỊ thật (có `device_id`) — tức
//      đây là chiều mirror thiết bị -> trung kế (autoCreateTrunkMirrorForCircuit),
//      KHÔNG phải mirror thiết bị-thiết bị (loại đó không có port_circuit_links
//      nên tự bị loại ở bước sau) và KHÔNG phải mirror trung kế-trung kế (loại
//      đó `mirror_of_id` trỏ tới 1 luồng trung kế khác, không có `device_id`).
//   2. Chính dòng mirror này CÓ `port_circuit_links` (xác nhận đúng là luồng
//      trung kế thật, gắn port thật).
//   3. Port đầu tiên của nó CHƯA có dòng `transit_links` nào (đúng lỗ hổng cần
//      vá — không đụng tới port đã có `transit_links` dù nội dung khác gì).
//
// Công thức dựng `raw_text` GIỐNG HỆT `buildTransitRawTextFromDevice()`
// (lib/mirrorTrunkCircuits.ts, đã dùng cho code mới) — không viết lại quy ước
// khác rồi lệch nhau (bài học architecture.md mục 34/35). Bỏ qua (log rõ lý
// do) nếu luồng gốc thiếu 1 trong 3 trường Vị trí ODF (thiết bị)/Tên thiết
// bị/Trib.
//
// DRY RUN mặc định, --commit để ghi thật (đúng quy ước chung mọi script khác).
// Chạy: npm run backfill-transit-links-for-mirrors
//       npm run backfill-transit-links-for-mirrors -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { getSupabaseAdmin } = await import("./lib/supabaseAdmin");
  const { fetchDeviceCircuits } = await import("../lib/deviceCircuits");
  const { writeTransitForPorts } = await import("../lib/transitLinks");

  const supabase = getSupabaseAdmin();

  console.log(`[backfill-transit-links-for-mirrors] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log("Đang tải dữ liệu...");

  const deviceCircuits = await fetchDeviceCircuits(supabase);
  const deviceCircuitById = new Map(deviceCircuits.map((c) => [c.id, c]));

  // Mọi circuit CÓ mirror_of_id (là 1 mirror của ai đó), kèm luôn
  // port_circuit_links (port_id, link_role) để biết nó có phải mirror TRUNG
  // KẾ thật không (có port) và port đầu tiên là port nào.
  const { data: mirrorRows, error: mirrorErr } = await supabase
    .from("circuits")
    .select("id, name, mirror_of_id, port_circuit_links(port_id, link_role)")
    .not("mirror_of_id", "is", null);
  if (mirrorErr) throw mirrorErr;

  type RawLink = { port_id: string; link_role: string };
  type MirrorRow = { id: string; name: string; mirror_of_id: string; port_circuit_links: RawLink | RawLink[] | null };
  const rows = (mirrorRows ?? []) as unknown as MirrorRow[];

  let created = 0;
  let skippedNoPort = 0;
  let skippedNotDeviceOrigin = 0;
  let skippedAlreadyHasTransit = 0;
  let skippedMissingSourceFields = 0;
  let errors = 0;

  for (const row of rows) {
    const origin = deviceCircuitById.get(row.mirror_of_id);
    if (!origin) {
      // mirror_of_id không trỏ tới 1 luồng THIẾT BỊ (device_id) -> hoặc là
      // mirror trung kế-trung kế, hoặc mirror thiết bị-thiết bị (đã tự loại
      // ở bước port bên dưới nếu chưa loại ở đây) -> không thuộc phạm vi.
      skippedNotDeviceOrigin++;
      continue;
    }

    const links = row.port_circuit_links;
    const linkArr = Array.isArray(links) ? links : links ? [links] : [];
    if (linkArr.length === 0) {
      // Không có port -> đây là mirror THIẾT BỊ-THIẾT BỊ (dùng chung cột
      // mirror_of_id), không có khái niệm transit_links -> bỏ qua, đúng bình
      // thường, không phải lỗi.
      skippedNoPort++;
      continue;
    }

    // Sắp theo đúng quy ước tx trước rx sau (giống mọi nơi khác trong dự án)
    // — "single" cũng coi là đầu tiên (chỉ có 1 port). Lấy ĐỦ mọi port của
    // circuit (2026-08-04, xem lib/transitLinks.ts) — trước đây chỉ xét/ghi
    // port ĐẦU TIÊN, để sợi thứ 2 (nếu có) mãi mãi không có "Chuyển tiếp" dù
    // cùng 1 luồng vừa được vá port đầu.
    const ordered = [...linkArr].sort((a, b) => {
      const rank = (r: string) => (r === "tx" ? 0 : r === "single" ? 0 : 1);
      return rank(a.link_role) - rank(b.link_role);
    });
    const allPortIds = ordered.map((o) => o.port_id);

    // Vẫn giữ nguyên tinh thần THẬN TRỌNG gốc của script này: chỉ vá khi
    // TOÀN BỘ port của circuit đang chưa có transit_links nào (không đụng gì
    // nếu dù chỉ 1 port đã có dữ liệu, kể cả dữ liệu đó khác nội dung).
    const { data: existingTransit, error: transitCheckErr } = await supabase
      .from("transit_links")
      .select("id")
      .in("source_port_id", allPortIds);
    if (transitCheckErr) {
      console.log(`  [LỖI] "${row.name}" -> không đọc được transit_links: ${transitCheckErr.message}`);
      errors++;
      continue;
    }
    if ((existingTransit ?? []).length > 0) {
      skippedAlreadyHasTransit++;
      continue;
    }

    if (!origin.devicePositionOwn || !origin.deviceName || !origin.tribText) {
      console.log(
        `  [BỎ QUA] "${row.name}" (mirror của "${origin.name}") -> luồng gốc thiếu Vị trí ODF (thiết bị)/Tên thiết bị/Trib, không đủ dữ liệu để dựng Chuyển tiếp.`
      );
      skippedMissingSourceFields++;
      continue;
    }

    const rawText = `${origin.devicePositionOwn} - ${origin.deviceName} (${origin.tribText})`;

    if (!COMMIT) {
      console.log(`  [SẼ TẠO] "${row.name}" -> transit_links.raw_text = "${rawText}" (${allPortIds.length} port)`);
      created++;
      continue;
    }

    try {
      await writeTransitForPorts(supabase, allPortIds, rawText);
    } catch (e) {
      console.log(`  [LỖI] "${row.name}" -> ghi transit_links thất bại: ${e instanceof Error ? e.message : String(e)}`);
      errors++;
      continue;
    }
    console.log(`  [ĐÃ TẠO] "${row.name}" -> transit_links.raw_text = "${rawText}" (${allPortIds.length} port)`);
    created++;
  }

  console.log(`\n=== TÓM TẮT ===`);
  console.log(`${COMMIT ? "Đã tạo" : "Sẽ tạo"}: ${created}`);
  console.log(`Bỏ qua (đã có transit_links từ trước): ${skippedAlreadyHasTransit}`);
  console.log(`Bỏ qua (thiếu dữ liệu gốc để dựng Chuyển tiếp): ${skippedMissingSourceFields}`);
  console.log(`Bỏ qua (không phải mirror thiết bị->trung kế): ${skippedNotDeviceOrigin + skippedNoPort}`);
  console.log(`Lỗi: ${errors}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN — chưa ghi gì. Chạy: npm run backfill-transit-links-for-mirrors -- --commit`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
