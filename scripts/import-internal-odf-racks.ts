// Tạo rack/port THẬT cho ODF/DDF nội bộ tại ADN1 (đấu chéo thiết bị-thiết bị,
// domain='device') — yêu cầu người dùng 2026-07-27: phát hiện qua việc test
// "Vị trí ODF (tiếp theo)" không tự chuẩn hóa với "ODF 11/5"/"ODF3/6" vì
// racks bảng chỉ có 41 rack trung kế (block 1,2,6), chưa hề có rack nào cho
// ODF/DDF nội bộ dù dữ liệu circuits đã tham chiếu rất nhiều tới chúng.
//
// Cách xác định vị trí cần tạo: quét TOÀN BỘ circuits.device_position_own,
// circuits.device_position_next, device_position_map.odf_position tìm mọi
// "ODF x/y" mà x KHÔNG thuộc block trung kế đã có — đây chính là các ODF/DDF
// nội bộ đang được dùng nhưng chưa có rack thật (đã khảo sát thực tế
// 2026-07-27: 112 vị trí thuộc 7 block: 3,4,5,7,8,9,11). Quét SỐNG từ DB thay
// vì liệt kê tay để tự động khớp lại nếu dữ liệu circuits đổi trước lúc chạy
// --commit.
//
// Mỗi vị trí -> 1 rack domain='device', odf_type='distribution' (panel đấu
// chéo linh hoạt, không phải hàn nối cố định ra tuyến cáp), cable_route_name
// = null (không có ý nghĩa ngoài domain=trunk), device_id = null (panel DÙNG
// CHUNG cho nhiều thiết bị khác nhau đấu tới, không thuộc riêng 1 thiết bị) —
// 48 port mỗi rack (yêu cầu người dùng: theo đúng số port lớn nhất từng thấy
// trong dữ liệu, khớp chuẩn 48 port đã dùng bên trung kế). fiber_number để
// NULL (chỉ có ý nghĩa với domain=trunk theo đúng comment cột trong schema).
//
// Idempotent: rack code đã tồn tại (domain='device') thì BỎ QUA, không tạo
// trùng — chạy lại nhiều lần an toàn nếu lần trước bị ngắt giữa chừng.
//
// Chạy:
//   npm run import-internal-odf-racks              -> DRY RUN, chỉ đếm + in.
//   npm run import-internal-odf-racks -- --commit   -> ghi thật.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const PORTS_PER_RACK = 48;

