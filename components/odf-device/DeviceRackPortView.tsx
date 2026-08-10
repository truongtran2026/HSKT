"use client";

import Link from "next/link";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { DeviceRackCircuitRef, DeviceRackPortRefs } from "@/lib/deviceRackPorts";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import RefreshButton from "@/components/ui/RefreshButton";

// Trang XEM (không sửa tại chỗ, yêu cầu người dùng 2026-07-28) cho rack
// ODF/DDF thiết bị (domain='device'). Bảng đổi từ "Port / Thiết bị này (own)
// / Đầu xa (next)" sang "Port / Tên luồng / Ghi chú" (yêu cầu người dùng
// 2026-07-28: own/next chỉ có ý nghĩa kỹ thuật nội bộ, người dùng chỉ cần
// biết "port này đang có luồng gì") — gộp own+next thành 1 danh sách luồng
// đang chiếm port đó, và gộp 2 port LIỀN KỀ vào 1 dòng khi CHÍNH XÁC cùng 1
// tập luồng chiếm cả 2 (giống quy tắc rowspan bên PortTable.tsx/trung kế) —
// không liền kề hoặc tập luồng khác nhau thì luôn tách dòng riêng, đúng
// nguyên tắc CLAUDE.md #2 (không bao giờ giấu bớt thông tin). Dữ liệu tới từ
// đối chiếu text qua lib/deviceRackPorts.ts, KHÔNG phải port_circuit_links
// thật (khác PortTable.tsx bên trung kế). Bấm vào tên luồng nhảy sang trang
// "Hồ sơ đấu nối" đúng dòng cần sửa (tái dùng rowAnchor() đã có sẵn).
interface PortRow {
  portNumbers: number[]; // 1 hoặc 2 số port hiển thị gộp ở dòng này
  entries: DeviceRackCircuitRef[]; // các luồng đang chiếm (các) port này
}

function combinedRefsAt(portNumber: number, portRefs: Map<number, DeviceRackPortRefs>): DeviceRackCircuitRef[] {
  const refs = portRefs.get(portNumber);
  if (!refs) return [];
  return [...refs.own, ...refs.next];
}

