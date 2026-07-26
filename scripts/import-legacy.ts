// Import 2 file .xls gốc (ODF trung kế + ODF/DDF thiết bị) vào Supabase.
//
// Chạy:
//   npm run import-legacy                 -> DRY RUN: chỉ phân tích 2 file,
//                                             in số liệu + ghi import-report.json,
//                                             KHÔNG đụng vào Supabase.
//   npm run import-legacy -- --commit     -> ghi thật vào Supabase.
//
// LUÔN chạy dry-run trước, đọc kỹ "warnings" trong import-report.json, rồi
// mới chạy --commit — vì đây là import 1 lần vào dữ liệu thật, sai sẽ khó
// dọn lại. Xem architecture.md mục 7 để biết đầy đủ các quyết định xử lý dữ
// liệu thật (đã hỏi & được người dùng xác nhận ngày 2026-07-20):
//   - ODF trung kế: mỗi sheet = 1 rack; rack.code suy từ tiêu đề section;
//     odf_type welded/distribution suy theo quy tắc số rack do người dùng
//     cho; cột "Chuyển tiếp" CHỈ lưu raw text (text_only), không tự đoán
//     devices; 2 port liền kề gộp thành 1 luồng khi port sau trống hoặc
//     trùng tên; port trùng số giữ lần xuất hiện sau, có cảnh báo.
//   - ODF/DDF thiết bị: định dạng cột khác hẳn, có thêm Trib (cột riêng
//     circuits.trib_text) + Agg/tọa độ DDF/ODF/truyền dẫn (gộp vào notes).
//     CHỈ tạo circuits ở lần import này, KHÔNG tạo racks/ports/transit_links
//     (định dạng tọa độ quá đa dạng giữa các loại thiết bị, để chuẩn hóa ở
//     giai đoạn 7 cùng lúc xây UI ODF/DDF thiết bị).

import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { OdfType, LinkRole } from "../lib/database.types";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const TRUNK_FILE = path.join(__dirname, "..", "data", "M3.CQ-3_HS_ODF_TRUNG_KE_TAI_TRAM_VT_ADN1.xls");
const DEVICE_FILE = path.join(__dirname, "..", "data", "M3.TD-1_2_HS_DAU_NOI_TAI_TRAM_VT_ADN1.xls");
const REPORT_FILE = path.join(__dirname, "..", "import-report.json");
const COMMIT = process.argv.includes("--commit");

// ---------------------------------------------------------------------------
// Tiện ích chung
// ---------------------------------------------------------------------------

/** Chuẩn hóa header/tên tiếng Việt (bỏ dấu, hạ chữ thường, bỏ khoảng trắng)
 * để so khớp mờ — file gốc có nhiều biến thể lỗi chính tả (Đối/Dối phương,
 * Mức Độ/Dộ ưu tiên, Sợi/Sơị...). */
