// Rà lại các dòng transit_links CŨ (cột "Chuyển tiếp" bên ODF trung kế) đã
// khớp "cấu trúc 2" (yêu cầu người dùng 2026-07-27): "<tọa độ ODF> -
// <thiết bị>(<port>)", vd "ODF7/4/17,18 - ADN1.PE2 (et-13/0/0)". Từ nay về
// sau, việc chuẩn hóa này tự chạy khi Sửa/Lưu 1 port trong PortTable.tsx —
// script này chỉ xử lý ~297 dòng đã có SẴN TỪ TRƯỚC khi tính năng ra đời.
//
// Với mỗi dòng khớp cấu trúc 2 + thuộc trạm ADN1 (isManagedStationCode):
//   - Thiết bị đã có trong `devices` (so khớp theo normalizeDeviceNameKey) ->
//     gọi growDevicePositionMapByTrib để làm giàu thư viện "Vị trí thiết bị"
//     theo device+trib đã biết chắc (giữ nguyên, không đè, nếu đã có).
//   - Thiết bị CHƯA có trong `devices` -> theo đúng xác nhận của người dùng,
//     KHÔNG tự tạo — chỉ gom vào danh sách in ra cuối script để tự duyệt tay
//     (giống khung "Chuẩn hóa tên thiết bị chưa khớp" ở tab Vị trí thiết bị).
//   - Không phải ADN1 (trạm khác như 2T9, hoặc tên không theo dạng
//     STATION.DEVICE) -> bỏ qua hoàn toàn, không đụng gì.
//
// Script CHỈ ghi vào device_position_map (qua growDevicePositionMapByTrib) —
// KHÔNG bao giờ sửa/ghi lại transit_links.raw_text (giữ đúng dữ liệu gốc).
//
// Chạy:
//   npm run standardize-transit-links              -> DRY RUN, chỉ đếm + in.
//   npm run standardize-transit-links -- --commit   -> ghi thật vào device_position_map.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "../lib/deviceNotes";
import { splitOdfDeviceStructure, parseTransitText, isManagedStationCode } from "../lib/parsers/transit-text";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

interface TransitRow {
  id: string;
  raw_text: string | null;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  // Bản sao cục bộ của growDevicePositionMapByTrib (lib/devicePositionMap.ts) —
  // KHÔNG import trực tiếp từ đó vì file gốc dùng chung `supabase`
  // (lib/supabase.ts, anon key, đọc process.env ngay lúc import module) trong
  // khi script này cần client riêng bằng SERVICE ROLE KEY nạp qua dotenv sau
  // khi import xong. Định nghĩa trong main() (closure qua `db`) để tránh lệch
  // kiểu generic của SupabaseClient khi truyền qua tham số riêng. Tham số
  // `dryRun` giúp DRY RUN in đúng số liệu sẽ xảy ra mà không ghi thật.
  async function growDevicePositionMapByTribLocal(
    deviceName: string,
    devicePosition: string,
    odfPosition: string,
    dryRun: boolean
  ): Promise<{ grown: boolean }> {
    const nameKey = normalizeDeviceNameKey(deviceName);
    const tribKey = normalizeDevicePositionKey(devicePosition);
    if (!nameKey || !tribKey || !odfPosition.trim()) return { grown: false };

    const pageSize = 1000;
    let exists = false;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("device_position_map")
        .select("device_name, device_position")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as { device_name: string; device_position: string | null }[];
      if (
        page.some(
          (r) => normalizeDeviceNameKey(r.device_name) === nameKey && normalizeDevicePositionKey(r.device_position ?? "") === tribKey
        )
      ) {
        exists = true;
      }
      if (page.length < pageSize) break;
    }
    if (exists) return { grown: false };
    if (dryRun) return { grown: true };

