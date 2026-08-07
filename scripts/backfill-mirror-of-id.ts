// Backfill 1 LẦN cho migration 20260731000001_circuits_mirror_of.sql (xem
// architecture.md mục 32) — 59 luồng "mirror" tự sinh bởi
// scripts/sync-missing-trunk-circuits.ts (2026-07-28) đang nhận diện luồng
// gốc qua text cố định trong notes ("...luồng gốc id <uuid>."), chưa có gì
// ghi vào cột mirror_of_id mới (NULL hết vì cột vừa thêm). Script này parse
// lại đúng cụm text đó 1 LẦN DUY NHẤT để điền mirror_of_id — sau khi chạy
// xong, code app KHÔNG còn đọc notes để nhận diện mirror nữa (xem
// lib/mirrorTrunkCircuits.ts), chỉ còn script này cần biết định dạng notes
// cũ.
//
// DRY RUN mặc định, --commit để ghi thật (đúng quy ước chung mọi script khác
// trong dự án).
//
// Chạy: npm run backfill-mirror-of-id
//       npm run backfill-mirror-of-id -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const ORIGIN_ID_RE = /luồng gốc id ([0-9a-fA-F-]{36})/;

async function main() {
  const { getSupabaseAdmin } = await import("./lib/supabaseAdmin");
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.from("circuits").select("id, name, notes, mirror_of_id").ilike("notes", "%luồng gốc id%");
  if (error) throw error;

  const rows = (data ?? []) as { id: string; name: string; notes: string | null; mirror_of_id: string | null }[];
  console.log(`Tìm thấy ${rows.length} luồng mirror có "luồng gốc id" trong notes.`);

  let toUpdate = 0;
  let alreadySet = 0;
  let noMatch = 0;

  for (const row of rows) {
    const match = row.notes?.match(ORIGIN_ID_RE);
    const originId = match?.[1] ?? null;
    if (!originId) {
      noMatch++;
      console.log(`  [BỎ QUA] "${row.name}" (${row.id}) — không parse được id gốc từ notes.`);
      continue;
    }
    if (row.mirror_of_id === originId) {
      alreadySet++;
      continue;
    }
    toUpdate++;
    console.log(`  [${COMMIT ? "GHI" : "DRY RUN"}] "${row.name}" (${row.id}) -> mirror_of_id = ${originId}`);
    if (COMMIT) {
      const { error: updErr } = await supabase.from("circuits").update({ mirror_of_id: originId }).eq("id", row.id);
      if (updErr) throw updErr;
    }
  }

  console.log(`\nTổng: ${toUpdate} cần cập nhật, ${alreadySet} đã đúng sẵn, ${noMatch} không parse được.`);
  if (!COMMIT && toUpdate > 0) console.log("Chạy lại kèm --commit để ghi thật.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
