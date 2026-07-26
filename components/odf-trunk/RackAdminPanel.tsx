"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RackAdminPanel({
  rackId,
  stationId,
  code,
  cableRouteName,
  portCount,
}: {
  rackId: string;
  stationId: string;
  code: string;
  cableRouteName: string | null;
  portCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPortCount, setNewPortCount] = useState(String(portCount));
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockCode, setBlockCode] = useState(`${code} Block ƯC`);
  const [blockPortCount, setBlockPortCount] = useState("24");

  // CHỈ cho tăng số port (an toàn — chỉ thêm port mới, không đụng port cũ).
  // Giảm số port có thể xóa mất dữ liệu luồng thật, không làm ở đây — cần
  // sửa tay trực tiếp trong Supabase nếu thực sự cần giảm.
  async function growPorts() {
    const target = Number(newPortCount);
    if (!Number.isInteger(target) || target <= portCount) {
      setError(`Số port mới phải là số nguyên lớn hơn ${portCount}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const rows = [];
      for (let n = portCount + 1; n <= target; n++) {
        rows.push({ rack_id: rackId, port_number: n, fiber_number: n, medium: "fiber" as const, status: "unused" as const });
      }
      const { error: portErr } = await supabase.from("ports").insert(rows);
      if (portErr) throw portErr;
      const { error: rackErr } = await supabase.from("racks").update({ port_count: target }).eq("id", rackId);
      if (rackErr) throw rackErr;
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Block ƯC = block phân phối gắn thêm vào rack hàn nối (architecture.md
  // mục 3.2 parent_rack_id). Tạo như 1 rack con riêng, có port/mã số riêng.
  async function createBlockUC() {
    const count = Number(blockPortCount);
    if (!blockCode.trim() || !Number.isInteger(count) || count <= 0) {
      setError("Nhập mã Block ƯC và số port hợp lệ (số nguyên dương).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data: newRack, error: rackErr } = await supabase
        .from("racks")
        .insert({
          station_id: stationId,
          code: blockCode.trim(),
          domain: "trunk",
          odf_type: "distribution",
          parent_rack_id: rackId,
          port_count: count,
          cable_route_name: cableRouteName,
        })
        .select("id")
        .single();
      if (rackErr) throw rackErr;
      const newRackId = newRack.id as string;
      const rows = Array.from({ length: count }, (_, i) => ({
        rack_id: newRackId,
        port_number: i + 1,
        fiber_number: i + 1,
        medium: "fiber" as const,
        status: "unused" as const,
      }));
      const { error: portErr } = await supabase.from("ports").insert(rows);
      if (portErr) throw portErr;
      router.push(`/odf-trunk/${newRackId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
      {error && <p className="mb-2 text-red-600">Lỗi: {error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-500">Số port hiện tại: {portCount}.</span>
        <input
          type="number"
          className="input w-24"
          value={newPortCount}
          min={portCount + 1}
          onChange={(e) => setNewPortCount(e.target.value)}
        />
        <button className="btn-secondary" onClick={growPorts} disabled={busy}>
          Thêm port (tăng lên số này)
        </button>
        <span className="mx-1 text-slate-300">|</span>
        <button className="btn-secondary" onClick={() => setShowBlockForm((v) => !v)} disabled={busy}>
          {showBlockForm ? "Ẩn form Block ƯC" : "+ Thêm Block ƯC"}
        </button>
      </div>

      {showBlockForm && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
          <label className="text-sm">
            <span className="block text-slate-500 mb-1">Mã Block ƯC</span>
            <input className="input" value={blockCode} onChange={(e) => setBlockCode(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="block text-slate-500 mb-1">Số port</span>
            <input type="number" className="input w-24" value={blockPortCount} onChange={(e) => setBlockPortCount(e.target.value)} />
          </label>
          <button className="btn-primary" onClick={createBlockUC} disabled={busy}>
            Tạo Block ƯC
          </button>
        </div>
      )}
    </div>
  );
}
