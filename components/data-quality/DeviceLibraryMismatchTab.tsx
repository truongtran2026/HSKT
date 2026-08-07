"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import type { DeviceCircuitLibraryMismatch } from "@/lib/devicePositionMismatches";
import { applyLibraryFromCircuit, applyCircuitFromLibrary, applyCustomPosition } from "@/lib/devicePositionMismatches";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Khung rà soát "luồng ở Hồ sơ đấu nối lệch tọa độ ODF so với thư viện Vị trí
// thiết bị" (yêu cầu người dùng 2026-08-03, phát hiện qua ca thật ADN1.ADX) —
// đối xứng với TransitPositionMismatchTab.tsx nhưng nguồn lệch là chính luồng
// thiết bị (circuits.device_position_own) thay vì ô "Chuyển tiếp" bên trung
// kế. Cùng triết lý: 2 giá trị NGANG HÀNG, không có lựa chọn mặc định nào
// được tô sẵn — người dùng tự đối chiếu thực tế rồi chọn 1 trong 3 hướng.
export default function DeviceLibraryMismatchTab({ items }: { items: DeviceCircuitLibraryMismatch[] }) {
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [fixedKeys, setFixedKeys] = useState<Set<string>>(new Set());

  const remaining = useMemo(() => items.filter((it) => !fixedKeys.has(it.circuitId)), [items, fixedKeys]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return remaining;
    return remaining.filter(
      (it) =>
        it.deviceName.toLowerCase().includes(q) ||
        it.circuitName.toLowerCase().includes(q) ||
        it.trib.toLowerCase().includes(q)
    );
  }, [remaining, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  if (items.length === 0) {
    return <EmptyState text="Không có luồng thiết bị nào lệch tọa độ ODF so với thư viện Vị trí thiết bị." />;
  }
  if (remaining.length === 0) {
    return <EmptyState text={`Đã xử lý hết ${items.length} dòng phát hiện được trong lượt tải trang này.`} />;
  }

  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
      <h2 className="font-semibold text-rose-800">
        Phát hiện {remaining.length} luồng ở Hồ sơ đấu nối lệch tọa độ ODF so với thư viện Vị trí thiết bị
      </h2>
      <p className="mt-1 text-xs text-rose-700">
        2 tọa độ dưới đây đến từ 2 nguồn ĐỘC LẬP (Hồ sơ đấu nối / thư viện Vị trí thiết bị) — không cái nào chắc chắn
        đúng, tự đối chiếu thực tế rồi chọn 1 trong 3 hướng xử lý.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          className="input w-auto max-w-[260px] border-rose-300"
          placeholder="Lọc theo thiết bị / Trib / tên luồng..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
        <span className="text-xs text-rose-600">
          {filtered.length}/{remaining.length} dòng
        </span>
        <label className="ml-auto flex items-center gap-1 text-xs text-rose-700">
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

      <ul className="mt-2 space-y-2 text-sm text-rose-900">
        {paged.map((item) => (
          <MismatchRow key={item.circuitId} item={item} onDone={() => setFixedKeys((prev) => new Set(prev).add(item.circuitId))} />
        ))}
        {paged.length === 0 && <li className="text-rose-400">Không có dòng nào khớp bộ lọc.</li>}
      </ul>

      {pageCount > 1 && (
        <div className="mt-2 flex items-center gap-2 text-sm text-rose-700">
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

type Choice = "circuit" | "library" | "custom";

function MismatchRow({ item, onDone }: { item: DeviceCircuitLibraryMismatch; onDone: () => void }) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply() {
    if (!choice) return;
    setError(null);
    setBusy(true);
    try {
      if (choice === "circuit") await applyLibraryFromCircuit(supabase, item);
      else if (choice === "library") await applyCircuitFromLibrary(supabase, item);
      else await applyCustomPosition(supabase, item, customValue);
      onDone();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canApply = choice === "custom" ? choice && customValue.trim().length > 0 : !!choice;

  return (
    <li className="rounded border border-rose-200 bg-white px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={`/odf-device/sua-luong#${rowAnchor(item.circuitId)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-rose-500 hover:underline"
          title="Xem luồng này ở Hồ sơ đấu nối (mở tab mới)"
        >
          {item.circuitName || "(chưa đặt tên)"}
        </a>
        <span className="text-xs text-rose-400">
          {item.deviceName} ({item.trib})
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-start gap-4 text-xs">
        <label className="flex items-start gap-1.5">
          <input
            type="radio"
            name={`choice-${item.circuitId}`}
            className="mt-0.5"
            checked={choice === "circuit"}
            onChange={() => setChoice("circuit")}
          />
          <span>
            <span className="text-rose-500">Hồ sơ đấu nối: </span>
            <span className="font-mono">{item.circuitOdfPosition}</span>
            <br />
            <span className="text-slate-400">dùng giá trị này (ghi đè thư viện)</span>
          </span>
        </label>
        <label className="flex items-start gap-1.5">
          <input
            type="radio"
            name={`choice-${item.circuitId}`}
            className="mt-0.5"
            checked={choice === "library"}
            onChange={() => setChoice("library")}
          />
          <span>
            <span className="text-rose-500">Vị trí thiết bị (thư viện): </span>
            <span className="font-mono">{item.libraryOdfPosition}</span>
            <br />
            <span className="text-slate-400">dùng giá trị này (ghi đè Hồ sơ đấu nối)</span>
          </span>
        </label>
        <label className="flex items-start gap-1.5">
          <input
            type="radio"
            name={`choice-${item.circuitId}`}
            className="mt-0.5"
            checked={choice === "custom"}
            onChange={() => setChoice("custom")}
          />
          <span>
            <span className="text-rose-500">Cả 2 đều sai — nhập lại:</span>
            <br />
            <input
              className="input mt-0.5 w-40 py-0.5 text-xs"
              placeholder="VD: ODF 7/9 (41,42)"
              value={customValue}
              onChange={(e) => {
                setCustomValue(e.target.value);
                setChoice("custom");
              }}
            />
          </span>
        </label>
      </div>

      {error && <p className="mt-1 text-xs text-red-600">Lỗi: {error}</p>}

      <div className="mt-1.5">
        <button
          type="button"
          className="btn-secondary px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          onClick={apply}
          disabled={!canApply || busy}
        >
          {busy ? "Đang ghi..." : "Áp dụng"}
        </button>
      </div>
    </li>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{text}</p>;
}
