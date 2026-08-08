"use client";

import { useMemo, useState } from "react";
import type { CircuitPairDetail } from "@/lib/circuitPairSync";
import CircuitPairSyncPanel from "@/components/data-quality/CircuitPairSyncPanel";
import { useCollapsed } from "@/lib/useCollapsed";

// LOẠI THỨ 6 của "chưa đồng bộ" (yêu cầu người dùng 2026-08-02, sau ca thật
// ADN1.P2(2/1/2): "cơ chế liên kết theo luồng có vẻ chưa ổn... không đúng") —
// khác HẲN mục 44 (chưa liên kết): đây là cặp ĐÃ liên kết (mirror_of_id có
// sẵn) nhưng dữ liệu LỆCH — 1 bên bị sửa tay sau khi đã liên kết, chưa từng
// có cơ chế nào rà bắt trước đây (link status badge mục 46 chỉ báo "đã liên
// kết", không kiểm tra nội dung 2 bên có còn khớp nhau không).
export default function MismatchedLinkedPairsTab({ items }: { items: CircuitPairDetail[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:mismatchedLinkedPairs");

  function pairKey(it: CircuitPairDetail) {
    return `${it.deviceCircuitId}|${it.trunkCircuitId}`;
  }

  const remaining = useMemo(() => items.filter((it) => !doneKeys.has(pairKey(it))), [items, doneKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remaining;
    return remaining.filter(
      (it) => it.deviceName.toLowerCase().includes(q) || it.trunkName.toLowerCase().includes(q) || it.rackCode.toLowerCase().includes(q)
    );
  }, [remaining, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  if (items.length === 0) {
    return <EmptyState text="Không có cặp luồng đã liên kết nào bị lệch dữ liệu." />;
  }
  if (remaining.length === 0) {
    return <EmptyState text={`Đã xử lý hết ${items.length} cặp phát hiện được trong lượt tải trang này.`} />;
  }

  return (
    <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-violet-800">Phát hiện {remaining.length} cặp ĐÃ liên kết nhưng lệch dữ liệu</h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-violet-300 px-2 py-0.5 text-sm font-bold text-violet-700 hover:bg-violet-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <p className="mt-1 text-xs text-violet-700">
            2 luồng dưới đây đã gắn liên kết mirror từ trước (xóa 1 bên sẽ tự xóa theo bên kia), nhưng ít nhất 1 trong 3
            điểm dữ liệu (Tên luồng / Vị trí ODF thiết bị / Vị trí ODF tiếp theo) đang KHÔNG khớp — khả năng 1 bên bị sửa
            tay sau khi đã liên kết. Chọn bên nào đúng rồi bấm &quot;Áp dụng đồng bộ&quot;.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input w-auto max-w-[260px] border-violet-300"
              placeholder="Lọc theo tên luồng / rack..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <span className="text-xs text-violet-600">
              {filtered.length}/{remaining.length} cặp
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-violet-700">
              Số dòng/trang:
              <select
                className="input w-auto py-1"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
              >
                {[5, 10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-2 space-y-2 text-sm text-violet-900">
            {paged.map((item) => {
              const key = pairKey(item);
              return (
                <li key={key} className="rounded border border-violet-200 bg-white px-2 py-1.5">
                  <a
                    href={`/odf-trunk/${item.rackId}#port-${item.trunkFirstPortId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-violet-500 hover:underline"
                    title="Xem port này ở Hồ sơ ODF Trung kế (mở tab mới)"
                  >
                    {item.rackCode} port {item.portNumbers.join(",")}
                  </a>
                  <div className="mt-1">
                    <CircuitPairSyncPanel detail={item} onApplied={() => setDoneKeys((prev) => new Set(prev).add(key))} />
                  </div>
                </li>
              );
            })}
            {paged.length === 0 && <li className="text-violet-400">Không có dòng nào khớp bộ lọc.</li>}
          </ul>

          {pageCount > 1 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-violet-700">
              <button className="btn-secondary px-2 py-1" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={pageClamped === 0}>
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
        </>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
