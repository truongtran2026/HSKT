"use client";

import { useMemo, useState } from "react";
import type { DivergentTransitGroup } from "@/lib/transitLinks";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";

// Bước 4e của HSKT-dot-1-brief.md — xem lib/transitLinks.ts
// findDivergentTransitGroups() để hiểu bối cảnh đầy đủ. KHÔNG có nút tự sửa
// (khác các tab mismatch khác) vì phần lớn (11/11 ca đã rà 2026-08-04) là
// ngoại lệ hợp lệ (thiết bị khuếch đại/DWDM) đã được writeTransitForPorts()
// tự bảo vệ — chỉ liệt kê để dễ thấy, tự rà nếu phát sinh ca mới thật sự sai.
export default function DivergentTransitTab({ groups }: { groups: DivergentTransitGroup[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.circuitName.toLowerCase().includes(q) ||
        g.entries.some((e) => e.rawText.toLowerCase().includes(q) || e.rackCode.toLowerCase().includes(q))
    );
  }, [groups, search]);

  if (groups.length === 0) {
    return <EmptyState text="Không có luồng nào đang có ≥2 port ghi &quot;Chuyển tiếp&quot; khác nhau." />;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-800">
        {groups.length} luồng có ≥2 port ghi &quot;Chuyển tiếp&quot; khác nhau
      </h2>
      <p className="mt-1 text-xs text-amber-700">
        Thường là thiết bị khuếch đại quang/DWDM (Tx/Rx đi 2 port thật khác nhau — MLA/SRA/CPL/WDM) — dữ liệu này ĐÚNG,
        không tự đồng nhất (writeTransitForPorts() tự bảo vệ, không đụng). Chỉ liệt kê để dễ rà; nếu thấy 1 ca KHÔNG
        phải thiết bị khuếch đại thì đó mới là lỗi thật, tự vào sửa tay.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-amber-300"
          placeholder="Lọc theo tên luồng / rack / nội dung..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-xs text-amber-600">
          {filtered.length}/{groups.length} luồng
        </span>
      </div>

      <ul className="mt-2 space-y-2 text-sm text-amber-800">
        {filtered.map((g) => (
          <li key={g.circuitId} className="rounded-md border border-amber-200 bg-white p-2">
            <span className="font-medium">{g.circuitName}</span>
            <ul className="mt-1 ml-4 list-disc text-xs text-amber-700">
              {g.entries.map((e) => (
                <li key={e.portId}>
                  <a
                    href={
                      e.rackDomain === "device"
                        ? `/odf-device/sua-luong#${rowAnchor(g.circuitId)}`
                        : `/odf-trunk/${e.rackId}#port-${e.portId}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-900"
                  >
                    {e.rackCode}/{e.portNumber}
                  </a>
                  : &quot;{e.rawText}&quot;
                </li>
              ))}
            </ul>
          </li>
        ))}
        {filtered.length === 0 && <li className="text-amber-400">Không có luồng nào khớp bộ lọc.</li>}
      </ul>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
