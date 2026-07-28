import Link from "next/link";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { DeviceRackCircuitRef, DeviceRackPortRefs } from "@/lib/deviceRackPorts";

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

export default function DeviceRackPortView({
  portCount,
  portRefs,
}: {
  portCount: number;
  portRefs: Map<number, DeviceRackPortRefs>;
}) {
  const rows = buildPortRows(portCount, portRefs);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: 70 }} />
          <col />
          <col style={{ width: 220 }} />
        </colgroup>
        <thead className="bg-primary-50 text-primary-800">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Port</th>
            <th className="px-3 py-2 text-left font-medium">Tên luồng</th>
            <th className="px-3 py-2 text-left font-medium">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = row.portNumbers.join("-");
            const portLabel = row.portNumbers.length === 2 ? `${row.portNumbers[0]}-${row.portNumbers[1]}` : String(row.portNumbers[0]);
            return (
              <tr key={key} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium text-slate-700">{portLabel}</td>
                <td className="px-3 py-2 break-words">
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
                <td className="px-3 py-2 text-slate-500 break-words">
                  {row.entries.length === 0 ? (
                    "—"
                  ) : (
                    row.entries.map((e, i) => <div key={`${e.id}-${i}`}>Luồng sử dụng sợi {e.portNumbers.join(",")}</div>)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
