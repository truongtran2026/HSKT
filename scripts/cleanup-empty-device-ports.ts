// Dọn tạm các luồng thiết bị CHƯA có luồng hoạt động (tên tự sinh "(chưa đặt
// tên)...", xem lib/deviceNotes.ts isPlaceholderCircuitName) — theo yêu cầu
// người dùng 2026-07-25: coi như thiết bị CHƯA kéo cáp ra ODF ở các port đó,
// để giảm số vị trí ODF bị báo trùng do nhiều thiết bị cùng "giữ chỗ" 1 vị
// trí chưa thật sự dùng. CHỪA lại lĩnh vực "Truyền Dẫn" (không đụng tới) vì
// người dùng muốn giữ nguyên dữ liệu domain này.
//
// Xóa hẳn dòng circuits đó (không phải chỉ ẩn) — nếu sau này thiết bị đó có
// luồng hoạt động thật, sẽ tạo lại luồng mới bình thường qua UI.
//
// Chạy:
//   npm run cleanup-empty-device-ports              -> DRY RUN, chỉ đếm + in
//                                                       danh sách theo lĩnh vực.
//   npm run cleanup-empty-device-ports -- --commit   -> xóa thật.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { isPlaceholderCircuitName } from "../lib/deviceNotes";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const KEEP_CATEGORY = "Truyền Dẫn";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  interface Row {
    id: string;
    name: string;
    device_id: string | null;
    devices: { name: string; category: string | null } | null;
    port_circuit_links: { id: string }[] | null;
  }

  const all: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("circuits")
      .select("id, name, device_id, devices(name, category), port_circuit_links(id)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Row[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  const deviceDomain = all.filter((r) => !r.port_circuit_links || r.port_circuit_links.length === 0);
  const placeholders = deviceDomain.filter((r) => isPlaceholderCircuitName(r.name));
  const toDelete = placeholders.filter((r) => (r.devices?.category ?? null) !== KEEP_CATEGORY);
  const kept = placeholders.filter((r) => (r.devices?.category ?? null) === KEEP_CATEGORY);

  const byCategory = new Map<string, number>();
  for (const r of toDelete) {
    const cat = r.devices?.category ?? "(chưa phân loại)";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }

  console.log(`[cleanup-empty-device-ports] Chế độ: ${COMMIT ? "COMMIT (xóa thật)" : "DRY RUN"}`);
  console.log(`[cleanup-empty-device-ports] Tổng luồng thiết bị: ${deviceDomain.length}`);
  console.log(`[cleanup-empty-device-ports] Luồng chưa có tên thật (placeholder): ${placeholders.length}`);
  console.log(`[cleanup-empty-device-ports] Giữ lại (lĩnh vực "${KEEP_CATEGORY}"): ${kept.length}`);
  console.log(`[cleanup-empty-device-ports] Sẽ xóa: ${toDelete.length}`);
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${cat}: ${n}`);
  }

  if (!COMMIT) {
    console.log(`[cleanup-empty-device-ports] DRY RUN — chưa xóa gì. Chạy: npm run cleanup-empty-device-ports -- --commit`);
    return;
  }

  const ids = toDelete.map((r) => r.id);
  const chunkSize = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const { error } = await db.from("circuits").delete().in("id", batch);
    if (error) {
      console.error("[cleanup-empty-device-ports] Lỗi xóa batch:", error.message);
      continue;
    }
    deleted += batch.length;
  }
  console.log(`[cleanup-empty-device-ports] Đã xóa ${deleted}/${toDelete.length} luồng.`);
}

main().catch((err) => {
  console.error("[cleanup-empty-device-ports] Lỗi:", err);
  process.exit(1);
});