// So sánh 2 tập luồng có Y HỆT nhau không (theo id) — chỉ gộp dòng khi khớp
// tuyệt đối, không rỗng (2 port trống liền kề vẫn để riêng, không có ý nghĩa
// gì khi gộp "trống + trống").
function sameEntrySet(a: DeviceRackCircuitRef[], b: DeviceRackCircuitRef[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const idsA = new Set(a.map((e) => e.id));
  const idsB = new Set(b.map((e) => e.id));
  if (idsA.size !== idsB.size) return false;
  for (const id of idsA) if (!idsB.has(id)) return false;
  return true;
}

function buildPortRows(portCount: number, portRefs: Map<number, DeviceRackPortRefs>): PortRow[] {
  const rows: PortRow[] = [];
  let n = 1;
  while (n <= portCount) {
    const cur = combinedRefsAt(n, portRefs);
    const next = n + 1 <= portCount ? combinedRefsAt(n + 1, portRefs) : [];
    if (sameEntrySet(cur, next)) {
      rows.push({ portNumbers: [n, n + 1], entries: cur });
      n += 2;
    } else {
      rows.push({ portNumbers: [n], entries: cur });
      n += 1;
    }
  }
  return rows;
}

type VisibleCol = "notes";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = { notes: true };
const COLUMN_ITEMS = [{ key: "notes" as const, label: "Ghi chú" }];

// Kéo-thả TOÀN BỘ cột (yêu cầu người dùng 2026-08-08, đồng bộ từ
// PortTable.tsx cho cả 9 bảng — xem architecture.md Mục 84). Trước đây bảng
// này KHÔNG làm kéo-thả (chỉ 1 cột tùy chọn "Ghi chú", đổi thứ tự 1 phần tử
// vô nghĩa) — giờ gộp thêm 2 cột cấu trúc "Port"/"Tên luồng" vào cùng 1
// thứ tự kéo-thả được thì đã có 3 cột, đổi thứ tự thật sự có ý nghĩa.
type StructuralCol = "port" | "name";
type AllCol = StructuralCol | VisibleCol;
const DEFAULT_ALL_ORDER: AllCol[] = ["port", "name", "notes"];
const STRUCTURAL_COLUMNS = new Set<AllCol>(["port", "name"]);
const OPTIONAL_COL_SET = new Set<AllCol>(COLUMN_ITEMS.map((c) => c.key));

export default function DeviceRackPortView({
  portCount,
  portRefEntries,
}: {
  portCount: number;
  // Mảng entries thay vì Map — component này là "use client" (cần state ẩn/
  // hiện cột), Map không đi qua ranh giới Server->Client Component an toàn
  // như array/object thường, nên page.tsx (server) chuyển Map -> entries
  // trước khi truyền xuống.
  portRefEntries: [number, DeviceRackPortRefs][];
}) {
  const portRefs = new Map(portRefEntries);
  const rows = buildPortRows(portCount, portRefs);
  const { visible, toggle } = useColumnVisibility<VisibleCol>("device-rack-port-col-visibility", DEFAULT_VISIBLE);
  const { order: colOrder, moveColumn, reset: resetColOrder } = useColumnOrder<AllCol>("device-rack-port-col-order", DEFAULT_ALL_ORDER);
  const orderedAll = colOrder.filter((col) => STRUCTURAL_COLUMNS.has(col) || visible[col as VisibleCol]);

  function colWidthOf(col: AllCol): number | undefined {
    if (col === "port") return 70;
    if (col === "notes") return 220;
    return undefined; // "name" giãn hết chỗ còn lại
  }

  function renderHeaderCell(col: AllCol) {
    const reorderProps = { reorderKey: col, onReorderColumn: moveColumn } as const;
    switch (col) {
      case "port":
        return <DataTh key={col} label="Port" {...reorderProps} />;
      case "name":
        return <DataTh key={col} label="Tên luồng" {...reorderProps} />;
      case "notes":
        return <DataTh key={col} label="Ghi chú" {...reorderProps} />;
    }
  }

  function renderCell(col: AllCol, row: PortRow) {
    switch (col) {
      case "port": {
        const portLabel = row.portNumbers.length === 2 ? `${row.portNumbers[0]}-${row.portNumbers[1]}` : String(row.portNumbers[0]);
        return (
          <td key={col} className="px-3 py-2 font-medium text-slate-700">
            {portLabel}
          </td>
        );
      }
      case "name":
        return (
          <td key={col} className="px-3 py-2 break-words">
            {row.entries.length === 0 ? (
              <span className="text-slate-300">— trống —</span>
            ) : (
              row.entries.map((e, i) => (
                <div key={`${e.id}-${i}`}>
                  <Link href={`/odf-device/sua-luong#${rowAnchor(e.id)}`} className="text-primary-600 hover:underline">
                    {e.name}
                  </Link>
                </div>
              ))
            )}
          </td>
        );
      case "notes":
        return (
          <td key={col} className="px-3 py-2 text-slate-500 break-words">
            {row.entries.length === 0 ? "—" : row.entries.map((e, i) => <div key={`${e.id}-${i}`}>Luồng sử dụng sợi {e.portNumbers.join(",")}</div>)}
          </td>
        );
    }
  }

  return (
    <div>
      <div className="mb-2 flex justify-end gap-2">
        <RefreshButton />
        <ColumnPicker
          items={COLUMN_ITEMS}
          order={colOrder.filter((col): col is VisibleCol => OPTIONAL_COL_SET.has(col))}
          visible={visible}
          onToggle={toggle}
          onReorderColumn={moveColumn as (dragged: VisibleCol, target: VisibleCol) => void}
          onResetOrder={resetColOrder}
        />
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {orderedAll.map((col) => (
              <col key={col} style={colWidthOf(col) !== undefined ? { width: colWidthOf(col) } : undefined} />
            ))}
          </colgroup>
          <thead className="text-primary-800">
            <tr>{orderedAll.map((col) => renderHeaderCell(col))}</tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = row.portNumbers.join("-");
              return (
                <tr key={key} className="border-t border-slate-100 align-top hover:bg-primary-50/50">
                  {orderedAll.map((col) => renderCell(col, row))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
