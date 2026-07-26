"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import SortableTh from "@/components/ui/SortableTh";
import FilterInput from "@/components/ui/FilterInput";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";

type SortKey = "deviceName" | "devicePosition" | "odfPosition";

function cellText(r: DevicePositionMapRow, key: SortKey): string | null {
  switch (key) {
    case "deviceName":
      return r.deviceName;
    case "devicePosition":
      return r.devicePosition;
    case "odfPosition":
      return r.odfPosition;
  }
}

function compareByKey(key: SortKey, a: DevicePositionMapRow, b: DevicePositionMapRow): number {
  return compareValues(cellText(a, key), cellText(b, key));
}

interface Draft {
  deviceName: string;
  devicePosition: string;
  odfPosition: string;
}

const EMPTY_DRAFT: Draft = { deviceName: "", devicePosition: "", odfPosition: "" };

export default function DevicePositionMapClient({
  rows,
  deviceNameOptions,
}: {
  rows: DevicePositionMapRow[];
  deviceNameOptions: string[];
}) {
  const router = useRouter();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("deviceName");
  const [filters, setFilters] = useState<Record<SortKey, string>>({ deviceName: "", devicePosition: "", odfPosition: "" });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const odfPositionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.odfPosition) set.add(r.odfPosition);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const list = rows.filter(
      (r) =>
        matchesFilter(r.deviceName, filters.deviceName) &&
        matchesFilter(r.devicePosition, filters.devicePosition) &&
        matchesFilter(r.odfPosition, filters.odfPosition)
    );
    const arr = [...list].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [rows, filters, sortKey, sortDir]);

  async function addRow() {
    if (!draft.deviceName.trim()) {
      setError("Tên thiết bị không được để trống.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("device_position_map").insert({
      device_name: draft.deviceName.trim(),
      device_position: draft.devicePosition.trim() || null,
      odf_position: draft.odfPosition.trim() || null,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDraft(EMPTY_DRAFT);
    router.refresh();
  }

  function openEdit(r: DevicePositionMapRow) {
    setEditId(r.id);
    setEditDraft({ deviceName: r.deviceName, devicePosition: r.devicePosition ?? "", odfPosition: r.odfPosition ?? "" });
    setError(null);
  }

  function cancelEdit() {
    setEditId(null);
    setError(null);
  }

  async function saveEdit() {
    if (!editId) return;
    if (!editDraft.deviceName.trim()) {
      setError("Tên thiết bị không được để trống.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("device_position_map")
      .update({
        device_name: editDraft.deviceName.trim(),
        device_position: editDraft.devicePosition.trim() || null,
        odf_position: editDraft.odfPosition.trim() || null,
      })
      .eq("id", editId);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditId(null);
    router.refresh();
  }

  async function deleteRow(r: DevicePositionMapRow) {
    if (!confirm(`Xóa dòng "${r.deviceName}" — "${r.devicePosition ?? ""}" — "${r.odfPosition ?? ""}"?`)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("device_position_map").delete().eq("id", r.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}

      <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
        <p className="text-sm font-medium text-primary-800 mb-2">Thêm dòng mới</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="input w-auto max-w-[220px]"
            list="dpm-device-name-options"
            placeholder="Tên thiết bị"
            value={draft.deviceName}
            onChange={(e) => setDraft({ ...draft, deviceName: e.target.value })}
          />
          <datalist id="dpm-device-name-options">
            {deviceNameOptions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <input
            className="input w-auto max-w-[220px]"
            placeholder="Vị trí thiết bị"
            value={draft.devicePosition}
            onChange={(e) => setDraft({ ...draft, devicePosition: e.target.value })}
          />
          <input
            className="input w-auto max-w-[220px]"
            list="dpm-odf-position-options"
            placeholder="Vị trí ODF/DDF"
            value={draft.odfPosition}
            onChange={(e) => setDraft({ ...draft, odfPosition: e.target.value })}
          />
          <datalist id="dpm-odf-position-options">
            {odfPositionOptions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <button className="btn-primary" onClick={addRow} disabled={busy}>
            Thêm
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-500 mb-2">
        {filtered.length}/{rows.length} dòng
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <SortableTh label="Tên thiết bị" sortKey="deviceName" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Vị trí thiết bị" sortKey="devicePosition" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Vị trí ODF/DDF" sortKey="odfPosition" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <th className="px-4 py-2 text-left font-semibold">Thao tác</th>
            </tr>
            <tr className="bg-white">
              <th className="px-2 py-1">
                <FilterInput value={filters.deviceName} onChange={(v) => setFilter("deviceName", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.devicePosition} onChange={(v) => setFilter("devicePosition", v)} />
              </th>
              <th className="px-2 py-1">
                <FilterInput value={filters.odfPosition} onChange={(v) => setFilter("odfPosition", v)} />
              </th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const editing = editId === r.id;
              return (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-primary-50/50">
                  {editing ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dpm-device-name-options"
                          value={editDraft.deviceName}
                          onChange={(e) => setEditDraft({ ...editDraft, deviceName: e.target.value })}
                          autoFocus
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          value={editDraft.devicePosition}
                          onChange={(e) => setEditDraft({ ...editDraft, devicePosition: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dpm-odf-position-options"
                          value={editDraft.odfPosition}
                          onChange={(e) => setEditDraft({ ...editDraft, odfPosition: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button className="btn-primary" onClick={saveEdit} disabled={busy}>
                            Lưu
                          </button>
                          <button className="btn-secondary" onClick={cancelEdit} disabled={busy}>
                            Hủy
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 text-slate-700">{r.deviceName}</td>
                      <td className="px-4 py-2 text-slate-600">{r.devicePosition ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{r.odfPosition ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button className="text-primary-600 hover:underline" onClick={() => openEdit(r)} disabled={busy}>
                            Sửa
                          </button>
                          <button className="text-red-600 hover:underline" onClick={() => deleteRow(r)} disabled={busy}>
                            Xóa
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Chưa có dòng nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
