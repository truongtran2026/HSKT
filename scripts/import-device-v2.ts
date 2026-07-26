// Import lô dữ liệu ODF/DDF thiết bị MỚI (2026-07-25): 126 file .xlsx riêng
// từng thiết bị, xếp theo 6 thư mục lĩnh vực (IP/Server/Truyền Dẫn/Tổng
// Đài/VN2/Vô tuyến) trong data/ — thay thế cho file M3.TD-1_2 cũ (đã bị
// người dùng xóa khỏi data/). Format MỚI sạch hơn hẳn: đã tách sẵn "ODF
// port" (vị trí ODF/DDF CHÍNH thiết bị đấu ra) và "ODF chuyển tiếp" (vị trí
// kế tiếp) thành 2 cột riêng — khớp thẳng với devicePositionOwn/Next đã
// tách trong lib/deviceNotes.ts.
//
// Các quyết định đã hỏi & được người dùng xác nhận (2026-07-25):
//   1. THAY THẾ toàn bộ luồng domain=device cũ (không đụng ODF trung kế),
//      giữ lại bảng `devices` đã chuẩn hóa (khớp theo tên, không xóa).
//   2. Tự động tạo/gán `devices` + `circuits.device_id` ngay khi import
//      (mỗi file = đúng 1 thiết bị, suy tên từ tên file) — bỏ qua bước
//      chuẩn hóa tay cho lô này. Tên thiết bị tự tạo theo đúng quy ước
//      đang dùng "ADN1.<tên>" (xem devices.name mẫu thực tế đã có).
//   3. Seed luôn bảng `device_position_map` từ các dòng có đủ
//      (Tọa độ port thật + vị trí ODF thật), kể cả dòng chưa có tên luồng
//      (cáp đã đấu ra ODF nhưng chưa gán dịch vụ).
//
// Nhận diện "vị trí ODF thật" ở cột "ODF port"/"ODF chuyển tiếp": khi CHƯA
// đấu cáp, file gốc để nguyên số ID của dòng (kiểu number) thay vì text —
// đã xác nhận qua khảo sát: 601/601 dòng có ODF port kiểu number đều TRÙNG
// đúng ID dòng đó. Coi các dòng này là "chưa có vị trí thật".
//
// Chạy:
//   npm run import-device-v2                 -> DRY RUN: chỉ phân tích, in
//                                                 số liệu + ghi báo cáo,
//                                                 KHÔNG đụng Supabase.
//   npm run import-device-v2 -- --commit      -> ghi thật (xóa luồng device
//                                                 cũ rồi import luồng mới).
//
// LUÔN chạy dry-run trước, đọc kỹ import-device-v2-report.json.

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const DATA_DIR = path.join(__dirname, "..", "data");
const REPORT_FILE = path.join(__dirname, "..", "import-device-v2-report.json");
const COMMIT = process.argv.includes("--commit");

// "Cáp quang" chứa file ODF TRUNG KẾ cập nhật (20/07/2026) — KHÔNG thuộc lô
// import thiết bị này. Trunk chưa được import lại ở bước này (chờ yêu cầu
// riêng), nên loại hẳn thư mục này khỏi danh sách "lĩnh vực thiết bị" để
// tránh nhầm lẫn/đụng nhầm sau này dù hiện .xls trong đó không khớp đuôi
// .xlsx nên vốn đã bị bỏ qua.
const EXCLUDED_CATEGORY_DIRS = new Set(["Cáp quang"]);

// ---------------------------------------------------------------------------
// Tiện ích
// ---------------------------------------------------------------------------

function cellStr(v: unknown): string {
  // Cột "Giao tiếp"/"ODF port"/"ODF chuyển tiếp" khi TRỐNG được Excel gốc ghi
  // là số (thường trùng cột ID) thay vì text — coi mọi giá trị kiểu number
  // là "trống" cho các cột vốn phải là text, xử lý riêng ở nơi gọi khi cần
  // phân biệt "trống" với "0" hợp lệ.
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type Grid = unknown[][];

function readGrid(workbook: XLSX.WorkBook, sheetName: string): Grid {
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: true });
}

