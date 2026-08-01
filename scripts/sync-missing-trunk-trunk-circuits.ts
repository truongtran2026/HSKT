// Tạo THẬT luồng "mirror" + port_circuit_links cho các trường hợp
// "chưa đồng bộ" mà scripts/audit-trunk-trunk-sync.ts phát hiện (2026-07-31)
// — người dùng xác nhận hướng xử lý: tự động tạo luồng trung kế cho toàn bộ
// trường hợp cột "Chuyển tiếp" của 1 luồng trung kế trỏ THẲNG sang 1 port
// trung kế KHÁC (không qua thiết bị) nhưng port đó vẫn "trống".
//
// CÙNG PATTERN với scripts/sync-missing-trunk-circuits.ts (mục 15) — chỉ
// khác nguồn là luồng TRUNG KẾ (đã có port_circuit_links thật) thay vì luồng
// thiết bị. KHÁC 1 điểm quan trọng: gắn `circuits.mirror_of_id` NGAY LÚC TẠO
// (cột thật, `on delete cascade` — xem migration `circuits_mirror_of`, mục
// 33) thay vì chỉ ghi text "luồng gốc id..." vào notes — tránh lặp lại đúng
// bug mirror mồ côi đã gặp ở mục 32 (mirror cũ tạo TRƯỚC KHI có cột này mới
// phải chạy backfill riêng).
//
// TỰ RÀ SOÁT LẠI TỪ ĐẦU (không đọc từ báo cáo audit cũ) để chắc chắn hành
// động trên dữ liệu SỐNG tại đúng lúc chạy.
//
// An toàn khi 1 port cần dùng KHÔNG còn trống lúc THẬT SỰ ghi (vd 2 luồng
// mirror nhau cùng trỏ 1 cặp port — xử lý xong 1 luồng thì luồng còn lại tự
// nhiên "hết trống"; hoặc port bị chiếm bởi luồng khác từ trước) -> BỎ QUA,
// in rõ lý do để người dùng tự rà tay.
//
// DRY RUN mặc định, --commit để ghi thật.
//
// Chạy: npm run sync-missing-trunk-trunk-circuits
//       npm run sync-missing-trunk-trunk-circuits -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { fetchAllOdfPorts, matchBareTrunkLink } = await import("../lib/trunkPorts");

  type TrunkPortRow = Awaited<ReturnType<typeof fetchAllOdfPorts>>[number];

  console.log(`[sync-missing-trunk-trunk-circuits] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log("Đang tải dữ liệu port + transit_links...");

  const trunkPorts: TrunkPortRow[] = await fetchAllOdfPorts();
  const portById = new Map<string, TrunkPortRow>(trunkPorts.map((p) => [p.portId, p]));
  const rackIdByCode = new Map<string, string>();
  for (const p of trunkPorts) rackIdByCode.set(p.rackCode, p.rackId);

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

  interface Candidate {
    sourceCircuitId: string;
    sourceCircuitName: string;
    sourceInterfaceType: string | null;
    sourceCounterpartText: string | null;
    sourceRackCode: string;
    sourcePortNumber: number;
    rawText: string;
    rackId: string;
    rackCode: string;
    portNumbers: number[];
  }
  const candidates: Candidate[] = [];

  for (const row of allLinks) {
    const sourcePort = firstOf(row.ports);
    if (!sourcePort) continue;
    const sourceRack = firstOf(sourcePort.racks);
    if (!sourceRack || sourceRack.domain !== "trunk") continue;
    const raw = (row.raw_text ?? "").trim();
    if (!raw) continue;

    const sourceTrunkPort = portById.get(sourcePort.id);
    const sourceCircuit = sourceTrunkPort?.circuit;
    if (!sourceCircuit) continue; // port nguồn tự nó đang trống thì không có gì để mirror

    const match = matchBareTrunkLink(raw, trunkPorts);
    if (!match || match.rackDomain !== "trunk" || !match.rackCode) continue;
    const ports = match.resolvedPorts ?? [];
    if (ports.length === 0) continue;
    if (ports.every((p) => p.inUse)) continue; // đã đồng bộ đầy đủ

    const rackId = rackIdByCode.get(match.rackCode);
    if (!rackId) continue;

    candidates.push({
      sourceCircuitId: sourceCircuit.id,
      sourceCircuitName: sourceCircuit.name,
      sourceInterfaceType: sourceCircuit.interfaceType,
      sourceCounterpartText: sourceCircuit.counterpartText,
      sourceRackCode: sourceRack.code,
      sourcePortNumber: sourcePort.port_number,
      rawText: raw,
      rackId,
      rackCode: match.rackCode,
      portNumbers: ports.map((p) => p.portNumber),
    });
  }

  console.log(`Tìm thấy ${candidates.length} ứng viên cần tạo luồng mirror (khớp lúc quét ban đầu).\n`);

  let created = 0;
  let skipped = 0;

  for (const cand of candidates) {
    // Rà soát LẠI ngay trước khi ghi — tránh dùng dữ liệu cũ (vd 1 luồng
    // mirror trước đó trong CÙNG lượt chạy này đã lấp port rồi).
    const { data: liveRows, error: liveErr } = await supabase
      .from("ports")
      .select("id, port_number, status, port_circuit_links(id, circuits(name))")
      .eq("rack_id", cand.rackId)
      .in("port_number", cand.portNumbers);
    if (liveErr) {
      console.log(`  [LỖI] "${cand.sourceCircuitName}" (${cand.sourceRackCode} port ${cand.sourcePortNumber}) -> không đọc được port sống: ${liveErr.message}`);
      skipped++;
      continue;
    }
    type RawLink = { id: string; circuits: { name: string } | { name: string }[] | null };
    type LiveRow = { id: string; port_number: number; status: string; port_circuit_links: RawLink | RawLink[] | null };
    const rows = (liveRows ?? []) as unknown as LiveRow[];
    function firstLink(v: RawLink | RawLink[] | null): RawLink | null {
      if (!v) return null;
      return Array.isArray(v) ? v[0] ?? null : v;
    }
    const occupied = rows.filter((r) => firstLink(r.port_circuit_links) !== null);
    if (occupied.length > 0) {
      const names = occupied.map((r) => {
        const link = firstLink(r.port_circuit_links)!;
        const c = Array.isArray(link.circuits) ? link.circuits[0] : link.circuits;
        return `port ${r.port_number}=${c?.name ?? "?"}`;
      });
      console.log(
        `  [BỎ QUA] "${cand.sourceCircuitName}" (${cand.sourceRackCode} port ${cand.sourcePortNumber}) -> rack "${cand.rackCode}" đã có luồng khác chiếm: ${names.join(", ")} (có thể do luồng mirror cùng đợt chạy này, hoặc xung đột thật cần rà tay).`
      );
      skipped++;
      continue;
    }
    const orderedPortIds = cand.portNumbers.map((n) => rows.find((r) => r.port_number === n)!.id);

    if (!COMMIT) {
      console.log(
        `  [SẼ TẠO] "${cand.sourceCircuitName}" (${cand.sourceRackCode} port ${cand.sourcePortNumber}) -> rack "${cand.rackCode}", port ${cand.portNumbers.join(",")} ` +
          `(giao tiếp: ${cand.sourceInterfaceType ?? "?"}, đối phương: ${cand.sourceCounterpartText ?? "—"})`
      );
      created++;
      continue;
    }

    const { data: newCircuit, error: circErr } = await supabase
      .from("circuits")
      .insert({
        name: cand.sourceCircuitName,
        interface_type: cand.sourceInterfaceType,
        counterpart_text: cand.sourceCounterpartText,
        mirror_of_id: cand.sourceCircuitId,
        notes: `Tự tạo từ luồng trung kế "${cand.sourceCircuitName}" (${cand.sourceRackCode} port ${cand.sourcePortNumber}) — rà soát đồng bộ ODF trung kế-trung kế 2026-07-31, script sync-missing-trunk-trunk-circuits.ts.`,
      })
      .select("id")
      .single();
    if (circErr || !newCircuit) {
      console.log(`  [LỖI] "${cand.sourceCircuitName}" -> tạo circuit thất bại: ${circErr?.message}`);
      skipped++;
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
      console.log(`  [LỖI] "${cand.sourceCircuitName}" -> tạo port_circuit_links thất bại: ${linkErr.message}, đang xóa circuit vừa tạo để không để rác...`);
      await supabase.from("circuits").delete().eq("id", newCircuit.id);
      skipped++;
      continue;
    }

    const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
    if (statusErr) {
      console.log(`  [CẢNH BÁO] "${cand.sourceCircuitName}" -> tạo luồng+link OK nhưng cập nhật ports.status lỗi: ${statusErr.message}`);
    }

    console.log(`  [ĐÃ TẠO] "${cand.sourceCircuitName}" (${cand.sourceRackCode} port ${cand.sourcePortNumber}) -> rack "${cand.rackCode}", port ${cand.portNumbers.join(",")} (circuit mới: ${newCircuit.id})`);
    created++;
  }

  console.log(`\n=== TÓM TẮT ===`);
  console.log(`${COMMIT ? "Đã tạo" : "Sẽ tạo"}: ${created}`);
  console.log(`Bỏ qua (xung đột/lỗi): ${skipped}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN — chưa ghi gì. Chạy: npm run sync-missing-trunk-trunk-circuits -- --commit`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
