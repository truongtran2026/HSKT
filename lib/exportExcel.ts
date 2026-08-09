import * as XLSX from "xlsx";
import type { TrunkExportRow } from "@/lib/trunkExportData";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

// Xuất Excel (yêu cầu người dùng 2026-08-07, làm phần Export trước — Import
// để đợt sau). Chạy hoàn toàn phía trình duyệt: XLSX.writeFile tự tạo Blob +
// trigger tải xuống, không cần viết thêm helper download riêng.

function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// Thứ tự cột CỐ ĐỊNH đúng file gốc (đã bỏ "Mức Độ ưu tiên" theo quyết định
// cũ, xem architecture.md mục 3.9) — không suy ra tự động từ object keys, để
// không bị đảo thứ tự nếu sau này thêm field vào TrunkExportRow.
const TRUNK_HEADER = ["Rack-sub ODF", "Port", "Sợi", "Tên luồng", "Giao tiếp", "Chuyển tiếp", "Đối phương", "Phương án ứng cứu", "Trạm thực hiện", "Ghi chú"];

export function exportTrunkExcel(rows: TrunkExportRow[], rackIds: string[] | null) {
  const scoped = rackIds === null ? rows : rows.filter((r) => rackIds.includes(r.rackId));
  const aoa = [
    TRUNK_HEADER,
    ...scoped.map((r) => [
      r.rackCode,
      r.portNumber,
      r.fiberNumber ?? "",
      r.circuitName ?? "",
      r.interfaceType ?? "",
      r.transitText ?? "",
      r.counterpartText ?? "",
      r.responsePlanText ?? "",
      r.executionStationText ?? "",
      r.notes ?? "",
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "ODF trung kế");
  XLSX.writeFile(wb, `ODF_trung_ke_ADN1_${todayStamp()}.xlsx`);
}

// Đúng cấu trúc HIỆN TẠI của app (người dùng xác nhận 2026-08-07) — khớp cột
// đang hiện ở DeviceCircuitList.tsx, KHÔNG cố tách lại 3 cột cũ "ODF chuyển
// tiếp/Thiết bị chuyển tiếp/TBi đầu cuối" (đã gộp vào Ghi chú từ lúc import,
// tách lại không đáng tin — xem lib/deviceCircuits.ts).
const DEVICE_HEADER = ["Tên luồng", "Trib", "Thiết bị", "Vị trí ODF (thiết bị)", "Vị trí ODF (tiếp theo)", "Giao tiếp", "Đối phương", "Ghi chú"];

export function exportDeviceExcel(rows: DeviceCircuitRow[], deviceNames: string[] | null) {
  const scoped = deviceNames === null ? rows : rows.filter((r) => r.deviceName !== null && deviceNames.includes(r.deviceName));
  const aoa = [
    DEVICE_HEADER,
    ...scoped.map((r) => [r.name, r.tribText ?? "", r.deviceName ?? "", r.devicePositionOwn ?? "", r.devicePositionNext ?? "", r.interfaceType ?? "", r.counterpartText ?? "", r.notes ?? ""]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Hồ sơ đấu nối");
  XLSX.writeFile(wb, `Ho_so_dau_noi_ADN1_${todayStamp()}.xlsx`);
}

export interface ExcelColumn<T> {
  label: string;
  getValue: (row: T) => string | number | null | undefined;
}

// Xuất Excel CHUNG cho mọi bảng trong app (quy định chung, yêu cầu người dùng
// 2026-08-08: "trên bất kỳ bảng nào cũng có thể export ra excel theo cột đã
// hiển thị") — khác 2 hàm trên (cố định cột theo cấu trúc file gốc, chỉ dùng
// ở trang /import-export), hàm này nhận thẳng danh sách cột + dòng đang hiện
// TRÊN MÀN HÌNH của bảng gọi nó (đã qua sort/filter/ẩn-hiện-cột phía client),
// xuất ĐÚNG những gì người dùng đang thấy — không phải một view cố định khác.
export function exportRowsToExcel<T>(columns: ExcelColumn<T>[], rows: T[], opts: { sheetName: string; fileNamePrefix: string }) {
  const aoa = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => c.getValue(r) ?? ""))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  // Tên sheet Excel giới hạn 31 ký tự, không được chứa 1 số ký tự đặc biệt.
  XLSX.utils.book_append_sheet(wb, sheet, opts.sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${opts.fileNamePrefix}_${todayStamp()}.xlsx`);
}

// Tên sheet Excel: tối đa 31 ký tự, KHÔNG được chứa \ / ? * [ ] : — mã rack
// thật (vd "ODF 1/8") luôn có dấu "/", phải thay bằng "-" trước khi dùng làm
// tên sheet, nếu không XLSX.writeFile() lỗi âm thầm hoặc file hỏng.
function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, "-").trim() || "Sheet";
}

// Xuất Excel NHIỀU SHEET cùng lúc — mỗi sheet 1 nhóm dòng riêng, DÙNG CHUNG 1
// bộ cột (yêu cầu người dùng 2026-08-09: xuất chi tiết port/sợi/tên luồng...
// của NHIỀU rack ODF trung kế cùng lúc, mỗi rack 1 sheet, thay vì phải vào
// từng rack bấm Xuất Excel riêng lẻ — xem TrunkRackListPanel.tsx). Tự đổi tên
// nếu 2 sheet trùng nhau sau khi cắt còn 31 ký tự/thay ký tự cấm (hiếm khi
// xảy ra với mã rack thật, nhưng vẫn phải chặn để không mất dữ liệu 1 rack).
export function exportMultiSheetExcel<T>(
  sheets: { sheetName: string; rows: T[] }[],
  columns: ExcelColumn<T>[],
  fileNamePrefix: string
) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const header = columns.map((c) => c.label);
  for (const { sheetName, rows } of sheets) {
    const aoa = [header, ...rows.map((r) => columns.map((c) => c.getValue(r) ?? ""))];
    const sheet = XLSX.utils.aoa_to_sheet(aoa);
    const base = sanitizeSheetName(sheetName).slice(0, 31);
    let name = base;
    let suffix = 2;
    while (usedNames.has(name)) {
      name = `${base.slice(0, 28)}_${suffix}`;
      suffix += 1;
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  XLSX.writeFile(wb, `${fileNamePrefix}_${todayStamp()}.xlsx`);
}
