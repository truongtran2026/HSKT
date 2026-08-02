"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { UnlinkedDeviceDevicePair } from "@/lib/unlinkedMirrorPairs";
import { linkDeviceDevicePair } from "@/lib/unlinkedMirrorPairs";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";

// Khung rà soát "2 luồng THIẾT BỊ-THIẾT BỊ (cả 2 đầu local ADN1) đã có sẵn cả
// 2 phía, khớp đúng thiết bị đích + Trib, nhưng chưa liên kết mirror_of_id"
// (yêu cầu người dùng 2026-08-02, "Còn trường hợp đấu nối giữa 02 thiết bị
// nữa" — tiếp ngay sau UnlinkedMirrorPairsTab.tsx cho device-trunk, xem lib/
// unlinkedMirrorPairs.ts "LOẠI 4" để hiểu đầy đủ). Cùng nguyên tắc an toàn:
// KHÔNG có nút "liên kết hàng loạt", mỗi dòng tự tick xác nhận rồi mới bấm
// "Liên kết" được, % giống tên chỉ để gợi ý độ tin cậy. Cùng tùy chọn đồng bộ
// tên/giao tiếp (mặc định KHÔNG đồng bộ) như bên device-trunk.
export default function UnlinkedDeviceMirrorPairsTab({ items }: { items: UnlinkedDeviceDevicePair[] }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [confirmedKeys, setConfirmedKeys] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkedKeys, setLinkedKeys] = useState<Set<string>>(new Set());
  const [syncChoices, setSyncChoices] = useState<Map<string, "none" | "a" | "b">>(new Map());

  function pairKey(it: UnlinkedDeviceDevicePair) {
    return `${it.circuitAId}|${it.circuitBId}`;
  }

  function syncChoiceOf(key: string): "none" | "a" | "b" {
    return syncChoices.get(key) ?? "none";
  }

  function setSyncChoice(key: string, choice: "none" | "a" | "b") {
    setSyncChoices((prev) => new Map(prev).set(key, choice));
  }

  const remaining = useMemo(() => items.filter((it) => !linkedKeys.has(pairKey(it))), [items, linkedKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remaining;
    return remaining.filter(
      (it) =>
        it.circuitAName.toLowerCase().includes(q) ||
        it.circuitBName.toLowerCase().includes(q) ||
        (it.circuitADeviceName ?? "").toLowerCase().includes(q) ||
        (it.circuitBDeviceName ?? "").toLowerCase().includes(q)
    );
  }, [remaining, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  function toggleConfirm(key: string, checked: boolean) {
    setConfirmedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function handleLink(item: UnlinkedDeviceDevicePair) {
    const key = pairKey(item);
    const choice = syncChoiceOf(key);
    setError(null);
    setBusyKey(key);
    try {
      await linkDeviceDevicePair(item.circuitAId, item.circuitBId, choice === "none" ? undefined : choice);
      setLinkedKeys((prev) => new Set(prev).add(key));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  }

  if (items.length === 0) {
    return <EmptyState text="Không có cặp luồng thiết bị-thiết bị nào khớp Trib nhưng chưa liên kết." />;
  }
  if (remaining.length === 0) {
    return <EmptyState text={`Đã liên kết hết ${items.length} cặp phát hiện được trong lượt tải trang này.`} />;
  }

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
      <h2 className="font-semibold text-sky-800">
        Phát hiện {remaining.length} cặp luồng thiết bị-thiết bị khớp Trib nhưng CHƯA liên kết mirror
      </h2>
      <p className="mt-1 text-xs text-sky-700">
        2 luồng dưới đây (cả 2 đầu đều là thiết bị local ADN1, ở &quot;Hồ sơ đấu nối&quot;) khớp đúng thiết bị đích +
        Trib nhưng được lưu ĐỘC LẬP từ trước, chưa liên kết mirror. <strong>% giống tên chỉ để gợi ý độ tin cậy</strong>,
        bạn tự đối chiếu rồi tick xác nhận từng cặp trước khi bấm &quot;Liên kết&quot;. Sau khi liên kết, xóa 1 bên sẽ
        tự xóa theo bên kia — nếu 2 tên khác hẳn nhau, nhiều khả năng KHÔNG phải cùng luồng, đừng tick.
      </p>
      {error && <p className="mt-1 text-xs text-red-600">Lỗi: {error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-sky-300"
          placeholder="Lọc theo tên luồng / thiết bị..."
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
          const namesDiffer = item.circuitAName.trim() !== item.circuitBName.trim();
          const choice = syncChoiceOf(key);
          return (
            <li key={key} className="rounded border border-sky-200 bg-white px-2 py-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={
                    "shrink-0 rounded px-1.5 py-0.5 text-xs font-medium " +
                    (item.similarity >= 90
                      ? "bg-emerald-100 text-emerald-700"
                      : item.similarity >= 60
                        ? "bg-amber-100 text-amber-700"
                        : "bg-red-100 text-red-700")
                  }
                  title="% giống nhau sau chuẩn hóa tên — chỉ để gợi ý, tự đối chiếu trước khi tick"
                >
                  {item.similarity}% giống tên
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={confirmedKeys.has(key)} onChange={(e) => toggleConfirm(key, e.target.checked)} />
                    Xác nhận là 1 luồng
                  </label>
                  <button
                    type="button"
                    className="btn-secondary shrink-0 px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => handleLink(item)}
                    disabled={!confirmedKeys.has(key) || busyKey === key}
                    title="Chỉ bấm được khi đã tick xác nhận — gắn mirror_of_id (+ đồng bộ tên nếu bạn chọn bên dưới)"
                  >
                    {busyKey === key ? "Đang liên kết..." : "Liên kết"}
                  </button>
                </span>
              </div>
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                <a
                  href={`/odf-device/sua-luong#${rowAnchor(item.circuitAId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-words hover:underline"
                >
                  <span className="text-xs text-sky-500">{item.circuitADeviceName ?? "?"} (Trib {item.circuitATrib ?? "?"}): </span>
                  {item.circuitAName}
                  {item.circuitAInterfaceType && <span className="text-sky-400"> ({item.circuitAInterfaceType})</span>}
                </a>
                <a
                  href={`/odf-device/sua-luong#${rowAnchor(item.circuitBId)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 break-words hover:underline"
                >
                  <span className="text-xs text-sky-500">{item.circuitBDeviceName ?? "?"} (Trib {item.circuitBTrib ?? "?"}): </span>
                  {item.circuitBName}
                  {item.circuitBInterfaceType && <span className="text-sky-400"> ({item.circuitBInterfaceType})</span>}
                </a>
              </div>
              {namesDiffer && (
                <div className="mt-1.5 flex flex-wrap items-center gap-3 rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">
                  <span>2 tên khác nhau — đồng bộ về 1 bên chuẩn?</span>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`sync-${key}`} checked={choice === "none"} onChange={() => setSyncChoice(key, "none")} />
                    Không đồng bộ, giữ nguyên cả 2
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`sync-${key}`} checked={choice === "a"} onChange={() => setSyncChoice(key, "a")} />
                    Dùng tên bên &quot;{item.circuitADeviceName ?? "A"}&quot; cho cả 2
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`sync-${key}`} checked={choice === "b"} onChange={() => setSyncChoice(key, "b")} />
                    Dùng tên bên &quot;{item.circuitBDeviceName ?? "B"}&quot; cho cả 2
                  </label>
                </div>
              )}
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
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