function normalizeHeader(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[đĐ]/g, "d")
    .replace(/[ưƯ]/g, "u")
    .replace(/[ơƠ]/g, "o")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cellStr(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function cellNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellStr(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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

function cell(grid: Grid, r: number, c: number | null): unknown {
  if (c === null) return "";
  return grid[r]?.[c] ?? "";
}

/** Ghép thêm thông tin của port thứ 2 (rx) vào 1 field của circuit, chỉ khi
 * khác với dữ liệu port đầu (tx) — tránh mất dữ liệu khi 2 sợi 1 cặp có
 * Đối phương/Ghi chú lệch nhau (đã thấy trong dữ liệu thật). */
function mergeField(a: string, b: string, otherPortNumber: number): string {
  if (!b || b === a) return a;
  return a ? `${a}\n(port ${otherPortNumber}): ${b}` : b;
}

// ---------------------------------------------------------------------------
// Cấu trúc dữ liệu trung gian (trước khi ghi DB)
// ---------------------------------------------------------------------------

interface PortRow {
  portNumber: number;
  fiberNumber: number | null;
  circuitName: string;
  interfaceType: string;
  transitText: string;
  counterpartText: string;
  responsePlanText: string;
  executionStationText: string;
  notes: string;
}

interface CircuitGroup {
  data: PortRow;
  portLinks: { portNumber: number; role: LinkRole }[];
}

interface ParsedRack {
  sheetName: string;
  code: string;
  cableRouteName: string;
  odfType: OdfType;
  ports: Map<number, PortRow>;
  groups: CircuitGroup[];
  warnings: string[];
}

interface DeviceCircuit {
  name: string;
  interfaceType: string;
  tribText: string;
  counterpartText: string;
  notes: string;
}

interface ParsedDeviceSheet {
  sheetName: string;
  deviceName: string;
  circuits: DeviceCircuit[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Parser: file ODF TRUNG KẾ (M3.CQ-3)
// ---------------------------------------------------------------------------

const TRUNK_TITLE_RE = /^\s*\d+\.\s*ML\b/i;
// "<a>-<b>" hoặc "<a>-<b>.<c>" ngay sau dấu ':' và ngay trước dấu '(' hoặc cuối chuỗi.
const RACK_CODE_RE = /:\s*(\d+)\s*-\s*(\d+(?:\.\d+)?)\s*(?:\(|$)/;
const RACK_CODE_LOOSE_RE = /(\d+)\s*-\s*(\d+(?:\.\d+)?)/;

function deriveRackCode(
  titleText: string,
  fallbackCell: string,
  sheetName: string,
  warnings: string[]
): { code: string; cableRouteName: string } {
  const m = titleText.match(RACK_CODE_RE);
  if (m) {
    const idx = m.index ?? 0;
    const before = titleText.slice(0, idx).replace(/^\s*\d+\.\s*ML\s*/i, "").trim();
    return { code: `ODF${m[1]}/${m[2]}`, cableRouteName: before || titleText.trim() };
  }
  const m2 = fallbackCell.match(RACK_CODE_LOOSE_RE);
  if (m2) {
    warnings.push(`Không tách được mã rack từ tiêu đề "${titleText}", dùng ô Rack-sub "${fallbackCell}" thay thế.`);
    return { code: `ODF${m2[1]}/${m2[2]}`, cableRouteName: titleText.trim() || sheetName };
  }
  warnings.push(`Không tách được mã rack từ tiêu đề "${titleText}" lẫn ô Rack-sub "${fallbackCell}" — dùng tên sheet làm mã, cần sửa tay.`);
  return { code: sheetName, cableRouteName: titleText.trim() || sheetName };
}

/** Quy tắc welded/distribution do người dùng cung cấp trực tiếp (không suy
 * ra được từ cột nào trong Excel — xem architecture.md mục 7). */
function deriveOdfType(code: string): OdfType {
  const m = code.match(/^ODF(\d+)\/(\d+)/);
  if (!m) return "distribution";
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 1 && b === 14) return "distribution";
  if (a === 1 || a === 2 || a === 6) return "welded";
  return "distribution";
}

interface TrunkColumnMap {
  rackCell: number | null;
  portNumber: number | null;
  fiberNumber: number | null;
  circuitName: number | null;
  interfaceType: number | null;
  transitText: number | null;
  counterpartText: number | null;
  responsePlanText: number | null;
  executionStationText: number | null;
  notes: number | null;
}

function buildTrunkColumnMap(headerRow: unknown[]): TrunkColumnMap {
  const map: TrunkColumnMap = {
    rackCell: null,
    portNumber: null,
    fiberNumber: null,
    circuitName: null,
    interfaceType: null,
    transitText: null,
    counterpartText: null,
    responsePlanText: null,
    executionStationText: null,
    notes: null,
  };
  headerRow.forEach((c, idx) => {
    const n = normalizeHeader(c);
    if (n === "") return;
    if (n.includes("racksub") || (n.includes("rack") && n.includes("odf"))) map.rackCell = idx;
    else if (n.includes("uutien")) {
      /* "Mức Độ ưu tiên" — bỏ theo CLAUDE.md, không map vào field nào */
    } else if (n.includes("tenluong")) map.circuitName = idx;
    else if (n.includes("giaotiep") || n.includes("tocdo")) map.interfaceType = idx;
    else if (n.includes("chuyentiep")) map.transitText = idx;
    else if (n.includes("doiphuong")) map.counterpartText = idx;
    else if (n.includes("ungcuu")) map.responsePlanText = idx;
    else if (n.includes("thuchien")) map.executionStationText = idx;
    else if (n.includes("ghichu")) map.notes = idx;
    else if (n.startsWith("soi") || n.startsWith("soj")) map.fiberNumber = idx;
    else if (n.includes("port")) map.portNumber = idx;
  });
  return map;
}

function parseTrunkSheet(grid: Grid, sheetName: string): ParsedRack {
  const warnings: string[] = [];

  let titleRowIdx = grid.findIndex((r) => TRUNK_TITLE_RE.test(cellStr(r[0])));
  if (titleRowIdx === -1) {
    warnings.push(`Không tìm thấy dòng tiêu đề "N. ML ..." — dùng dòng 4 (index 3) mặc định.`);
    titleRowIdx = 3;
  }
  const titleText = cellStr(grid[titleRowIdx]?.[0]);
  const headerRowIdx = titleRowIdx + 1;
  const headerRow = (grid[headerRowIdx] ?? []) as unknown[];
  const colMap = buildTrunkColumnMap(headerRow);

  if (colMap.portNumber === null || colMap.circuitName === null) {
    warnings.push(`Không nhận diện được cột Port hoặc Tên luồng ở header — có thể dữ liệu bị sai lệch, cần kiểm tra tay.`);
  }

  const firstDataRowIdx = headerRowIdx + 1;
  const fallbackRackCell = cellStr(cell(grid, firstDataRowIdx, colMap.rackCell ?? 0));
  const { code, cableRouteName } = deriveRackCode(titleText, fallbackRackCell, sheetName, warnings);
  const odfType = deriveOdfType(code);

  const ports = new Map<number, PortRow>();
  for (let r = firstDataRowIdx; r < grid.length; r++) {
    const portNumber = cellNum(cell(grid, r, colMap.portNumber));
    if (portNumber === null) continue; // dòng trống (đệm cuối bảng) — bỏ qua
    const fiberNumber = colMap.fiberNumber !== null ? cellNum(cell(grid, r, colMap.fiberNumber)) : portNumber;
    const portData: PortRow = {
      portNumber,
      fiberNumber: fiberNumber ?? portNumber,
      circuitName: cellStr(cell(grid, r, colMap.circuitName)),
      interfaceType: cellStr(cell(grid, r, colMap.interfaceType)),
      transitText: cellStr(cell(grid, r, colMap.transitText)),
      counterpartText: cellStr(cell(grid, r, colMap.counterpartText)),
      responsePlanText: cellStr(cell(grid, r, colMap.responsePlanText)),
      executionStationText: cellStr(cell(grid, r, colMap.executionStationText)),
      notes: cellStr(cell(grid, r, colMap.notes)),
    };
    if (ports.has(portNumber)) {
      // Đã xác nhận với người dùng: khi trùng port, dòng xuất hiện SAU (thường
      // là dòng đệm/test còn sót lại cuối bảng, sau 1 dòng trống) là dữ liệu
      // rác — giữ dòng xuất hiện ĐẦU (đúng vị trí tuần tự 1..N trong bảng gốc).
      warnings.push(`Port ${portNumber} xuất hiện 2 lần (dòng ${r + 1} trùng với dòng trước đó) — đã BỎ dòng ${r + 1}, giữ dữ liệu dòng xuất hiện đầu. Cần kiểm tra tay nếu không đúng ý.`);
      continue;
    }
    ports.set(portNumber, portData);
  }
  if (ports.size === 0) warnings.push(`Không tìm thấy port nào trong sheet này.`);

  // Ghép Tx/Rx: port lẻ + port chẵn liền sau, khi (chẵn trống) hoặc (cùng tên
  // luồng) — theo đúng cách dữ liệu gốc thể hiện 1 luồng dùng 2 sợi liên tiếp.
  const sorted = [...ports.keys()].sort((a, b) => a - b);
  const consumed = new Set<number>();
  const groups: CircuitGroup[] = [];
  for (const p of sorted) {
    if (consumed.has(p)) continue;
    const rowData = ports.get(p)!;
    if (rowData.circuitName === "") {
      consumed.add(p);
      continue; // port chưa dùng, không tạo circuit
    }
    if (p % 2 === 1) {
      const next = ports.get(p + 1);
      if (next && !consumed.has(p + 1)) {
        const sameOrBlank = next.circuitName === "" || next.circuitName === rowData.circuitName;
        if (sameOrBlank) {
          const merged: PortRow = {
            ...rowData,
            counterpartText: mergeField(rowData.counterpartText, next.counterpartText, p + 1),
            responsePlanText: mergeField(rowData.responsePlanText, next.responsePlanText, p + 1),
            notes: mergeField(rowData.notes, next.notes, p + 1),
          };
          groups.push({ data: merged, portLinks: [{ portNumber: p, role: "tx" }, { portNumber: p + 1, role: "rx" }] });
          consumed.add(p);
          consumed.add(p + 1);
          continue;
        }
      }
    }
    groups.push({ data: rowData, portLinks: [{ portNumber: p, role: "single" }] });
    consumed.add(p);
  }

  return { sheetName, code, cableRouteName, odfType, ports, groups, warnings };
}

// ---------------------------------------------------------------------------
// Parser: file ODF/DDF THIẾT BỊ (M3.TD-1_2)
// ---------------------------------------------------------------------------

// Sheet mẫu/template, mục lục, hoặc không thuộc phạm vi ODF/DDF — bỏ qua.
const DEVICE_SKIP_SHEETS = new Set([
  "INDEX",
  "Bảng ánh xạ",
  "M3.TD-1_Kenh trong nuoc",
  "M3.TD-2_Kenh Quoc te",
  "M3.TD-1_E1 ADX#mau",
  "Sheet1",
]);

function parseDeviceSheet(grid: Grid, sheetName: string): ParsedDeviceSheet {
  const warnings: string[] = [];

  // "Chuyển tiếp tại trạm" là nhãn ổn định nhất quan sát được trên mọi sheet
  // thiết bị — dùng làm mốc tìm header, đáng tin hơn cột STT (có sheet ghi
  // "STT", có sheet ghi "1/TT").
  const groupHeaderIdx = grid.findIndex((r) => r.some((c) => normalizeHeader(c) === "chuyentieptaitram"));
  if (groupHeaderIdx === -1) {
    warnings.push(`Không tìm thấy header "Chuyển tiếp tại trạm" — bỏ qua sheet, cần kiểm tra tay.`);
    return { sheetName, deviceName: sheetName, circuits: [], warnings };
  }
  const groupHeader = grid[groupHeaderIdx] as unknown[];
  const subHeader = (grid[groupHeaderIdx + 1] ?? []) as unknown[];
  const dataStart = groupHeaderIdx + 2;

  let deviceName = sheetName;
  for (let r = 3; r < groupHeaderIdx; r++) {
    const v = cellStr(grid[r]?.[0]);
    if (v !== "") {
      deviceName = v;
      break;
    }
  }

  const idxCounterpart = groupHeader.findIndex((c) => normalizeHeader(c) === "diemcuoi");
  const idxNotes = groupHeader.findIndex((c) => normalizeHeader(c) === "ghichu");

  const idxCircuitName = subHeader.findIndex((c) => normalizeHeader(c).includes("tenluong"));
  const idxSymbol = subHeader.findIndex((c) => normalizeHeader(c).includes("kyhieu"));
  const idxInterface = subHeader.findIndex((c) => {
    const n = normalizeHeader(c);
    return n.includes("tocdo") || n.includes("giaotiep");
  });
  const idxTrib = subHeader.findIndex((c) => normalizeHeader(c) === "trib");
  const idxAgg = subHeader.findIndex((c) => normalizeHeader(c) === "agg");
  const idxDdfPrimary = subHeader.findIndex((c) => {
    const n = normalizeHeader(c);
    return n.includes("toado") && (n.includes("ddf") || n.includes("odf"));
  });
  const idxTransmission = subHeader.findIndex((c) => {
    const n = normalizeHeader(c);
    return n.includes("toado") && n.includes("truyendan");
  });

  // Cột "Tọa độ DDF/ODF" thứ 2 (chuyển tiếp thêm 1 chặng trong trạm) thường
  // có sub-header BỎ TRỐNG (chỉ hiểu ngầm theo vị trí) — suy theo vị trí:
  // mọi cột nằm giữa cột "Tọa độ DDF/ODF" đầu tiên và cột "Tọa độ truyền dẫn".
  const ddfCoordCols: number[] = [];
  if (idxDdfPrimary !== -1) {
    const end = idxTransmission !== -1 && idxTransmission > idxDdfPrimary ? idxTransmission : idxDdfPrimary + 1;
    for (let c = idxDdfPrimary; c < end; c++) ddfCoordCols.push(c);
  } else {
    warnings.push(`Không tìm thấy cột "Tọa độ DDF/ODF" — bỏ qua thông tin tọa độ của sheet này.`);
  }

  const circuits: DeviceCircuit[] = [];
  for (let r = dataStart; r < grid.length; r++) {
    const name = idxCircuitName !== -1 ? cellStr(grid[r]?.[idxCircuitName]) : "";
    const symbol = idxSymbol !== -1 ? cellStr(grid[r]?.[idxSymbol]) : "";
    const interfaceType = idxInterface !== -1 ? cellStr(grid[r]?.[idxInterface]) : "";
    const trib = idxTrib !== -1 ? cellStr(grid[r]?.[idxTrib]) : "";
    const agg = idxAgg !== -1 ? cellStr(grid[r]?.[idxAgg]) : "";
    const ddfTexts = ddfCoordCols.map((c) => cellStr(grid[r]?.[c])).filter((v) => v !== "");
    const transmission = idxTransmission !== -1 ? cellStr(grid[r]?.[idxTransmission]) : "";
    const counterpart = idxCounterpart !== -1 ? cellStr(grid[r]?.[idxCounterpart]) : "";
    const rawNotes = idxNotes !== -1 ? cellStr(grid[r]?.[idxNotes]) : "";

    const hasMeaning = [name, symbol, ddfTexts.join(""), transmission, counterpart, rawNotes].some((v) => v !== "");
    if (!hasMeaning) continue; // cổng Trib chưa dùng — không tạo circuit rỗng

    const notesLines = [`Thiết bị: ${deviceName}`];
    if (symbol) notesLines.push(`Ký hiệu: ${symbol}`);
    if (agg) notesLines.push(`Agg: ${agg}`);
    ddfTexts.forEach((t) => notesLines.push(`Tọa độ DDF/ODF: ${t}`));
    if (transmission) notesLines.push(`Tọa độ truyền dẫn: ${transmission}`);
    if (rawNotes) notesLines.push(rawNotes);

    circuits.push({
      name: name || `(chưa đặt tên) ${deviceName} - Trib ${trib || `dòng ${r + 1}`}`,
      interfaceType,
      tribText: trib,
      counterpartText: counterpart,
      notes: notesLines.join("\n"),
    });
  }

  return { sheetName, deviceName, circuits, warnings };
}

// ---------------------------------------------------------------------------
// Báo cáo dry-run
// ---------------------------------------------------------------------------

interface Report {
  commit: boolean;
  trunk: { racks: number; ports: number; circuits: number; transitLinks: number; warnings: string[] };
  device: { sheets: number; circuits: number; skippedSheets: string[]; warnings: string[] };
}

function isStandbyRack(rack: ParsedRack): boolean {
  return normalizeHeader(rack.cableRouteName + " " + rack.sheetName).includes("duphong");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(TRUNK_FILE)) throw new Error(`Không tìm thấy file: ${TRUNK_FILE}`);
  if (!fs.existsSync(DEVICE_FILE)) throw new Error(`Không tìm thấy file: ${DEVICE_FILE}`);

  const trunkWb = XLSX.readFile(TRUNK_FILE);
  const deviceWb = XLSX.readFile(DEVICE_FILE);

  const trunkRacks: ParsedRack[] = [];
  for (const sheetName of trunkWb.SheetNames) {
    if (sheetName === "INDEX") continue;
    trunkRacks.push(parseTrunkSheet(readGrid(trunkWb, sheetName), sheetName));
  }

  const deviceSheets: ParsedDeviceSheet[] = [];
  const skippedSheets: string[] = [];
  for (const sheetName of deviceWb.SheetNames) {
    if (DEVICE_SKIP_SHEETS.has(sheetName)) {
      skippedSheets.push(sheetName);
      continue;
    }
    const grid = readGrid(deviceWb, sheetName);
    const looksLikeTemplate = (cellStr(grid[0]?.[0]) + cellStr(grid[0]?.[1])).includes("<");
    if (looksLikeTemplate) {
      skippedSheets.push(sheetName);
      continue;
    }
    deviceSheets.push(parseDeviceSheet(grid, sheetName));
  }

  const report: Report = {
    commit: COMMIT,
    trunk: {
      racks: trunkRacks.length,
      ports: trunkRacks.reduce((s, r) => s + r.ports.size, 0),
      circuits: trunkRacks.reduce((s, r) => s + r.groups.length, 0),
      transitLinks: trunkRacks.reduce((s, r) => s + [...r.ports.values()].filter((p) => p.transitText !== "").length, 0),
      warnings: trunkRacks.flatMap((r) => r.warnings.map((w) => `[${r.sheetName}] ${w}`)),
    },
    device: {
      sheets: deviceSheets.length,
      circuits: deviceSheets.reduce((s, d) => s + d.circuits.length, 0),
      skippedSheets,
      warnings: deviceSheets.flatMap((d) => d.warnings.map((w) => `[${d.sheetName}] ${w}`)),
    },
  };

  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), "utf-8");
  console.log(`[import-legacy] Chế độ: ${COMMIT ? "COMMIT (ghi vào Supabase)" : "DRY RUN (chỉ phân tích)"}`);
  console.log(
    `[import-legacy] Trunk: ${report.trunk.racks} rack, ${report.trunk.ports} port, ${report.trunk.circuits} luồng, ${report.trunk.transitLinks} transit_link, ${report.trunk.warnings.length} cảnh báo.`
  );
  console.log(
    `[import-legacy] Device: ${report.device.sheets} sheet, ${report.device.circuits} luồng, bỏ qua ${report.device.skippedSheets.length} sheet, ${report.device.warnings.length} cảnh báo.`
  );
  console.log(`[import-legacy] Đã ghi báo cáo đầy đủ: ${REPORT_FILE}`);

  if (!COMMIT) {
    console.log(`[import-legacy] Đây là DRY RUN — chưa ghi gì vào Supabase. Đọc kỹ import-report.json, sau đó chạy: npm run import-legacy -- --commit`);
    return;
  }

  await commitToSupabase(trunkRacks, deviceSheets);
}

async function commitToSupabase(trunkRacks: ParsedRack[], deviceSheets: ParsedDeviceSheet[]) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  }
  // Không dùng generic <Database> ở đây: bản @supabase/postgrest-js hiện tại
  // đòi hỏi kiểu schema rất chi tiết (select-query-parser theo từng chuỗi
  // select), viết tay dễ lệch và làm mọi insert/select bị suy ra "never".
  // Dùng client không generic — vẫn chạy đúng, chỉ mất gợi ý kiểu cột.
  // Nếu sau này cần kiểu chặt chẽ, chạy `supabase gen types typescript`.
  const db = createClient(supabaseUrl, serviceRoleKey);

  // 1. Đảm bảo trạm ADN1 tồn tại (mọi rack trong 2 file này đều thuộc ADN1).
  const { data: existingStation, error: stationSelectErr } = await db.from("stations").select("id").eq("code", "ADN1").maybeSingle();
  if (stationSelectErr) throw stationSelectErr;
  let stationId = existingStation?.id as string | undefined;
  if (!stationId) {
    const { data: inserted, error } = await db.from("stations").insert({ code: "ADN1", name: "ADN1", is_managed: true }).select("id").single();
    if (error) throw error;
    stationId = inserted.id;
  }

  let totalRacks = 0;
  let totalPorts = 0;
  let totalCircuits = 0;
  let totalTransit = 0;

  // 2. ODF trung kế — xử lý tuần tự từng rack để dễ log lỗi theo sheet.
  for (const rack of trunkRacks) {
    const { data: rackRow, error: rackErr } = await db
      .from("racks")
      .insert({
        station_id: stationId,
        code: rack.code,
        domain: "trunk",
        odf_type: rack.odfType,
        port_count: rack.ports.size || 1,
        cable_route_name: rack.cableRouteName,
      })
      .select("id")
      .single();
    if (rackErr) {
      console.error(`[commit] Lỗi tạo rack ${rack.code} (${rack.sheetName}):`, rackErr.message);
      continue;
    }
    totalRacks++;

    const portInsertRows = [...rack.ports.values()].map((p) => ({
      rack_id: rackRow.id,
      port_number: p.portNumber,
      fiber_number: p.fiberNumber,
      medium: "fiber" as const,
      status: "unused" as const, // cập nhật lại thành 'in_use' bên dưới cho port có luồng
    }));
    const portIdByNumber = new Map<number, string>();
    for (const batch of chunk(portInsertRows, 500)) {
      const { data, error } = await db.from("ports").insert(batch).select("id, port_number");
      if (error) {
        console.error(`[commit] Lỗi tạo ports rack ${rack.code}:`, error.message);
        continue;
      }
      (data ?? []).forEach((r: { id: string; port_number: number }) => portIdByNumber.set(r.port_number, r.id));
    }
    totalPorts += portIdByNumber.size;

    const circuitRole = isStandbyRack(rack) ? "standby" : "active";

    for (const group of rack.groups) {
      const { data: circuitRow, error: circuitErr } = await db
        .from("circuits")
        .insert({
          name: group.data.circuitName,
          interface_type: group.data.interfaceType || null,
          circuit_role: circuitRole,
          counterpart_text: group.data.counterpartText || null,
          response_plan_text: group.data.responsePlanText || null,
          execution_station_text: group.data.executionStationText || null,
          notes: group.data.notes || null,
        })
        .select("id")
        .single();
      if (circuitErr) {
        console.error(`[commit] Lỗi tạo circuit "${group.data.circuitName}":`, circuitErr.message);
        continue;
      }
      totalCircuits++;

      const linkRows = group.portLinks
        .map((pl) => ({ port_id: portIdByNumber.get(pl.portNumber), circuit_id: circuitRow.id, link_role: pl.role }))
        .filter((l): l is { port_id: string; circuit_id: string; link_role: LinkRole } => !!l.port_id);
      if (linkRows.length) {
        const { error: linkErr } = await db.from("port_circuit_links").insert(linkRows);
        if (linkErr) {
          console.error(`[commit] Lỗi tạo port_circuit_links cho circuit "${group.data.circuitName}":`, linkErr.message);
        } else {
          await db
            .from("ports")
            .update({ status: "in_use" })
            .in(
              "id",
              linkRows.map((l) => l.port_id)
            );
        }
      }
    }

    const transitRows = [...rack.ports.entries()]
      .filter(([, p]) => p.transitText !== "")
      .map(([portNumber, p]) => ({
        source_port_id: portIdByNumber.get(portNumber),
        target_type: "text_only" as const,
        raw_text: p.transitText,
      }))
      .filter((t): t is { source_port_id: string; target_type: "text_only"; raw_text: string } => !!t.source_port_id);
    for (const batch of chunk(transitRows, 500)) {
      const { error } = await db.from("transit_links").insert(batch);
      if (error) console.error(`[commit] Lỗi tạo transit_links rack ${rack.code}:`, error.message);
      else totalTransit += batch.length;
    }
  }

  // 3. ODF/DDF thiết bị — chỉ tạo circuits (xem architecture.md mục 7 về lý
  // do chưa tạo racks/ports/transit_links cho file này ở lần import đầu).
  let totalDeviceCircuits = 0;
  for (const sheet of deviceSheets) {
    const insertRows = sheet.circuits.map((c) => ({
      name: c.name,
      interface_type: c.interfaceType || null,
      circuit_role: "active" as const,
      counterpart_text: c.counterpartText || null,
      trib_text: c.tribText || null,
      notes: c.notes || null,
    }));
    for (const batch of chunk(insertRows, 500)) {
      const { error } = await db.from("circuits").insert(batch);
      if (error) console.error(`[commit] Lỗi tạo circuits thiết bị "${sheet.deviceName}":`, error.message);
      else totalDeviceCircuits += batch.length;
    }
  }

  // 4. Log lại 2 lần import vào import_batches để truy vết sau này.
  await db.from("import_batches").insert([
    {
      file_name: path.basename(TRUNK_FILE),
      row_count: totalPorts,
      status: "success",
      error_log: { racks: totalRacks, circuits: totalCircuits, transitLinks: totalTransit },
    },
    {
      file_name: path.basename(DEVICE_FILE),
      row_count: totalDeviceCircuits,
      status: "success",
      error_log: { sheets: deviceSheets.length },
    },
  ]);

  console.log(
    `[commit] Xong. Trunk: ${totalRacks} rack, ${totalPorts} port, ${totalCircuits} luồng, ${totalTransit} transit_link. Device: ${totalDeviceCircuits} luồng.`
  );
}

main().catch((err) => {
  console.error("[import-legacy] Lỗi:", err);
  process.exit(1);
});
