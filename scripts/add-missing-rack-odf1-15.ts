// Tạo rack "ODF1/15" THẬT — phát hiện 2026-07-28 khi rà lỗi biên khớp rack
// (xem lib/trunkPorts.ts): 26 chỗ tham chiếu "ODF 1/15" trong dữ liệu (circuits
// + device_position_map) không khớp được rack nào, vì block 1 trong `racks`
// trước đó chỉ có tới "ODF1/14". Người dùng xác nhận: "ODF1/15" là rack thật
// (khác "ODF1/16" — KHÔNG tồn tại thật, dù cũng xuất hiện 5 lần trong dữ liệu
// dạng lỗi gõ/nhầm, KHÔNG tạo rack cho nó), dùng cho "ODF ra cáp của thiết bị".
//
// domain='device' (KHÔNG PHẢI 'trunk' dù cùng mang số block "1"): thử 'trunk'
// trước (nhân bản rack liền trước "ODF1/14", cũng odf_type='distribution')
// nhưng phát hiện SAI ngay khi kiểm thử thật — 2 lý do:
//   1. "ODF1/14" hóa ra là rack trung kế BÌNH THƯỜNG, có luồng thật gắn qua
//      `port_circuit_links` (Tx/Rx), KHÔNG hề được tham chiếu qua
//      device_position_own/next — khác hẳn "ODF1/15" (CHỈ tồn tại dưới dạng
//      text tự do trong device_position_own/next, giống hệt 112 rack "ODF/DDF
//      nội bộ" đã tạo ở scripts/import-internal-odf-racks.ts).
//   2. domain='trunk' khiến DeviceCircuitList.tsx tự khóa Ô2 "tiếp theo" vào
//      cable_route_name (chế độ Cáp quang) và bắt Ô3 phải là SỐ SỢI thật —
//      nhưng dữ liệu thật ghép kèm "ODF 1/15" lại là tên THIẾT BỊ (OME-TK#1,
//      OME-TK#2) + trib dạng "S10-2"/"S5-2" (không phải số sợi), nên bị báo
//      lỗi sai "Sợi 'S10-2' không tồn tại trong tuyến cáp 'ODF1/15'" và Ô2
//      hiện rỗng dù dữ liệu thật có tên thiết bị. domain='device' giữ Ô2/Ô3 ở
//      chế độ Thiết bị (free-text) đúng bản chất dữ liệu.
//
// Cấu hình: port_count=48 (khớp mọi rack khác), device_id=null (panel dùng
// chung nhiều thiết bị), cable_route_name=null + fiber_number=null cho mọi
// port (không có ý nghĩa ngoài domain='trunk', đúng quy ước 112 rack kia).
// Status port: 'unused' cho TẤT CẢ (dữ liệu text hiện có CHƯA nối thật qua
// port_circuit_links, chưa thể suy chính xác port nào đang dùng thật — cùng
// hạn chế đã ghi ở scripts/import-internal-odf-racks.ts).
//
// Chạy:
//   npm run add-missing-rack-odf1-15              -> DRY RUN, chỉ đếm + in.
//   npm run add-missing-rack-odf1-15 -- --commit   -> ghi thật.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");
const RACK_CODE = "ODF1/15";
const PORT_COUNT = 48;

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  console.log(`[add-missing-rack-odf1-15] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);

  const { data: existing, error: existingErr } = await db.from("racks").select("id").eq("code", RACK_CODE).maybeSingle();
  if (existingErr) throw existingErr;
  if (existing) {
    console.log(`[add-missing-rack-odf1-15] Rack "${RACK_CODE}" đã tồn tại (id=${existing.id}) — không tạo trùng.`);
    return;
  }

  const { data: sibling, error: siblingErr } = await db.from("racks").select("station_id").eq("code", "ODF1/14").single();
  if (siblingErr) throw siblingErr;

  console.log(`[add-missing-rack-odf1-15] Sẽ tạo rack "${RACK_CODE}": domain=device, odf_type=distribution, port_count=${PORT_COUNT}, cable_route_name=null.`);

  if (!COMMIT) {
    console.log(`[add-missing-rack-odf1-15] DRY RUN — chưa ghi gì. Chạy: npm run add-missing-rack-odf1-15 -- --commit`);
    return;
  }

  const { data: newRack, error: rackErr } = await db
    .from("racks")
    .insert({
      station_id: sibling.station_id,
      code: RACK_CODE,
      domain: "device",
      odf_type: "distribution",
      port_count: PORT_COUNT,
      cable_route_name: null,
    })
    .select("id")
    .single();
  if (rackErr) throw rackErr;

  const portRows = Array.from({ length: PORT_COUNT }, (_, i) => ({
    rack_id: newRack.id,
    port_number: i + 1,
    fiber_number: null,
    medium: "fiber" as const,
    status: "unused" as const,
  }));
  const { error: portErr } = await db.from("ports").insert(portRows);
  if (portErr) throw portErr;

  console.log(`[add-missing-rack-odf1-15] Đã tạo rack "${RACK_CODE}" (id=${newRack.id}) + ${PORT_COUNT} port.`);
}

main().catch((err) => {
  console.error("[add-missing-rack-odf1-15] Lỗi:", err);
  process.exit(1);
});
