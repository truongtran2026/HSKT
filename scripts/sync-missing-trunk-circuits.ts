// Tạo THẬT luồng + port_circuit_links phía ODF Trung kế cho các trường hợp
// "chưa đồng bộ" mà scripts/audit-device-trunk-sync.ts phát hiện (2026-07-28)
// — người dùng xác nhận hướng xử lý: tự động tạo luồng trung kế cho toàn bộ
// các trường hợp Ô "Vị trí ODF (thiết bị)"/"Vị trí ODF (tiếp theo)" khớp
// đúng 1 rack/port trung kế THẬT nhưng port đó vẫn "trống" (không có
// port_circuit_links) trên Hồ sơ ODF Trung kế.
//
// KHÔNG đụng luồng thiết bị GỐC — chỉ THÊM 1 dòng `circuits` MỚI (mirror
// phía trung kế, copy tên/giao tiếp/đối phương từ luồng gốc) + `port_circuit_links`
// cho đúng port đã xác nhận trống + cập nhật `ports.status`, đúng chuỗi thao
// tác PortTable.tsx làm khi người dùng tự tay thêm 1 luồng trung kế mới. Theo
// đúng pattern "2 dòng circuit mirror nhau cho 1 liên kết vật lý" đã có sẵn
// trong dữ liệu thật (vd cặp own=ODF1/15/next=ODF9/17 và ngược lại từ phía
// OME-TK#1 cho cùng 1 luồng "10GE AĐN1.P2 (8/3/2)...").
//
// Sửa 2026-07-31: gắn `circuits.mirror_of_id` NGAY LÚC TẠO (cột thật từ mục
// 33, `on delete cascade`) — trước đó chỉ ghi "luồng gốc id <uuid>" dạng TEXT
// trong notes (không có ràng buộc CSDL nào), y hệt bug mồ côi đã gặp ở mục 32.
// Từ giờ xóa luồng thiết bị gốc thì mirror trung kế này tự xóa theo, không
// cần code nhớ gọi đúng hàm (xem lib/mirrorTrunkCircuits.ts).
//
// TỰ RÀ SOÁT LẠI TỪ ĐẦU (không đọc từ file JSON cũ của audit) để chắc chắn
// hành động trên dữ liệu SỐNG tại đúng lúc chạy, không phải ảnh chụp cũ.
//
// An toàn khi 1 trong các port cần dùng KHÔNG còn trống lúc THẬT SỰ ghi (vd 2
// luồng thiết bị mirror nhau cùng trỏ 1 cặp port — xử lý xong 1 luồng thì
// luồng còn lại tự nhiên "hết trống", không tạo trùng; hoặc port bị 1 luồng
// trung kế KHÁC chiếm mất từ trước, không phải do chính đợt chạy này) -> BỎ
// QUA, không cố ép ghi, in rõ lý do để người dùng tự rà tay.
//
// DRY RUN mặc định, --commit để ghi thật (đúng quy ước chung mọi script khác
// trong dự án).
//
// Chạy: npm run sync-missing-trunk-circuits
//       npm run sync-missing-trunk-circuits -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import type { TrunkMirrorCandidate } from "../lib/mirrorTrunkCircuits";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { supabase } = await import("../lib/supabase");
  const { fetchAllOdfPorts } = await import("../lib/trunkPorts");
  const { fetchDeviceCircuits } = await import("../lib/deviceCircuits");
  const { findTrunkMirrorCandidates } = await import("../lib/mirrorTrunkCircuits");

  type TrunkPortRow = Awaited<ReturnType<typeof fetchAllOdfPorts>>[number];
  type DeviceCircuitRow = Awaited<ReturnType<typeof fetchDeviceCircuits>>[number];

  interface Candidate extends TrunkMirrorCandidate {
    sourceCircuit: DeviceCircuitRow;
  }

  console.log(`[sync-missing-trunk-circuits] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log("Đang tải dữ liệu port + luồng thiết bị...");
  const trunkPorts: TrunkPortRow[] = await fetchAllOdfPorts();
  const circuits: DeviceCircuitRow[] = await fetchDeviceCircuits();

  const rackIdByCode = new Map<string, string>();
  for (const p of trunkPorts) rackIdByCode.set(p.rackCode, p.rackId);

  // findTrunkMirrorCandidates() TÁI DÙNG NGUYÊN thuật toán dò khớp (cũng dùng
  // cho autoCreateTrunkMirrorForCircuit() gọi trực tiếp từ UI, xem
  // lib/mirrorTrunkCircuits.ts) — không viết lại ở đây, tránh lệch nhau (bài
  // học architecture.md mục 34/35).
  const candidates: Candidate[] = circuits.flatMap((c) =>
    findTrunkMirrorCandidates(c, trunkPorts, rackIdByCode).map((cand) => ({ ...cand, sourceCircuit: c }))
  );

  console.log(`Tìm thấy ${candidates.length} ứng viên cần tạo luồng trung kế (khớp lúc quét ban đầu).\n`);

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
      console.log(`  [LỖI] "${cand.sourceCircuit.name}" [${cand.field}] -> không đọc được port sống: ${liveErr.message}`);
      skipped++;
      continue;
    }
    // QUAN TRỌNG: port_circuit_links.port_id có ràng buộc `unique` — PostgREST
    // vì vậy trả về quan hệ này dạng 1 OBJECT đơn (hoặc null), KHÔNG PHẢI
    // mảng, khác với cách lib/trunkPorts.ts phải tự dò cả 2 dạng bằng
    // firstOf() (phòng khi PostgREST đổi cách suy luận). Bug đã gặp thực tế
    // lúc chạy --commit lần đầu 2026-07-28: coi nhầm là mảng rồi lọc theo
    // `.length > 0` -> luôn `undefined > 0` = false, khiến bước rà soát này
    // KHÔNG BAO GIỜ phát hiện được xung đột thật (dù hiển thị đúng lúc DEBUG
    // trực tiếp) — chỉ được cứu nhờ constraint `unique` thật của DB chặn
    // đúng lúc ghi + code tự xóa lại circuit vừa tạo khi ghi lỗi, nên KHÔNG
    // để lại dữ liệu rác, nhưng phải sửa lại đây để bước rà soát THẬT SỰ có
    // tác dụng (tránh tạo xong rồi xóa lãng phí, và để log "[BỎ QUA]" đúng
    // nghĩa thay vì rơi vào nhánh lỗi ghi).
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
        `  [BỎ QUA] "${cand.sourceCircuit.name}" [${cand.field}] -> rack "${cand.rackCode}" đã có luồng khác chiếm: ${names.join(", ")} (có thể do luồng mirror cùng đợt chạy này, hoặc xung đột thật cần rà tay).`
      );
      skipped++;
      continue;
    }
    // Sắp theo đúng port_number đã lấy (giữ nguyên thứ tự cand.portNumbers).
    const orderedPortIds = cand.portNumbers.map((n) => rows.find((r) => r.port_number === n)!.id);

    if (!COMMIT) {
      console.log(
        `  [SẼ TẠO] "${cand.sourceCircuit.name}" [${cand.field}] -> rack "${cand.rackCode}", port ${cand.portNumbers.join(",")} ` +
          `(giao tiếp: ${cand.sourceCircuit.interfaceType ?? "?"}, đối phương: ${cand.sourceCircuit.counterpartText ?? "—"})`
      );
      created++;
      continue;
    }

    const { data: newCircuit, error: circErr } = await supabase
      .from("circuits")
      .insert({
        name: cand.sourceCircuit.name,
        interface_type: cand.sourceCircuit.interfaceType,
        counterpart_text: cand.sourceCircuit.counterpartText,
        mirror_of_id: cand.sourceCircuit.id,
        notes: `Tự tạo từ luồng thiết bị "${cand.sourceCircuit.name}" (rà soát đồng bộ ODF 2026-07-28, script sync-missing-trunk-circuits.ts) — xem chi tiết ở "Sửa luồng thiết bị", luồng gốc id ${cand.sourceCircuit.id}.`,
      })
      .select("id")
      .single();
    if (circErr || !newCircuit) {
      console.log(`  [LỖI] "${cand.sourceCircuit.name}" [${cand.field}] -> tạo circuit thất bại: ${circErr?.message}`);
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
      console.log(`  [LỖI] "${cand.sourceCircuit.name}" [${cand.field}] -> tạo port_circuit_links thất bại: ${linkErr.message}, đang xóa circuit vừa tạo để không để rác...`);
      await supabase.from("circuits").delete().eq("id", newCircuit.id);
      skipped++;
      continue;
    }

    const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", orderedPortIds);
    if (statusErr) {
      console.log(`  [CẢNH BÁO] "${cand.sourceCircuit.name}" [${cand.field}] -> tạo luồng+link OK nhưng cập nhật ports.status lỗi: ${statusErr.message}`);
    }

    console.log(`  [ĐÃ TẠO] "${cand.sourceCircuit.name}" [${cand.field}] -> rack "${cand.rackCode}", port ${cand.portNumbers.join(",")} (circuit mới: ${newCircuit.id})`);
    created++;
  }

  console.log(`\n=== TÓM TẮT ===`);
  console.log(`${COMMIT ? "Đã tạo" : "Sẽ tạo"}: ${created}`);
  console.log(`Bỏ qua (xung đột/lỗi): ${skipped}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN — chưa ghi gì. Chạy: npm run sync-missing-trunk-circuits -- --commit`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
