// Rà soát TOÀN BỘ cột "Chuyển tiếp" (transit_links.raw_text) bên ODF Trung
// kế tìm trường hợp trỏ THẲNG sang 1 port trung kế KHÁC (không qua thiết bị
// nào — "form 2" đã công nhận ở lib/transitLinks.ts, vd "ODF 6/1 (4)") nhưng
// port đích đó đang TRỐNG (không có port_circuit_links thật) — người dùng
// phát hiện thật 2026-07-31: thêm luồng "IDC3 - CMC" ở ODF2/10(28), Chuyển
// tiếp ghi "ODF 6/1 (4)", nhưng port 4 rack ODF6/1 vẫn trống.
//
// Cùng LỚP vấn đề với mục 15 (scripts/audit-device-trunk-sync.ts) nhưng
// hướng KHÁC: mục 15 rà luồng THIẾT BỊ trỏ sang trung kế; script này rà
// luồng TRUNG KẾ (đã có port_circuit_links thật) mà "Chuyển tiếp" của nó lại
// trỏ sang 1 port trung kế KHÁC đang trống — tức thiếu "luồng mirror" ở đầu
// bên kia, đúng pattern "2 dòng circuit mirror nhau cho 1 liên kết vật lý"
// đã có sẵn trong dữ liệu (mục 15).
//
// CHỈ ĐỌC (read-only) — không sửa gì, chỉ in báo cáo.
//
// Dùng THẲNG matchBareTrunkLink()/fetchAllOdfPorts() thật (không chép lại
// thuật toán) — cùng kỹ thuật loadEnv() rồi import ĐỘNG đã dùng ở mục 15.
//
// Chạy: npm run audit-trunk-trunk-sync
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { fetchAllOdfPorts, matchBareTrunkLink } = await import("../lib/trunkPorts");

  type TrunkPortRow = Awaited<ReturnType<typeof fetchAllOdfPorts>>[number];

  const trunkPorts = await fetchAllOdfPorts();
  const portById = new Map<string, TrunkPortRow>(trunkPorts.map((p) => [p.portId, p]));

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
  function firstOf<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? v[0] ?? null : v;
  }

  const pageSize = 1000;
  const allLinks: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("transit_links")
      .select("id, raw_text, ports:ports!transit_links_source_port_id_fkey(id, port_number, rack_id, racks(code, domain))")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    allLinks.push(...page);
    if (page.length < pageSize) break;
  }
  console.log(`Tổng ${allLinks.length} dòng transit_links.`);

  interface UnsyncedCase {
    sourceRack: string;
    sourcePort: number;
    sourceCircuitName: string | null;
    rawText: string;
    targetRack: string;
    targetPort: number;
  }
  const unsynced: UnsyncedCase[] = [];
  let bareTrunkMatchCount = 0;

  for (const row of allLinks) {
    const sourcePort = firstOf(row.ports);
    if (!sourcePort) continue;
    const sourceRack = firstOf(sourcePort.racks);
    if (!sourceRack || sourceRack.domain !== "trunk") continue; // chỉ xét nguồn là trung kế thật
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue;

    const match = matchBareTrunkLink(raw, trunkPorts);
    if (!match || match.rackDomain !== "trunk") continue; // không phải "form 2" (bare trunk link)
    bareTrunkMatchCount++;

    const sourceCircuit = portById.get(sourcePort.id)?.circuit ?? null;

    for (const rp of match.resolvedPorts ?? []) {
      if (rp.inUse) continue; // port đích đã có luồng thật — đồng bộ đúng, bỏ qua
      unsynced.push({
        sourceRack: sourceRack.code,
        sourcePort: sourcePort.port_number,
        sourceCircuitName: sourceCircuit?.name ?? null,
        rawText: raw,
        targetRack: match.rackCode!,
        targetPort: rp.portNumber,
      });
    }
  }

  console.log(`${bareTrunkMatchCount} dòng "Chuyển tiếp" khớp form "trỏ thẳng sang rack trung kế khác".`);
  console.log(`\n=== ${unsynced.length} trường hợp CHƯA ĐỒNG BỘ (port đích đang trống) ===`);
  for (const u of unsynced) {
    console.log(
      `  Rack ${u.sourceRack} port ${u.sourcePort} (luồng "${u.sourceCircuitName ?? "?"}") ghi "Chuyển tiếp" = "${u.rawText}" -> Rack ${u.targetRack} port ${u.targetPort} đang TRỐNG`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
