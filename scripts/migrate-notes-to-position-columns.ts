// Tách "Tọa độ DDF/ODF:" đang nằm trong circuits.notes ra 2 cột riêng
// circuits.device_position_own / device_position_next (xem migration
// 20260726000001_circuits_device_positions.sql — CHẠY migration đó trước).
// Chỉ xóa đúng các dòng "Tọa độ DDF/ODF:" khỏi notes, giữ nguyên mọi nhãn
// khác ("Thiết bị chuyển tiếp:", "TBi đầu cuối:", ghi chú gốc, "ID gốc:").
//
// Chạy:
//   npx tsx scripts/migrate-notes-to-position-columns.ts              -> DRY RUN
//   npx tsx scripts/migrate-notes-to-position-columns.ts -- --commit  -> ghi thật

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { extractDevicePositions } from "../lib/deviceNotes";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

function stripPositionLines(notes: string | null): string | null {
  if (!notes) return null;
  const kept = notes.split("\n").filter((line) => !line.startsWith("Tọa độ DDF/ODF:"));
  const joined = kept.join("\n").trim();
  return joined === "" ? null : joined;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  interface Row {
    id: string;
    notes: string | null;
    port_circuit_links: { id: string }[] | null;
  }

  const all: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("circuits")
      .select("id, notes, port_circuit_links(id)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Row[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  const deviceDomain = all.filter((r) => !r.port_circuit_links || r.port_circuit_links.length === 0);

  const toUpdate = deviceDomain
    .map((r) => {
      const positions = extractDevicePositions(r.notes);
      if (!positions.own && !positions.next) return null;
      return { id: r.id, own: positions.own, next: positions.next, newNotes: stripPositionLines(r.notes) };
    })
    .filter((v): v is { id: string; own: string | null; next: string | null; newNotes: string | null } => v !== null);

  console.log(`[migrate-notes-to-position-columns] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log(`[migrate-notes-to-position-columns] Tổng luồng thiết bị: ${deviceDomain.length}`);
  console.log(`[migrate-notes-to-position-columns] Sẽ cập nhật: ${toUpdate.length}`);
  console.log(`[migrate-notes-to-position-columns] Ví dụ 3 dòng đầu:`);
  for (const v of toUpdate.slice(0, 3)) {
    console.log(`  - id=${v.id} own="${v.own ?? ""}" next="${v.next ?? ""}"`);
  }

  if (!COMMIT) {
    console.log(`[migrate-notes-to-position-columns] DRY RUN — chưa ghi gì. Chạy: npx tsx scripts/migrate-notes-to-position-columns.ts -- --commit`);
    return;
  }

  let updated = 0;
  for (const v of toUpdate) {
    const { error } = await db
      .from("circuits")
      .update({ device_position_own: v.own, device_position_next: v.next, notes: v.newNotes })
      .eq("id", v.id);
    if (error) {
      console.error(`[migrate-notes-to-position-columns] Lỗi cập nhật id=${v.id}:`, error.message);
      continue;
    }
    updated++;
  }
  console.log(`[migrate-notes-to-position-columns] Đã cập nhật ${updated}/${toUpdate.length} luồng.`);
}

main().catch((err) => {
  console.error("[migrate-notes-to-position-columns] Lỗi:", err);
  process.exit(1);
});
