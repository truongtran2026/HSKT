"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fetchReportHistory, deleteReportHistoryEntry, type ReportHistoryRow } from "@/lib/reportHistory";
import { formatLastUpdated } from "@/lib/format";
import SlideOverPanel from "@/components/ui/SlideOverPanel";

// "Lịch sử tra cứu" dùng CHUNG cho cả Hồ sơ ODF trung kế lẫn Hồ sơ đấu nối
// (yêu cầu người dùng 2026-08-07) — khung trượt mở từ nút trên cả 2 trang,
// không phải trang riêng/không có URL riêng (quyết định người dùng chọn qua
// AskUserQuestion). Tự fetch bằng browser client lúc mở, không cần server-
// fetch riêng ở page.tsx.
export default function ReportHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<ReportHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetchReportHistory(supabase)
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [open]);

  async function copy(row: ReportHistoryRow) {
    await navigator.clipboard.writeText(row.reportText);
    setCopiedId(row.id);
    setTimeout(() => setCopiedId((cur) => (cur === row.id ? null : cur)), 1500);
  }

  async function remove(row: ReportHistoryRow) {
    setBusyId(row.id);
    try {
      await deleteReportHistoryEntry(supabase, row.id);
      setRows((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Lịch sử tra cứu">
      {error && <p className="mb-3 text-sm text-red-600">Lỗi: {error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-400">Đang tải...</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-slate-400">Chưa lưu luồng nào — tick 1 luồng ở Hồ sơ ODF trung kế hoặc Hồ sơ đấu nối rồi bấm "Lưu vào lịch sử".</p>}
      <div className="space-y-3">
        {rows?.map((row) => (
          <div key={row.id} className="rounded-lg border border-slate-200 p-3">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm text-slate-700">{row.reportText}</pre>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>Truy xuất lúc: {formatLastUpdated(row.accessedAt)}</span>
              <div className="flex gap-2">
                <button type="button" className="text-primary-600 hover:underline" onClick={() => copy(row)}>
                  {copiedId === row.id ? "Đã copy!" : "Copy"}
                </button>
                <button type="button" className="text-red-500 hover:underline disabled:opacity-50" disabled={busyId === row.id} onClick={() => remove(row)}>
                  Xóa
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SlideOverPanel>
  );
}