    const { error: insErr } = await db
      .from("device_position_map")
      .insert({ device_name: deviceName, device_position: devicePosition, odf_position: odfPosition.trim() });
    if (insErr) throw insErr;
    return { grown: true };
  }

  const { data: transitRows, error: transitErr } = await db.from("transit_links").select("id, raw_text");
  if (transitErr) throw transitErr;
  const all = (transitRows ?? []) as TransitRow[];

  const { data: deviceRows, error: devErr } = await db.from("devices").select("name");
  if (devErr) throw devErr;
  const deviceNames = (deviceRows ?? []) as { name: string }[];
  const canonicalByKey = new Map<string, string>();
  for (const d of deviceNames) canonicalByKey.set(normalizeDeviceNameKey(d.name), d.name);

  let structureMatched = 0;
  let notManagedStation = 0;
  const grownEntries: { device: string; trib: string; odf: string }[] = [];
  const alreadyInLibrary: { device: string; trib: string; odf: string }[] = [];
  const unknownDevices = new Map<string, { trib: string; odf: string; count: number }>();

  for (const row of all) {
    if (!row.raw_text) continue;
    const split = splitOdfDeviceStructure(row.raw_text);
    if (!split.matched || !split.odfPart || !split.devicePortText) continue;
    structureMatched++;

    const parsed = parseTransitText(split.devicePortText);
    if (!parsed.matched || !parsed.stationCode || !parsed.deviceName || !parsed.coordinateText) continue;
    if (!isManagedStationCode(parsed.stationCode)) {
      notManagedStation++;
      continue;
    }

    const deviceName = parsed.deviceName.trim();
    const port = parsed.coordinateText.trim();
    const odf = split.odfPart.trim();
    if (!deviceName || !port) continue;

    const key = normalizeDeviceNameKey(deviceName);
    const canonicalName = canonicalByKey.get(key);
    if (!canonicalName) {
      const uKey = key || deviceName;
      const existing = unknownDevices.get(uKey);
      if (existing) existing.count++;
      else unknownDevices.set(uKey, { trib: port, odf, count: 1 });
      continue;
    }

    // DRY RUN (dryRun=true) vẫn chạy đúng bước kiểm tồn tại như COMMIT, chỉ
    // bỏ qua bước ghi — nhờ vậy số liệu in ra khớp chính xác với khi chạy
    // --commit thật.
    const { grown } = await growDevicePositionMapByTribLocal(canonicalName, port, odf, !COMMIT);
    if (grown) grownEntries.push({ device: canonicalName, trib: port, odf });
    else alreadyInLibrary.push({ device: canonicalName, trib: port, odf });
  }

  console.log(`[standardize-transit-links] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log(`[standardize-transit-links] Tổng số dòng transit_links: ${all.length}`);
  console.log(`[standardize-transit-links] Khớp "cấu trúc 2": ${structureMatched}`);
  console.log(`[standardize-transit-links] Không thuộc trạm ADN1 (bỏ qua): ${notManagedStation}`);
  console.log(`[standardize-transit-links] Thiết bị đã khớp devices — sẽ/đã thêm mới vào thư viện: ${grownEntries.length}`);
  console.log(`[standardize-transit-links] Thiết bị đã khớp devices — thư viện đã có sẵn (giữ nguyên): ${alreadyInLibrary.length}`);
  console.log(`[standardize-transit-links] Thiết bị CHƯA có trong devices (không tự tạo, cần bạn tự duyệt): ${unknownDevices.size}`);
  if (unknownDevices.size > 0) {
    console.log(`[standardize-transit-links] Danh sách thiết bị mới cần duyệt tay (tên nhận diện được, trib, số dòng transit_links liên quan):`);
    for (const [nameKey, info] of [...unknownDevices.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  - "${nameKey}" @ ${info.trib} (odf: ${info.odf}) — ${info.count} dòng`);
    }
  }

  if (!COMMIT) {
    console.log(`[standardize-transit-links] DRY RUN — chưa ghi gì. Chạy: npm run standardize-transit-links -- --commit`);
  } else {
    console.log(`[standardize-transit-links] Đã ghi xong ${grownEntries.length} dòng mới vào device_position_map.`);
  }
}

main().catch((err) => {
  console.error("[standardize-transit-links] Lỗi:", err);
  process.exit(1);
});
