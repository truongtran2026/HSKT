// Backfill 1 lần: gán devices.category cho đúng 126 thiết bị vừa tạo ở lô
// import scripts/import-device-v2.ts (2026-07-25) — script đó chạy TRƯỚC khi
// cột devices.category tồn tại nên chưa có category. Suy category lại từ
// đúng cấu trúc thư mục data/ (còn nguyên trên máy) bằng cùng 1 rule đặt tên
// thiết bị (deriveDeviceNameFromFile) như import-device-v2.ts.
//
// Chạy 1 lần sau khi đã áp dụng migration 20260725000001_device_category.sql:
//   npm run backfill-device-category
//
// Không có DRY RUN riêng — script chỉ UPDATE theo tên khớp chính xác, không
// xóa/tạo gì, an toàn chạy lại nhiều lần (idempotent).

import * as fs from "node:fs";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const DATA_DIR = path.join(__dirname, "..", "data");
const EXCLUDED_CATEGORY_DIRS = new Set(["Cáp quang"]);

function deriveDeviceNameFromFile(category: string, fileBaseName: string): string {
  const prefix = `${category}_`;
  return fileBaseName.startsWith(prefix) ? fileBaseName.slice(prefix.length) : fileBaseName;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  }
  const db = createClient(supabaseUrl, serviceRoleKey);

  const categories = fs
    .readdirSync(DATA_DIR)
    .filter((d) => fs.statSync(path.join(DATA_DIR, d)).isDirectory() && !EXCLUDED_CATEGORY_DIRS.has(d));

  const nameToCategory = new Map<string, string>();
  for (const category of categories) {
    const files = fs.readdirSync(path.join(DATA_DIR, category)).filter((f) => f.toLowerCase().endsWith(".xlsx"));
    for (const f of files) {
      const deviceName = deriveDeviceNameFromFile(category, f.replace(/\.xlsx$/i, ""));
      nameToCategory.set(`ADN1.${deviceName}`, category);
    }
  }
  console.log(`[backfill-device-category] Suy được ${nameToCategory.size} thiết bị -> lĩnh vực từ data/.`);

  let updated = 0;
  let notFound = 0;
  for (const [name, category] of nameToCategory) {
    const { data, error } = await db.from("devices").update({ category }).eq("name", name).select("id");
    if (error) {
      console.error(`[backfill-device-category] Lỗi cập nhật "${name}":`, error.message);
      continue;
    }
    if (!data || data.length === 0) {
      notFound++;
      console.warn(`[backfill-device-category] Không tìm thấy devices.name = "${name}" — bỏ qua.`);
      continue;
    }
    updated++;
  }

  console.log(`[backfill-device-category] Xong. Đã cập nhật ${updated} thiết bị, không tìm thấy ${notFound}.`);
}

main().catch((err) => {
  console.error("[backfill-device-category] Lỗi:", err);
  process.exit(1);
});
