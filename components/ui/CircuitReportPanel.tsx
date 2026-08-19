"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { upsertReportHistory } from "@/lib/reportHistory";
import RoleGate from "@/components/ui/RoleGate";

export interface CircuitReportItem {
  /** circuit id — dùng luôn làm khóa lưu report_history.circuit_id. */
  key: string;
  text: string;
}

// Số đoạn text hiện tối đa mỗi "trang" trong khung (yêu cầu người dùng
// 2026-08-19: tick chọn nhiều luồng thì mỗi luồng sinh 1 đoạn, tick quá nhiều
// chiếm hết khung — chỉ hiện 3 đoạn/trang, còn lại chuyển trang xem tiếp).
const PAGE_SIZE = 3;

// Khung xem trước đoạn text đã sinh cho các luồng đang tick — GỘP nhiều luồng
// thành 1 danh sách (quyết định người dùng 2026-08-07, không chỉ giữ luồng
// tick gần nhất) — dùng chung cho cả PortTable.tsx (Hồ sơ ODF trung kế) và
// DeviceCircuitList.tsx (Hồ sơ đấu nối). Mỗi dòng có nút Copy riêng + tick
// "Lưu vào lịch sử" (chỉ lưu khi tick, không tự lưu khi vừa tick chọn luồng).
export default function CircuitReportPanel({ items }: { items: CircuitReportItem[] }) {
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Trang đang xem TRONG KHUNG này (khác hẳn phân trang của bảng chính) — 1
  // luồng mới tick luôn được thêm vào CUỐI danh sách (Set giữ thứ tự chèn),
  // nên không cần tự reset về trang 1 mỗi lần tick thêm: trang đang xem vẫn
  // đúng nội dung cũ, chỉ sinh thêm trang mới ở cuối nếu cần.
  const [page, setPage] = useState(1);

  if (items.length === 0) return null;

  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
  }

  // Copy TOÀN BỘ đoạn text đã sinh — kể cả các trang KHÔNG đang hiển thị
  // (dùng thẳng `items` đầy đủ, không phải `pageItems`) — đánh số thứ tự
  // "1/ ... 2/ ..." trước mỗi đoạn, cách nhau 1 dòng trống (yêu cầu người
  // dùng 2026-08-19).
  async function copyAll() {
    await navigator.clipboard.writeText(items.map((i, idx) => `${idx + 1}/ ${i.text}`).join("\n\n"));
    setCopiedKey("__all__");
    setTimeout(() => setCopiedKey((cur) => (cur === "__all__" ? null : cur)), 1500);
  }

  async function toggleSave(item: CircuitReportItem) {
    if (savedIds.has(item.key)) return;
    setBusyId(item.key);
    setError(null);
    try {
      await upsertReportHistory(supabase, item.key, item.text);
      setSavedIds((prev) => new Set(prev).add(item.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary-800">Đoạn text đã sinh ({items.length} luồng)</h3>
        <button type="button" className="btn-secondary text-xs" onClick={copyAll}>
          {copiedKey === "__all__" ? "Đã copy!" : "Copy tất cả"}
        </button>
      </div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}
      <div className="space-y-2">
        {pageItems.map((item) => (
          <div key={item.key} className="rounded-md border border-slate-200 bg-white p-2">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700">{item.text}</pre>
            <div className="mt-1 flex items-center gap-4 text-xs">
              <button type="button" className="text-primary-600 hover:underline" onClick={() => copy(item.text, item.key)}>
                {copiedKey === item.key ? "Đã copy!" : "Copy"}
              </button>
              <RoleGate allow={["operator", "admin"]}>
                <label className="flex items-center gap-1 text-slate-600">
                  <input
                    type="checkbox"
                    checked={savedIds.has(item.key)}
                    disabled={busyId === item.key || savedIds.has(item.key)}
                    onChange={() => toggleSave(item)}
                  />
                  Lưu vào lịch sử
                </label>
              </RoleGate>
            </div>
          </div>
        ))}
      </div>
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-slate-600">
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
            disabled={currentPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Trước
          </button>
          <span>
            Trang {currentPage}/{pageCount}
          </span>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-2 py-0.5 hover:bg-slate-50 disabled:opacity-40"
            disabled={currentPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Sau ›
          </button>
        </div>
      )}
    </div>
  );
}