// ---------------------------------------------------------------------------
// Cấu trúc trung gian
// ---------------------------------------------------------------------------

interface ParsedRow {
  legacyId: string;
  portCoord: string; // "Tọa độ port" — trib_text
  name: string; // "Tên luồng" (có thể rỗng)
  interfaceType: string;
  odfOwn: string | null; // "ODF port" (vị trí CHÍNH), null nếu chưa đấu cáp thật
  odfNext: string | null; // "ODF chuyển tiếp"
  transferDevice: string; // "Thiết bị chuyển tiếp" (vd "Kết nối trực tiếp")
  terminalExtra: string; // "TBi đầu cuối"
  counterpartText: string; // "Đầu cuối"
  rawNotes: string; // "Ghi chú"
}

interface ParsedDeviceFile {
  relPath: string;
  category: string;
  deviceName: string;
  rows: ParsedRow[];
  skippedEmptyRows: number;
}

function isPlaceholderOdfCell(v: unknown, legacyId: string): { real: string | null } {
  if (typeof v === "number") return { real: null }; // trống thật (Excel ghi số thay vì text)
  const s = cellStr(v);
  return { real: s === "" ? null : s };
}

function parseDeviceFile(grid: Grid, relPath: string, category: string, deviceName: string): ParsedDeviceFile {
  const rows: ParsedRow[] = [];
  let skippedEmptyRows = 0;

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const legacyId = cellStr(row[0]);
    if (legacyId === "" && cellStr(row[1]) === "") continue; // dòng trống đệm cuối bảng

    const portCoord = cellStr(row[1]);
    const name = cellStr(row[2]);
    const giaoTiepCell = row[3];
    const interfaceType = typeof giaoTiepCell === "number" ? "" : cellStr(giaoTiepCell);
    const odfOwn = isPlaceholderOdfCell(row[4], legacyId).real;
    const odfNext = isPlaceholderOdfCell(row[5], legacyId).real;
    const transferDevice = cellStr(row[6]);
    const terminalExtra = cellStr(row[7]);
    const counterpartText = cellStr(row[8]);
    const rawNotes = cellStr(row[9]);

    const hasMeaning = [name, odfOwn ?? "", odfNext ?? "", transferDevice, terminalExtra, counterpartText, rawNotes].some(
      (v) => v !== ""
    );
    if (!hasMeaning) {
      skippedEmptyRows++;
      continue; // port hoàn toàn chưa dùng, chưa đấu cáp — không tạo circuit rỗng
    }

    rows.push({ legacyId, portCoord, name, interfaceType, odfOwn, odfNext, transferDevice, terminalExtra, counterpartText, rawNotes });
  }

  return { relPath, category, deviceName, rows, skippedEmptyRows };
}

function deriveDeviceNameFromFile(category: string, fileBaseName: string): string {
  const prefix = `${category}_`;
  return fileBaseName.startsWith(prefix) ? fileBaseName.slice(prefix.length) : fileBaseName;
}

function buildCircuitName(deviceName: string, portCoord: string, legacyId: string): string {
  return `(chưa đặt tên) ${deviceName} - ${portCoord || `dòng ${legacyId}`}`;
}

