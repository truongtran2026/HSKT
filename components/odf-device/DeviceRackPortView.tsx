import Link from "next/link";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { DeviceRackPortRefs } from "@/lib/deviceRackPorts";

// Trang XEM (không sửa tại chỗ, yêu cầu người dùng 2026-07-28) cho rack
// ODF/DDF thiết bị (domain='device') — mỗi port hiện tối đa 2 dòng nhỏ:
// "own" (chính thiết bị này đấu ra port) và "next" (đầu xa của 1 luồng khác
// đấu tới port này) — dữ liệu tới từ đối chiếu text qua
// lib/deviceRackPorts.ts, KHÔNG phải port_circuit_links thật (khác
// PortTable.tsx bên trung kế). Bấm vào tên luồng nhảy sang trang "Sửa luồng
// thiết bị" đúng dòng cần sửa (tái dùng rowAnchor() đã có sẵn).
export default function DeviceRackPortView({
  portCount,
  portRefs,
}: {
  portCount: number;
  portRefs: Map<number, DeviceRackPortRefs>;
}) {
  const ports = Array.from({ length: portCount }, (_, i) => i + 1);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col style={{ width: 70 }} />
          <col />
          <col />
        </colgroup>
        <thead className="bg-primary-50 text-primary-800">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Port</th>
            <th className="px-3 py-2 text-left font-medium">Thiết bị này (own)</th>
            <th className="px-3 py-2 text-left font-medium">Đầu xa (next)</th>
          </tr>
        </thead>
        <tbody>
          {ports.map((portNumber) => {
            const refs = portRefs.get(portNumber);
            const own = refs?.own ?? [];
            const next = refs?.next ?? [];
            return (
              <tr key={portNumber} className="border-t border-slate-100 align-top">
                <td className="px-3 py-2 font-medium text-slate-700">{portNumber}</td>
                <td className="px-3 py-2 break-words">
                  {own.length === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    own.map((c) => (
                      <div key={c.id}>
                        <Link href={`/odf-device/sua-luong#${rowAnchor(c.id)}`} className="text-primary-600 hover:underline">
                          {c.name}
                        </Link>
                      </div>
                    ))
                  )}
                </td>
                <td className="px-3 py-2 break-words">
                  {next.length === 0 ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    next.map((c) => (
                      <div key={c.id}>
                        <Link href={`/odf-device/sua-luong#${rowAnchor(c.id)}`} className="text-primary-600 hover:underline">
                          {c.name}
                        </Link>
                      </div>
                    ))
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
