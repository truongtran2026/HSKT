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

  if (items.length === 0) return null;

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
  }

  async function copyAll() {
    await navigator.clipboard.writeText(items.map((i) => i.text).join("\n\n"));
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
        {items.map((item) => (
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
    </div>
  );
}
