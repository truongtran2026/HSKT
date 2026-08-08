"use client";

import { useMemo, useState } from "react";
import type { CircuitPairDetail } from "@/lib/circuitPairSync";
import CircuitPairSyncPanel from "@/components/data-quality/CircuitPairSyncPanel";
import { useCollapsed } from "@/lib/useCollapsed";

// Khung rà soát "cả 2 phía đã có luồng, khớp đúng vị trí, nhưng chưa liên kết
// mirror_of_id" (yêu cầu người dùng 2026-08-02, xem lib/circuitPairSync.ts để
// hiểu đầy đủ — phát hiện từ ca thật ADN1.OMS3255(1/9/2) <-> ODF1/1(41,42)).
//
// NÂNG CẤP 2026-08-02 (cùng ngày, sau khi người dùng chỉ ra ca ADN1.P2(2/1/2)
// và nói rõ cách kiểm tra CŨ — chỉ đồng bộ TÊN — "không logic"): thay hẳn
// phần đồng bộ-khi-liên-kết bằng CircuitPairSyncPanel — so ĐỦ 3 điểm dữ liệu
// (Tên luồng / Vị trí ODF thiết bị / Vị trí ODF tiếp theo, đúng ánh xạ vật lý
// với Chuyển tiếp + vị trí port thật bên trung kế), không chỉ tên. `items`
// đổi từ `UnlinkedMirrorPair[]` sang `CircuitPairDetail[]` (đã tính sẵn diff).
export default function UnlinkedMirrorPairsTab({ items }: { items: CircuitPairDetail[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:unlinkedMirrorPairs");

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
    return <EmptyState text="Không có cặp luồng thiết bị/trung kế nào khớp vị trí nhưng chưa liên kết." />;
  }
  if (remaining.length === 0) {
    return <EmptyState text={`Đã xử lý hết ${items.length} cặp phát hiện được trong lượt tải trang này.`} />;
  }

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sky-800">
          Phát hiện {remaining.length} cặp luồng khớp vị trí ODF nhưng CHƯA liên kết mirror
        </h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-sky-300 px-2 py-0.5 text-sm font-bold text-sky-700 hover:bg-sky-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <p className="mt-1 text-xs text-sky-700">
            2 luồng dưới đây (1 bên Hồ sơ đấu nối thiết bị, 1 bên Hồ sơ ODF Trung kế) khớp vị trí đủ để nhận ra là ứng viên
            cùng 1 luồng nhưng được lưu ĐỘC LẬP từ trước — đối chiếu bảng bên dưới, chọn bên nào đúng rồi bấm &quot;Áp dụng
            đồng bộ&quot; (tự gắn liên kết luôn). Sau khi liên kết, xóa 1 bên sẽ tự xóa theo bên kia (mirror thật).
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input w-auto max-w-[260px] border-sky-300"
              placeholder="Lọc theo tên luồng / rack..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <span className="text-xs text-sky-600">
              {filtered.length}/{remaining.length} cặp
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-sky-700">
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

          <ul className="mt-2 space-y-2 text-sm text-sky-900">
            {paged.map((item) => {
              const key = pairKey(item);
              return (
                <li key={key} className="rounded border border-sky-200 bg-white px-2 py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-sky-500">
                      {item.similarity}% giống tên ·{" "}
                      <a
                        href={`/odf-trunk/${item.rackId}#port-${item.trunkFirstPortId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                        title="Xem port này ở Hồ sơ ODF Trung kế (mở tab mới)"
                      >
                        {item.rackCode} port {item.portNumbers.join(",")}
                      </a>
                    </span>
                  </div>
                  <div className="mt-1">
                    <CircuitPairSyncPanel detail={item} onApplied={() => setDoneKeys((prev) => new Set(prev).add(key))} />
                  </div>
                </li>
              );
            })}
            {paged.length === 0 && <li className="text-sky-400">Không có dòng nào khớp bộ lọc.</li>}
          </ul>

          {pageCount > 1 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-sky-700">
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
