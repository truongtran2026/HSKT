"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { NonConformingTransitLink } from "@/lib/transitLinks";
import { compareRackCode } from "@/lib/rackCode";

// Danh sách "Chuyển tiếp chưa đúng chuẩn form" (yêu cầu người dùng 2026-07-28)
// — cùng kiểu UI với khung "positionConflicts" đã có ở DeviceCircuitList.tsx
// (tìm/phân trang, KHÔNG tự sửa). Bấm 1 dòng nhảy sang đúng port ở trang rack
// đó (`/odf-trunk/<rackId>#port-<portId>`, xem PortTable.tsx phần đọc hash).
export default function TransitFormatWarning({ items }: { items: NonConformingTransitLink[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);

  const sorted = useMemo(
    () => [...items].sort((a, b) => compareRackCode(a.rackCode, b.rackCode) || a.portNumber - b.portNumber),
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((it) => it.rawText.toLowerCase().includes(q) || it.rackCode.toLowerCase().includes(q));
  }, [sorted, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  function changeSearch(v: string) {
    setSearch(v);
    setPage(0);
  }

  function changePageSize(v: number) {
    setPageSize(v);
    setPage(0);
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h2 className="font-semibold text-amber-800">
        Phát hiện {items.length} "Chuyển tiếp" chưa đúng chuẩn form &quot;ODF x/y (a,b) - ADN1.thiết bị (port)&quot;
      </h2>
      <p className="mt-1 text-xs text-amber-700">
        Không tự sửa — nhiều trường hợp không khớp mẫu này vẫn có thể đúng (vd đi thẳng ra trạm khác không qua thiết
        bị ADN1 nào, hoặc chưa rõ thiết bị đích). Bấm vào 1 dòng để nhảy tới đúng port rồi tự sửa tay.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-amber-300"
          placeholder="Lọc theo rack / nội dung..."
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
        />
        <span className="text-xs text-amber-600">
          {filtered.length}/{items.length} dòng
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-amber-700">
          Số dòng/trang:
          <select className="input w-auto py-1" value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm text-amber-800">
        {paged.map((it) => (
          <li key={it.id}>
            <Link href={`/odf-trunk/${it.rackId}#port-${it.portId}`} className="hover:underline">
              <span className="font-medium">
                {it.rackCode} port {it.portNumber}:
              </span>{" "}
              &quot;{it.rawText}&quot;
            </Link>
          </li>
        ))}
        {paged.length === 0 && <li className="text-amber-400">Không có dòng nào khớp bộ lọc.</li>}
      </ul>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={pageClamped === 0}
          >
            ← Trước
          </button>
          <span>
            Trang {pageClamped + 1}/{pageCount}
          </span>
          <button
            className="btn-secondary px-2 py-1"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={pageClamped >= pageCount - 1}
          >
            Sau →
          </button>
        </div>
      )}
    </div>
  );
}
