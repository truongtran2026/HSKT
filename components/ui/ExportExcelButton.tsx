"use client";

import { exportRowsToExcel, type ExcelColumn } from "@/lib/exportExcel";
import { IconDownload } from "@/components/ui/icons";

// Nút icon "Xuất Excel" dùng chung cho mọi bảng — gói lại exportRowsToExcel()
// (lib/exportExcel.ts) thành 1 nút bấm, tránh lặp lại onClick ở 9 bảng khác
// nhau. Bảng gọi tự truyền đúng columns đang HIỂN THỊ (đã lọc theo
// useColumnVisibility) + rows đang hiện sau sort/filter.
export default function ExportExcelButton<T>({
  columns,
  rows,
  sheetName,
  fileNamePrefix,
}: {
  columns: ExcelColumn<T>[];
  rows: T[];
  sheetName: string;
  fileNamePrefix: string;
}) {
  return (
    <button
      type="button"
      className="btn-secondary px-2 py-1.5"
      onClick={() => exportRowsToExcel(columns, rows, { sheetName, fileNamePrefix })}
      title={`Xuất Excel (${rows.length} dòng, ${columns.length} cột đang hiển thị)`}
      aria-label="Xuất Excel"
    >
      <IconDownload />
    </button>
  );
}
