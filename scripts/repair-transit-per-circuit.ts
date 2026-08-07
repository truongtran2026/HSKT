// Vá dữ liệu CŨ bị lệch do 6 đường ghi "Chuyển tiếp" (transit_links.raw_text)
// trước đây có 2 hành vi khác nhau (rà soát toàn dự án 2026-08-03, sửa gốc rễ
// ở lib/transitLinks.ts writeTransitForPorts() — xem file đó để hiểu đầy đủ).
// Kiểm tra thật trên dữ liệu sống 2026-08-04 (chỉ đọc) phát hiện đúng 2 loại
// lệch, xử lý RIÊNG từng loại:
//
//   A. 1 port có source_port_id bị GHI TRÙNG NHIỀU DÒNG (bug hiếm — thấy 1
//      port bị ghi trùng y hệt 3 lần). CHỈ gộp khi mọi dòng trùng có
//      raw_text giống HỆT nhau (an toàn tuyệt đối) — khác nhau thì bỏ qua,
//      chỉ in ra để tự xem xét, không tự đoán dòng nào đúng.
//
//   B. 1 circuit có ≥2 port nhưng chỉ 1 số port có transit_links (số còn lại
//      trống) — vá bằng writeTransitForPorts() (dùng lại ĐÚNG hàm sống,
//      không viết công thức riêng — writeTransitForPorts tự BẢO VỆ các
//      circuit đã có ≥2 giá trị KHÁC nhau, không đụng gì tới 11 luồng khuếch
//      đại/DWDM đã xác nhận có Tx/Rx đi khác port THẬT — người dùng xác nhận
//      2026-08-04).
//
// DRY RUN mặc định, --commit để ghi thật (đúng quy ước chung mọi script khác
// trong repo — xem scripts/sync-missing-trunk-circuits.ts).
// Chạy: npm run repair-transit-per-circuit
//       npm run repair-transit-per-circuit -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { getSupabaseAdmin } = await import("./lib/supabaseAdmin");
  const { writeTransitForPorts } = await import("../lib/transitLinks");

  const supabase = getSupabaseAdmin();

  console.log(`[repair-transit-per-circuit] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log("Đang tải dữ liệu...");

  async function fetchAll<T>(table: string, cols: string): Promise<T[]> {
    const pageSize = 1000;
    const all: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(table).select(cols).range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as unknown as T[];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  const transitRows = await fetchAll<{ id: string; source_port_id: string; raw_text: string | null }>(
    "transit_links",
    "id, source_port_id, raw_text"
  );
  const pclRows = await fetchAll<{ circuit_id: string; port_id: string }>("port_circuit_links", "circuit_id, port_id");

  // ============================================================
  // PHẦN A — gộp dòng trùng source_port_id (chỉ khi giống hệt nhau)
  // ============================================================
  console.log("\n=== PHẦN A: dòng transit_links bị trùng source_port_id ===");
  const byPort = new Map<string, { id: string; raw_text: string | null }[]>();
  for (const r of transitRows) {
    const list = byPort.get(r.source_port_id) ?? [];
    list.push({ id: r.id, raw_text: r.raw_text });
    byPort.set(r.source_port_id, list);
  }
  let dedupSafe = 0;
  let dedupAmbiguous = 0;
  const idsToDelete: string[] = [];
  for (const [portId, rows] of byPort) {
    if (rows.length <= 1) continue;
    const distinct = new Set(rows.map((r) => r.raw_text ?? ""));
    if (distinct.size === 1) {
      // Giống hệt nhau — giữ dòng đầu (id nhỏ nhất theo thứ tự sinh ra), xóa các dòng còn lại.
      const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
      const keep = sorted[0];
      const dupIds = sorted.slice(1).map((r) => r.id);
      console.log(`  [SẼ GỘP] port ${portId}: ${rows.length} dòng giống hệt nhau -> giữ ${keep.id}, xóa ${dupIds.join(", ")}`);
      idsToDelete.push(...dupIds);
      dedupSafe++;
    } else {
      console.log(`  [MƠ HỒ — bỏ qua] port ${portId}: ${rows.length} dòng KHÁC nội dung nhau, cần tự xem xét:`);
      for (const r of rows) console.log(`      id=${r.id} raw_text="${r.raw_text}"`);
      dedupAmbiguous++;
    }
  }
  console.log(`Tổng: ${dedupSafe} port gộp được an toàn (${idsToDelete.length} dòng sẽ xóa), ${dedupAmbiguous} port mơ hồ (bỏ qua, không tự xử lý).`);

  if (COMMIT && idsToDelete.length > 0) {
    const { error } = await supabase.from("transit_links").delete().in("id", idsToDelete);
    if (error) throw error;
    console.log(`  -> Đã xóa ${idsToDelete.length} dòng trùng.`);
  }

  // ============================================================
  // PHẦN B — vá circuit có port thiếu transit_links (dùng writeTransitForPorts)
  // ============================================================
  console.log("\n=== PHẦN B: circuit có port thiếu Chuyển tiếp so với port khác cùng luồng ===");
  // Dùng lại raw_text MỚI NHẤT sau Phần A (nếu chạy --commit, các dòng trùng
  // đã xóa nên bản đồ port->text cần loại các id vừa xóa; DRY RUN thì cứ tính
  // trên dữ liệu hiện có, đủ để xem trước).
  const deletedSet = new Set(COMMIT ? idsToDelete : []);
  const rawTextByPort = new Map<string, string | null>();
  for (const r of transitRows) {
    if (deletedSet.has(r.id)) continue;
    rawTextByPort.set(r.source_port_id, r.raw_text);
  }

  const portsByCircuit = new Map<string, string[]>();
  for (const row of pclRows) {
    const list = portsByCircuit.get(row.circuit_id) ?? [];
    list.push(row.port_id);
    portsByCircuit.set(row.circuit_id, list);
  }

  let willFill = 0;
  let protectedCount = 0;
  let alreadyOk = 0;
  for (const [circuitId, portIds] of portsByCircuit) {
    if (portIds.length < 2) continue;
    const values = portIds.map((id) => rawTextByPort.get(id) ?? null);
    const nonNull = values.filter((v): v is string => v !== null && v.trim() !== "");
    const distinctNonNull = new Set(nonNull);
    if (distinctNonNull.size === 0) continue; // Cả 2 port đều trống — không có gì để vá.
    if (distinctNonNull.size >= 2) {
      protectedCount++;
      continue; // Luồng khuếch đại/DWDM (hoặc ca lạ khác) — writeTransitForPorts sẽ tự bảo vệ, không đụng.
    }
    if (nonNull.length === values.length) {
      alreadyOk++;
      continue; // Đã đủ, không thiếu port nào.
    }
    const canonical = [...distinctNonNull][0];
    const missingPorts = portIds.filter((id) => !(rawTextByPort.get(id) ?? "").trim());
    console.log(`  [SẼ VÁ] circuit ${circuitId}: điền "${canonical}" cho ${missingPorts.length} port đang trống (${missingPorts.join(", ")})`);
    willFill++;
    if (COMMIT) {
      await writeTransitForPorts(supabase, portIds, canonical);
    }
  }
  console.log(`Tổng: ${willFill} circuit ${COMMIT ? "đã vá" : "sẽ vá"}, ${protectedCount} circuit được BẢO VỆ (đã có ≥2 giá trị khác nhau — không đụng), ${alreadyOk} circuit đã đủ dữ liệu.`);

  if (!COMMIT) {
    console.log(`\nDRY RUN — chưa ghi gì. Xem lại danh sách trên rồi chạy: npm run repair-transit-per-circuit -- --commit`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
