// Sửa nhãn giao tiếp "100G" (thiếu chữ E) thành "100GE" cho đúng chuẩn đã
// dùng — yêu cầu người dùng 2026-07-28. Khảo sát thật: "100GE" đã là giá trị
// ĐÚNG dùng phổ biến sẵn (vd trong placeholder input "Giao tiếp" và comment
// cột circuits.interface_type ở supabase/migrations), "100G" chỉ là 1 cách
// gõ tắt/thiếu sót còn sót lại từ khi import dữ liệu gốc — không phải 1 giá
// trị hợp lệ khác.
//
// Sửa ở 2 chỗ:
//   - circuits.interface_type = '100G' (khớp chính xác)  -> '100GE'
//   - circuits.name chứa cụm "100G" (không phải "100GE",
//     vd "100G AĐN1.P2 (...) - ...") -> thay "100G" thành "100GE" (regex
//     /100G(?!E)/gi — bỏ qua các cụm ĐÃ đúng "100GE" sẵn, không sửa đè)
//
// Chạy:
//   npm run fix-100g-label              -> DRY RUN, chỉ đếm + in.
//   npm run fix-100g-label -- --commit   -> ghi thật.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const BAD_100G = /100G(?!E)/gi;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  async function fetchAllPaginated<T>(select: string): Promise<T[]> {
    const pageSize = 1000;
    const all: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("circuits").select(select).range(from, from + pageSize - 1).order("id");
      if (error) throw error;
      const page = (data ?? []) as T[];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  const rows = await fetchAllPaginated<{ id: string; name: string; interface_type: string | null }>("id, name, interface_type");

  // Lưu ý: KHÔNG dùng regex.test() lặp lại trên cùng 1 regex có cờ "g" (lastIndex
  // dồn trạng thái giữa các lần gọi, gây bỏ sót/sai kết quả ở dòng sau) — chỉ
  // dùng .replace() rồi so sánh trước/sau, an toàn khi gọi lặp lại nhiều lần.
  const updates: { id: string; name?: string; interfaceType?: string; beforeName?: string; beforeInterface?: string }[] = [];
  for (const r of rows) {
    const update: (typeof updates)[number] = { id: r.id };
    if (r.interface_type) {
      const replaced = r.interface_type.replace(BAD_100G, "100GE");
      if (replaced !== r.interface_type) {
        update.interfaceType = replaced;
        update.beforeInterface = r.interface_type;
      }
    }
    const nameReplaced = r.name.replace(BAD_100G, "100GE");
    if (nameReplaced !== r.name) {
      update.name = nameReplaced;
      update.beforeName = r.name;
    }
    if (update.name || update.interfaceType) updates.push(update);
  }

  console.log(`[fix-100g-label] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log(`[fix-100g-label] Tổng circuits: ${rows.length}`);
  console.log(`[fix-100g-label] Cần sửa: ${updates.length}`);
  for (const u of updates.slice(0, 20)) {
    if (u.interfaceType) console.log(`  - Giao tiếp: "${u.beforeInterface}" -> "${u.interfaceType}"`);
    if (u.name) console.log(`  - Tên luồng: "${u.beforeName}" -> "${u.name}"`);
  }
  if (updates.length > 20) console.log(`  ... còn ${updates.length - 20} dòng nữa.`);

  if (!COMMIT) {
    console.log(`\n[fix-100g-label] DRY RUN — chưa ghi gì. Chạy: npm run fix-100g-label -- --commit`);
    return;
  }

  for (const u of updates) {
    const payload: Record<string, string> = {};
    if (u.name) payload.name = u.name;
    if (u.interfaceType) payload.interface_type = u.interfaceType;
    const { error } = await db.from("circuits").update(payload).eq("id", u.id);
    if (error) throw error;
  }
  console.log(`\n[fix-100g-label] Đã sửa ${updates.length} circuits.`);
}

main().catch((err) => {
  console.error("[fix-100g-label] Lỗi:", err);
  process.exit(1);
});
