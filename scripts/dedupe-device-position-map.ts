// Dọn dòng trùng lặp trong device_position_map — hậu quả của lỗi khóa so
// khớp tên thiết bị (xem lib/deviceNotes.ts normalizeDeviceNameKey, sửa
// 2026-07-26): trước khi sửa, "ADN1.3650#1 IPCC" (tên chuẩn trong bảng
// devices) và "3650#1 IPCC" (tên trong device_position_map) không được coi
// là cùng 1 thiết bị, nên mỗi lần lưu luồng lại tưởng thư viện "chưa có",
// âm thầm ghi thêm 1 dòng mới trùng — bảng phình tới ~2000 dòng.
//
// CHỈ gộp các dòng TRÙNG Y HỆT sau khi chuẩn hóa (device_name + device_position
// + odf_position đều khớp) — an toàn tuyệt đối, không đoán/merge dữ liệu
// khác nhau. Nhóm nào có device_position/odf_position giống nhau nhưng KHÁC
// giá trị pos còn lại (dữ liệu thật sự mâu thuẫn, không phải do lỗi tên) thì
// CHỪA LẠI, chỉ in ra để người dùng tự xem xét — không tự ý xóa/sửa.
//
// Khi gộp 1 nhóm trùng: giữ lại dòng đã dùng ĐÚNG tên chuẩn (khớp bảng
// devices, có tiền tố "ADN1.") nếu có; không có thì giữ dòng tạo sớm nhất.
// Không đổi tên dòng giữ lại — việc chuẩn hóa tên hiển thị là việc khác,
// ngoài phạm vi dọn trùng lặp này.
//
// Luôn xuất backup toàn bộ bảng ra file JSON trước khi xóa thật (--commit).
//
// Chạy:
//   npm run dedupe-device-position-map              -> DRY RUN, chỉ đếm + in.
//   npm run dedupe-device-position-map -- --commit   -> xóa thật (có backup trước).

import * as fs from "node:fs";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "../lib/deviceNotes";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

interface Row {
  id: string;
  device_name: string;
  device_position: string | null;
  odf_position: string | null;
  created_at: string;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  const all: Row[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("device_position_map")
      .select("id, device_name, device_position, odf_position, created_at")
      .order("device_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as Row[];
    all.push(...page);
    if (page.length < pageSize) break;
  }

  const { data: deviceRows, error: devErr } = await db.from("devices").select("name");
  if (devErr) throw devErr;
  const canonicalNames = new Set((deviceRows ?? []).map((d: { name: string }) => normalizeDeviceNameKey(d.name)));

  function fullKey(r: Row): string {
    return [
      normalizeDeviceNameKey(r.device_name),
      normalizeDevicePositionKey(r.device_position ?? ""),
      normalizeDevicePositionKey(r.odf_position ?? ""),
    ].join("|||");
  }
  // Khóa "cùng thiết bị + cùng vị trí thiết bị" nhưng KHÔNG tính odf_position
  // — dùng để phát hiện mâu thuẫn (cùng trib, khác odf) cho nhóm KHÔNG trùng
  // y hệt, chỉ để báo cáo, không xử lý tự động.
  function pairKey(r: Row): string {
    return [normalizeDeviceNameKey(r.device_name), normalizeDevicePositionKey(r.device_position ?? "")].join("|||");
  }

  const exactGroups = new Map<string, Row[]>();
  for (const r of all) {
    const k = fullKey(r);
    const list = exactGroups.get(k) ?? [];
    list.push(r);
    exactGroups.set(k, list);
  }

  const toDelete: Row[] = [];
  let groupsWithDupes = 0;
  for (const rows of exactGroups.values()) {
    if (rows.length < 2) continue;
    groupsWithDupes++;
    const canonical = rows.find((r) => canonicalNames.has(normalizeDeviceNameKey(r.device_name)) && r.device_name.trim().toLowerCase().startsWith("adn1."));
    const keep = canonical ?? [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    for (const r of rows) if (r.id !== keep.id) toDelete.push(r);
  }

  // Mâu thuẫn thật sự (không phải lỗi tên): cùng thiết bị+trib, có từ 2 giá
  // trị odf_position KHÁC NHAU trở lên (bỏ qua rỗng/null).
  const pairGroups = new Map<string, Row[]>();
  for (const r of all) {
    if (!r.device_position) continue; // cần có trib mới xét mâu thuẫn odf
    const list = pairGroups.get(pairKey(r)) ?? [];
    list.push(r);
    pairGroups.set(pairKey(r), list);
  }
  const conflicts: { key: string; odfValues: string[]; rows: Row[] }[] = [];
  for (const [k, rows] of pairGroups.entries()) {
    const odfSet = new Set(rows.map((r) => normalizeDevicePositionKey(r.odf_position ?? "")).filter((v) => v !== ""));
    if (odfSet.size > 1) conflicts.push({ key: k, odfValues: [...odfSet], rows });
  }

  console.log(`[dedupe-device-position-map] Chế độ: ${COMMIT ? "COMMIT (xóa thật)" : "DRY RUN"}`);
  console.log(`[dedupe-device-position-map] Tổng số dòng hiện có: ${all.length}`);
  console.log(`[dedupe-device-position-map] Số nhóm trùng y hệt (sẽ gộp): ${groupsWithDupes}`);
  console.log(`[dedupe-device-position-map] Số dòng sẽ xóa (giữ 1 dòng/nhóm): ${toDelete.length}`);
  console.log(`[dedupe-device-position-map] Còn lại sau khi dọn: ${all.length - toDelete.length}`);
  console.log(`[dedupe-device-position-map] Số cặp thiết bị+vị trí có MÂU THUẪN odf khác nhau (KHÔNG tự xử lý): ${conflicts.length}`);
  if (conflicts.length > 0) {
    console.log(`[dedupe-device-position-map] Danh sách mâu thuẫn cần bạn tự xem lại trong UI "Vị trí thiết bị":`);
    for (const c of conflicts.slice(0, 30)) {
      console.log(`  - ${c.rows[0].device_name} @ ${c.rows[0].device_position}: odf = ${c.odfValues.join(" | ")}`);
    }
    if (conflicts.length > 30) console.log(`  ... và ${conflicts.length - 30} cặp khác.`);
  }

  if (!COMMIT) {
    console.log(`[dedupe-device-position-map] DRY RUN — chưa xóa gì. Chạy: npm run dedupe-device-position-map -- --commit`);
    return;
  }

  const backupDir = path.join(__dirname, "..", "data", "_backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `device_position_map_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(all, null, 2), "utf8");
  console.log(`[dedupe-device-position-map] Đã backup toàn bộ ${all.length} dòng vào ${backupFile}`);

  const ids = toDelete.map((r) => r.id);
  const chunkSize = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const batch = ids.slice(i, i + chunkSize);
    const { error } = await db.from("device_position_map").delete().in("id", batch);
    if (error) {
      console.error("[dedupe-device-position-map] Lỗi xóa batch:", error.message);
      continue;
    }
    deleted += batch.length;
  }
  console.log(`[dedupe-device-position-map] Đã xóa ${deleted}/${toDelete.length} dòng trùng lặp.`);
}

main().catch((err) => {
  console.error("[dedupe-device-position-map] Lỗi:", err);
  process.exit(1);
});