// "Tọa độ DDF/ODF" (own/next) giờ đi thẳng vào circuits.device_position_own/
// device_position_next (migration 20260726000001) — KHÔNG còn nhét vào notes
// nữa, notes chỉ còn các nhãn khác.
function buildNotes(deviceName: string, row: ParsedRow): string {
  const lines = [`Thiết bị: ${deviceName}`];
  if (row.transferDevice) lines.push(`Thiết bị chuyển tiếp: ${row.transferDevice}`);
  if (row.terminalExtra) lines.push(`TBi đầu cuối: ${row.terminalExtra}`);
  if (row.rawNotes) lines.push(row.rawNotes);
  lines.push(`ID gốc: ${row.legacyId}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Report {
  commit: boolean;
  files: number;
  totalDataRows: number;
  circuitsToCreate: number;
  skippedEmptyRows: number;
  positionMapSeedRows: number;
  distinctDeviceNames: number;
  byCategory: Record<string, { files: number; circuits: number }>;
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) throw new Error(`Không tìm thấy thư mục: ${DATA_DIR}`);

  const categories = fs
    .readdirSync(DATA_DIR)
    .filter((d) => fs.statSync(path.join(DATA_DIR, d)).isDirectory() && !EXCLUDED_CATEGORY_DIRS.has(d));

  const parsedFiles: ParsedDeviceFile[] = [];
  for (const category of categories) {
    const catDir = path.join(DATA_DIR, category);
    const files = fs.readdirSync(catDir).filter((f) => f.toLowerCase().endsWith(".xlsx"));
    for (const f of files) {
      const full = path.join(catDir, f);
      const wb = XLSX.readFile(full);
      const deviceName = deriveDeviceNameFromFile(category, f.replace(/\.xlsx$/i, ""));
      const parsed = parseDeviceFile(readGrid(wb, wb.SheetNames[0]), path.join(category, f), category, deviceName);
      parsedFiles.push(parsed);
    }
  }

  const byCategory: Report["byCategory"] = {};
  let totalDataRows = 0;
  let circuitsToCreate = 0;
  let skippedEmptyRows = 0;
  let positionMapSeedRows = 0;
  const deviceNames = new Set<string>();

  for (const f of parsedFiles) {
    deviceNames.add(f.deviceName);
    totalDataRows += f.rows.length + f.skippedEmptyRows;
    circuitsToCreate += f.rows.length;
    skippedEmptyRows += f.skippedEmptyRows;
    positionMapSeedRows += f.rows.filter((r) => r.odfOwn && r.portCoord).length;
    byCategory[f.category] ??= { files: 0, circuits: 0 };
    byCategory[f.category].files++;
    byCategory[f.category].circuits += f.rows.length;
  }

  const report: Report = {
    commit: COMMIT,
    files: parsedFiles.length,
    totalDataRows,
    circuitsToCreate,
    skippedEmptyRows,
    positionMapSeedRows,
    distinctDeviceNames: deviceNames.size,
    byCategory,
  };
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");

  console.log(`[import-device-v2] Chế độ: ${COMMIT ? "COMMIT (ghi vào Supabase)" : "DRY RUN (chỉ phân tích)"}`);
  console.log(
    `[import-device-v2] ${report.files} file, ${report.distinctDeviceNames} thiết bị, ${report.totalDataRows} dòng dữ liệu -> ${report.circuitsToCreate} luồng sẽ tạo (bỏ ${report.skippedEmptyRows} dòng port hoàn toàn chưa dùng), ${report.positionMapSeedRows} dòng seed vào device_position_map.`
  );
  console.log(`[import-device-v2] Đã ghi báo cáo: ${REPORT_FILE}`);

  if (!COMMIT) {
    console.log(`[import-device-v2] DRY RUN — chưa ghi gì. Đọc kỹ report rồi chạy: npm run import-device-v2 -- --commit`);
    return;
  }

  await commitToSupabase(parsedFiles);
}

async function commitToSupabase(parsedFiles: ParsedDeviceFile[]) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  }
  const db = createClient(supabaseUrl, serviceRoleKey);

  const { data: station, error: stationErr } = await db.from("stations").select("id").eq("code", "ADN1").maybeSingle();
  if (stationErr) throw stationErr;
  if (!station) throw new Error("Không tìm thấy trạm ADN1 — chạy import-legacy trước.");
  const stationId = station.id as string;

  // 1. Xóa toàn bộ luồng domain=device CŨ — nhận diện đúng như
  // lib/deviceCircuits.ts đang dùng: circuit KHÔNG có port_circuit_links nào
  // (ODF trung kế luôn có ít nhất 1 link, không đụng tới).
  console.log("[commit] Đang tìm luồng thiết bị cũ cần xóa...");
  const oldDeviceCircuitIds: string[] = [];
  {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("circuits")
        .select("id, port_circuit_links(id)")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as { id: string; port_circuit_links: { id: string }[] | null }[];
      for (const r of page) {
        if (!r.port_circuit_links || r.port_circuit_links.length === 0) oldDeviceCircuitIds.push(r.id);
      }
      if (page.length < pageSize) break;
    }
  }
  console.log(`[commit] Tìm thấy ${oldDeviceCircuitIds.length} luồng thiết bị cũ — đang xóa...`);
  for (const batch of chunk(oldDeviceCircuitIds, 200)) {
    const { error } = await db.from("circuits").delete().in("id", batch);
    if (error) throw error;
  }
  console.log(`[commit] Đã xóa ${oldDeviceCircuitIds.length} luồng thiết bị cũ.`);

  // 2. Nạp danh sách devices hiện có để khớp theo tên (giữ nguyên, không xóa).
  const existingDevices = new Map<string, string>(); // normalized name -> id
  {
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from("devices").select("id, name").range(from, from + pageSize - 1);
      if (error) throw error;
      const page = (data ?? []) as { id: string; name: string }[];
      for (const d of page) existingDevices.set(d.name.trim().toLowerCase(), d.id);
      if (page.length < pageSize) break;
    }
  }

  const deviceIdByName = new Map<string, string>(); // deviceName (gốc, chưa thêm ADN1.) -> id
  let totalCircuits = 0;
  let totalPositionMapRows = 0;
  const positionMapBatch: { device_name: string; device_position: string; odf_position: string }[] = [];

  for (const file of parsedFiles) {
    let deviceId = deviceIdByName.get(file.deviceName);
    if (!deviceId) {
      const fullName = `ADN1.${file.deviceName}`;
      const existing = existingDevices.get(fullName.trim().toLowerCase());
      if (existing) {
        deviceId = existing;
      } else {
        const { data, error } = await db
          .from("devices")
          .insert({ station_id: stationId, name: fullName, source: "auto", category: file.category })
          .select("id")
          .single();
        if (error) {
          console.error(`[commit] Lỗi tạo device "${fullName}":`, error.message);
          continue;
        }
        deviceId = data.id as string;
      }
      deviceIdByName.set(file.deviceName, deviceId);
    }

    const insertRows = file.rows.map((row) => ({
      name: row.name || buildCircuitName(file.deviceName, row.portCoord, row.legacyId),
      interface_type: row.interfaceType || null,
      circuit_role: "active" as const,
      counterpart_text: row.counterpartText || null,
      trib_text: row.portCoord || null,
      device_position_own: row.odfOwn || null,
      device_position_next: row.odfNext || null,
      notes: buildNotes(file.deviceName, row),
      device_id: deviceId,
    }));
    for (const batch of chunk(insertRows, 500)) {
      const { error } = await db.from("circuits").insert(batch);
      if (error) console.error(`[commit] Lỗi tạo circuits thiết bị "${file.deviceName}":`, error.message);
      else totalCircuits += batch.length;
    }

    for (const row of file.rows) {
      if (row.odfOwn && row.portCoord) {
        positionMapBatch.push({ device_name: file.deviceName, device_position: row.portCoord, odf_position: row.odfOwn });
      }
    }
  }

  for (const batch of chunk(positionMapBatch, 500)) {
    const { error } = await db.from("device_position_map").insert(batch);
    if (error) console.error(`[commit] Lỗi seed device_position_map:`, error.message);
    else totalPositionMapRows += batch.length;
  }

  await db.from("import_batches").insert({
    file_name: "data/ (126 file thiết bị theo lĩnh vực, 2026-07-25)",
    row_count: totalCircuits,
    status: "success",
    error_log: { files: parsedFiles.length, deletedOldDeviceCircuits: oldDeviceCircuitIds.length, positionMapRows: totalPositionMapRows },
  });

  console.log(
    `[commit] Xong. Xóa ${oldDeviceCircuitIds.length} luồng cũ, tạo ${totalCircuits} luồng mới, seed ${totalPositionMapRows} dòng device_position_map, ${deviceIdByName.size} thiết bị (mới+tái dùng).`
  );
}

main().catch((err) => {
  console.error("[import-device-v2] Lỗi:", err);
  process.exit(1);
});