// Block trung kế THẬT đã có sẵn (domain='trunk') — mọi "ODF x/y" khác được
// coi là ODF/DDF nội bộ.
const KNOWN_TRUNK_BLOCKS = new Set(["1", "2", "6"]);
const ODF_RACK_PATTERN = /ODF\s*(\d+)\s*\/\s*(\d+(?:\.\d+)?)/gi;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  // Định nghĩa trong main() (closure qua db) để tránh lệch kiểu generic của
  // SupabaseClient khi truyền qua tham số riêng — cùng lý do đã áp dụng ở
  // scripts/standardize-transit-links.ts.
  async function fetchAllPaginated<T>(table: string, select: string): Promise<T[]> {
    const pageSize = 1000;
    const all: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from(table).select(select).range(from, from + pageSize - 1).order("id");
      if (error) throw error;
      const page = (data ?? []) as T[];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  const circuits = await fetchAllPaginated<{ device_position_own: string | null; device_position_next: string | null }>(
    "circuits",
    "device_position_own, device_position_next"
  );
  const dpmRows = await fetchAllPaginated<{ odf_position: string | null }>("device_position_map", "odf_position");

  const positions = new Set<string>();
  function scan(text: string | null) {
    if (!text) return;
    let m;
    ODF_RACK_PATTERN.lastIndex = 0;
    while ((m = ODF_RACK_PATTERN.exec(text))) {
      if (KNOWN_TRUNK_BLOCKS.has(m[1])) continue;
      positions.add(`${m[1]}/${m[2]}`);
    }
  }
  for (const c of circuits) {
    scan(c.device_position_own);
    scan(c.device_position_next);
  }
  for (const r of dpmRows) scan(r.odf_position);

  const sorted = [...positions].sort((a, b) => {
    const [ab, ap] = a.split("/").map(Number);
    const [bb, bp] = b.split("/").map(Number);
    return ab - bb || ap - bp;
  });

  const { data: station, error: stationErr } = await db.from("stations").select("id").eq("code", "ADN1").single();
  if (stationErr) throw stationErr;
  const stationId = station.id as string;

  const { data: existingRacksRaw, error: existingErr } = await db.from("racks").select("code").eq("domain", "device");
  if (existingErr) throw existingErr;
  const existingCodes = new Set((existingRacksRaw ?? []).map((r) => (r as { code: string }).code));

  const toCreate = sorted
    .map((pos) => `ODF ${pos}`)
    .filter((code) => !existingCodes.has(code));
  const alreadyExist = sorted.map((pos) => `ODF ${pos}`).filter((code) => existingCodes.has(code));

  console.log(`[import-internal-odf-racks] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log(`[import-internal-odf-racks] Tổng vị trí ODF/DDF nội bộ quét được: ${sorted.length}`);
  console.log(`[import-internal-odf-racks] Đã có rack sẵn (bỏ qua): ${alreadyExist.length}`);
  console.log(`[import-internal-odf-racks] Cần tạo mới: ${toCreate.length} rack x ${PORTS_PER_RACK} port = ${toCreate.length * PORTS_PER_RACK} port`);
  console.log(`[import-internal-odf-racks] Danh sách rack sẽ tạo:\n  ${toCreate.join(", ")}`);

  if (toCreate.length === 0) {
    console.log(`[import-internal-odf-racks] Không có gì để tạo.`);
    return;
  }

  if (!COMMIT) {
    console.log(`[import-internal-odf-racks] DRY RUN — chưa ghi gì. Chạy: npm run import-internal-odf-racks -- --commit`);
    return;
  }

  const rackRows = toCreate.map((code) => ({
    station_id: stationId,
    code,
    domain: "device" as const,
    odf_type: "distribution" as const,
    port_count: PORTS_PER_RACK,
    cable_route_name: null,
  }));

  // Chèn theo lô 50 rack/lần (đủ nhỏ để tránh payload quá lớn, đủ lớn để
  // không mất quá nhiều round-trip cho 112 rack).
  const rackChunkSize = 50;
  const createdRacks: { id: string; code: string }[] = [];
  for (let i = 0; i < rackRows.length; i += rackChunkSize) {
    const batch = rackRows.slice(i, i + rackChunkSize);
    const { data, error } = await db.from("racks").insert(batch).select("id, code");
    if (error) throw error;
    createdRacks.push(...(data as { id: string; code: string }[]));
  }
  console.log(`[import-internal-odf-racks] Đã tạo ${createdRacks.length} rack.`);

  const portRows = createdRacks.flatMap((r) =>
    Array.from({ length: PORTS_PER_RACK }, (_, i) => ({
      rack_id: r.id,
      port_number: i + 1,
      fiber_number: null,
      medium: "fiber" as const,
      status: "unused" as const,
    }))
  );
  const portChunkSize = 1000;
  let insertedPorts = 0;
  for (let i = 0; i < portRows.length; i += portChunkSize) {
    const batch = portRows.slice(i, i + portChunkSize);
    const { error } = await db.from("ports").insert(batch);
    if (error) throw error;
    insertedPorts += batch.length;
  }
  console.log(`[import-internal-odf-racks] Đã tạo ${insertedPorts} port.`);
  console.log(`[import-internal-odf-racks] Xong.`);
}

main().catch((err) => {
  console.error("[import-internal-odf-racks] Lỗi:", err);
  process.exit(1);
});
