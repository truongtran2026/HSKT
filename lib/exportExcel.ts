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
