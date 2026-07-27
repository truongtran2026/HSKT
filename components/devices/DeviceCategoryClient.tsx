"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import { deviceCategoryLabel } from "@/lib/devices";
import { syncDevicePositionMapNames } from "@/lib/devicePositionMap";
import SortableTh from "@/components/ui/SortableTh";
import FilterInput from "@/components/ui/FilterInput";
import type { DeviceRow } from "@/lib/devices";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

type SortKey = "name" | "category" | "source";

function cellText(d: DeviceRow, key: SortKey): string {
  switch (key) {
    case "name":
      return d.name;
    case "category":
      return deviceCategoryLabel(d.category);
    case "source":
      return d.source;
  }
}

const SOURCE_LABEL: Record<DeviceRow["source"], string> = {
  auto: "Tự sinh",
  manual: "Nhập tay",
};

// Chữ nhỏ dưới tên thiết bị — KHÔNG làm cột riêng (yêu cầu người dùng
// 2026-07-27: 1 thiết bị có thể chuẩn hóa nhiều lần, muốn biết lần cuối khi
// nào nhưng đừng thêm cột cho rối bảng).
function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface RawVariant {
  text: string;
  count: number;
}

// Nhóm CÁC LUỒNG CHƯA gán thiết bị (circuit.deviceId === null) theo tên gốc
// lấy từ ghi chú — trước đây xử lý ở trang riêng "/odf-device/chuan-hoa",
// nay gộp thẳng vào đây (yêu cầu người dùng 2026-07-27: 1 tab đủ, "Chuẩn
// hóa thiết bị" tách riêng "Danh mục thiết bị" không hợp lý vì đều là chuẩn
// hóa thiết bị cả). Thiết bị ĐÃ có (circuit.deviceId khác null) không cần
// nhóm nữa — sửa tên/gộp trực tiếp trên bảng chính bên dưới bằng tick chọn.
interface PendingGroup {
  key: string;
  variants: RawVariant[];
  circuitIds: string[];
}

function buildPendingGroups(circuits: DeviceCircuitRow[]): PendingGroup[] {
  const map = new Map<string, PendingGroup>();
  for (const c of circuits) {
    if (c.deviceId || !c.deviceName) continue;
    const raw = c.deviceName.trim();
    const key = normalizeDeviceNameKey(raw);
    if (!key) continue;
    let g = map.get(key);
    if (!g) {
      g = { key, variants: [], circuitIds: [] };
      map.set(key, g);
    }
    g.circuitIds.push(c.id);
    const v = g.variants.find((item) => item.text === raw);
    if (v) v.count += 1;
    else g.variants.push({ text: raw, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.circuitIds.length - a.circuitIds.length);
}

function bestVariantText(g: PendingGroup): string {
  return [...g.variants].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))[0]?.text ?? "";
}

export default function DeviceCategoryClient({
  devices,
  circuits,
  stationId,
}: {
  devices: DeviceRow[];
  circuits: DeviceCircuitRow[];
  stationId: string;
}) {
  const router = useRouter();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  const [search, setSearch] = useState("");
  // Tick giữ nguyên qua mọi lượt đổi lĩnh vực/tìm kiếm — tập id độc lập,
  // không phụ thuộc danh sách đang hiển thị (cùng bài học đã sửa ở
  // DeviceCircuitList: đổi bộ lọc không được xóa tick đã chọn).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkRename, setBulkRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingOpen, setPendingOpen] = useState(true);
  const [pendingNameOverrides, setPendingNameOverrides] = useState<Record<string, string>>({});
  const [pendingBusyKey, setPendingBusyKey] = useState<string | null>(null);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) set.add(deviceCategoryLabel(d.category));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [devices]);

  // Gợi ý khi gán hàng loạt: chỉ lĩnh vực THẬT đã dùng (không gồm nhãn
  // "Chưa phân loại") — để trống ô gán mới là "bỏ phân loại" (set NULL).
  const realCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) if (d.category) set.add(d.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [devices]);

  const deviceNameOptions = useMemo(() => devices.map((d) => d.name).sort((a, b) => a.localeCompare(b)), [devices]);

  const pendingGroups = useMemo(() => buildPendingGroups(circuits), [circuits]);

  function toggleCategory(cat: string) {
    setCategoryFilter((prev) => {
      if (prev === null) return [cat];
      if (prev.includes(cat)) {
        const next = prev.filter((c) => c !== cat);
        return next.length === 0 ? null : next;
      }
      return [...prev, cat];
    });
  }

  function resetCategory() {
    setCategoryFilter(null);
  }

  const filtered = useMemo(() => {
    let list = devices;
    if (categoryFilter !== null) {
      const set = new Set(categoryFilter);
      list = list.filter((d) => set.has(deviceCategoryLabel(d.category)));
    }
    list = list.filter((d) => matchesFilter(d.name, search));
    const arr = [...list].sort((a, b) => compareValues(cellText(a, sortKey), cellText(b, sortKey)));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [devices, categoryFilter, search, sortKey, sortDir]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of filtered) next.add(d.id);
      return next;
    });
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const d of filtered) next.delete(d.id);
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  const selectedDevices = useMemo(() => devices.filter((d) => selected.has(d.id)), [devices, selected]);

  async function applyBulkCategory() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    const newCategory = bulkCategory.trim() || null;
    const ids = [...selected];
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = ids.slice(i, i + chunkSize);
      const { error: err } = await supabase.from("devices").update({ category: newCategory }).in("id", batch);
      if (err) {
        setBusy(false);
        setError(err.message);
        return;
      }
    }
    setBusy(false);
    setBulkCategory("");
    setSelected(new Set());
    router.refresh();
  }

  // Đổi tên 1 thiết bị đã tick, HOẶC gộp NHIỀU thiết bị đã tick làm 1 (yêu
  // cầu người dùng 2026-07-27: "danh mục thiết bị tôi vẫn edit được tên
  // thiết bị mà" — làm hẳn tính năng đó ở đây, không cần trang "Chuẩn hóa
  // thiết bị" riêng nữa). Tick đúng 1 thiết bị + gõ tên mới -> đổi tên tại
  // chỗ. Tick từ 2 thiết bị trở lên -> gộp: toàn bộ luồng của các thiết bị
  // kia chuyển sang 1 thiết bị "đích" (thiết bị đã có tên trùng tên gõ, nếu
  // không có thì lấy luôn thiết bị đầu tiên trong danh sách tick làm đích và
  // đổi tên nó), các thiết bị còn lại bị xóa vì không còn luồng nào dùng.
  async function applyBulkRename() {
    if (selected.size === 0) return;
    const targetName = bulkRename.trim();
    if (!targetName) {
      setError("Nhập tên thiết bị muốn đổi/gộp thành.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const targetKey = normalizeDeviceNameKey(targetName);
      const matchedExisting = devices.find((d) => normalizeDeviceNameKey(d.name) === targetKey && !selected.has(d.id));

      let targetId: string;
      let finalName: string;
      if (matchedExisting) {
        targetId = matchedExisting.id;
        finalName = matchedExisting.name;
      } else if (selectedDevices.length === 1) {
        const { error: updErr } = await supabase.from("devices").update({ name: targetName }).eq("id", selectedDevices[0].id);
        if (updErr) throw updErr;
        targetId = selectedDevices[0].id;
        finalName = targetName;
      } else {
        // Gộp nhiều thiết bị, chưa ai trùng tên gõ -> lấy thiết bị đầu tiên
        // đã tick làm đích, đổi tên nó thành tên gõ (đỡ phải tạo dòng mới).
        const first = selectedDevices[0];
        const { error: updErr } = await supabase.from("devices").update({ name: targetName }).eq("id", first.id);
        if (updErr) throw updErr;
        targetId = first.id;
        finalName = targetName;
      }

      const oldNames = selectedDevices.map((d) => d.name);
      for (const d of selectedDevices) {
        if (d.id === targetId) continue;
        const { error: relinkErr } = await supabase.from("circuits").update({ device_id: targetId }).eq("device_id", d.id);
        if (relinkErr) throw relinkErr;
        const { error: delErr } = await supabase.from("devices").delete().eq("id", d.id);
        if (delErr) throw delErr;
      }

      try {
        await syncDevicePositionMapNames(oldNames, finalName);
      } catch (syncErr) {
        setError(
          `Đã đổi tên/gộp xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          }`
        );
      }

      setSelected(new Set());
      setBulkRename("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Giải quyết 1 nhóm luồng CHƯA có thiết bị: map vào thiết bị đã có (theo
  // đúng tên gõ) hoặc tạo thiết bị mới — luôn đồng bộ luôn thư viện "Vị trí
  // thiết bị" theo mọi biến thể tên gốc của nhóm.
  async function applyPendingGroup(g: PendingGroup) {
    const targetName = (pendingNameOverrides[g.key] ?? bestVariantText(g)).trim();
    if (!targetName) {
      setError("Tên thiết bị không được để trống.");
      return;
    }
    setPendingBusyKey(g.key);
    setError(null);
    try {
      const targetKey = normalizeDeviceNameKey(targetName);
      const matched = devices.find((d) => normalizeDeviceNameKey(d.name) === targetKey);
      let deviceId: string;
      let finalName: string;
      if (matched) {
        deviceId = matched.id;
        finalName = matched.name;
      } else {
        const { data, error: insErr } = await supabase
          .from("devices")
          .insert({ station_id: stationId, name: targetName, source: "auto" })
          .select("id, name")
          .single();
        if (insErr) throw new Error(insErr.message);
        deviceId = data.id as string;
        finalName = data.name as string;
      }

      const results = await Promise.all(
        g.circuitIds.map((id) => supabase.from("circuits").update({ device_id: deviceId }).eq("id", id))
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(failed.error.message);

      try {
        await syncDevicePositionMapNames(g.variants.map((v) => v.text), finalName);
      } catch (syncErr) {
        setError(
          `Đã gán thiết bị xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          }`
        );
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingBusyKey(null);
    }
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}

      <datalist id="device-category-options">
        {realCategoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="device-name-options">
        {deviceNameOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {pendingGroups.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-amber-800">
              Luồng thiết bị chưa gán thiết bị chuẩn ({pendingGroups.length} tên khác nhau,{" "}
              {pendingGroups.reduce((s, g) => s + g.circuitIds.length, 0)} luồng)
            </p>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setPendingOpen((v) => !v)}>
              {pendingOpen ? "Ẩn" : "Mở"}
            </button>
          </div>
          {pendingOpen && (
            <>
              <p className="mt-2 text-xs text-amber-700">
                Mỗi dòng là 1 tên thiết bị gốc lấy từ ghi chú, gộp sẵn các luồng cùng tên. Sửa thành tên thiết bị đã
                chuẩn (có gợi ý) rồi bấm Áp dụng — nếu tên đó chưa có, hệ thống tạo thiết bị mới; nếu trùng tên 1
                thiết bị đã có, toàn bộ luồng trong nhóm sẽ gắn vào đúng thiết bị đó.
              </p>
              <div className="mt-3 space-y-2">
                {pendingGroups.map((g) => (
                  <div key={g.key} className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-2">
                    <input
                      className="input w-auto max-w-[260px]"
                      list="device-name-options"
                      value={pendingNameOverrides[g.key] ?? bestVariantText(g)}
                      onChange={(e) => setPendingNameOverrides((prev) => ({ ...prev, [g.key]: e.target.value }))}
                    />
                    <button
                      className="btn-primary px-3 py-1 text-xs"
                      onClick={() => applyPendingGroup(g)}
                      disabled={pendingBusyKey !== null}
                    >
                      {pendingBusyKey === g.key ? "Đang lưu..." : "Áp dụng"}
                    </button>
                    <span className="text-sm text-slate-500">{g.circuitIds.length} luồng</span>
                    <span className="text-xs text-slate-400">
                      Biến thể: {g.variants.map((v) => `${v.text} (${v.count})`).join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Lĩnh vực</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={resetCategory}
            className={
              "rounded-full border px-3 py-1.5 text-sm " +
              (categoryFilter === null
                ? "border-primary-600 bg-primary-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
            }
          >
            Tất cả
          </button>
          {categoryOptions.map((cat) => {
            const active = categoryFilter === null || categoryFilter.includes(cat);
            return (
              <button
                key={cat}
                type="button"
                onClick={() => toggleCategory(cat)}
                className={
                  "rounded-full border px-3 py-1.5 text-sm " +
                  (active
                    ? "border-primary-600 bg-primary-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="w-64">
          <FilterInput value={search} onChange={setSearch} placeholder="Tìm theo tên thiết bị..." />
        </div>
        <p className="text-sm text-slate-500">
          {filtered.length}/{devices.length} thiết bị · đã chọn {selected.size}
        </p>
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={selectAllVisible}>
          Chọn tất cả đang hiện
        </button>
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={clearVisible}>
          Bỏ chọn đang hiện
        </button>
        {selected.size > 0 && (
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={clearAll}>
            Bỏ chọn tất cả ({selected.size})
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-4 space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm font-medium text-primary-800 sm:w-auto">
              Đã chọn {selected.size} thiết bị — gán/đổi lĩnh vực:
            </p>
            <input
              className="input w-auto max-w-[220px]"
              list="device-category-options"
              placeholder="Để trống = bỏ phân loại"
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
            />
            <button className="btn-primary" onClick={applyBulkCategory} disabled={busy}>
              {busy ? "Đang lưu..." : "Áp dụng"}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="w-full text-sm font-medium text-primary-800 sm:w-auto">
              {selected.size === 1 ? "Đổi tên thiết bị này thành:" : `Gộp ${selected.size} thiết bị đã chọn thành 1, tên:`}
            </p>
            <input
              className="input w-auto max-w-[260px]"
              list="device-name-options"
              placeholder={selected.size === 1 ? "Tên mới" : "Tên chung sau khi gộp"}
              value={bulkRename}
              onChange={(e) => setBulkRename(e.target.value)}
            />
            <button className="btn-primary" onClick={applyBulkRename} disabled={busy}>
              {busy ? "Đang lưu..." : "Áp dụng"}
            </button>
          </div>
          {selected.size > 1 && (
            <p className="text-xs text-primary-700">
              Gộp sẽ chuyển toàn bộ luồng của {selected.size - 1} thiết bị còn lại sang thiết bị đích rồi xóa các
              thiết bị không còn dùng — không thể hoàn tác.
            </p>
          )}
        </div>
      )}

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-primary-50 text-primary-800">
            <tr>
              <th className="px-4 py-2 font-semibold">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearVisible())}
                  title="Chọn/bỏ chọn tất cả đang hiện"
                />
              </th>
              <SortableTh label="Tên thiết bị" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Lĩnh vực" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
              <SortableTh label="Nguồn" sortKey="source" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr
                key={d.id}
                className={`border-t border-slate-100 ${selected.has(d.id) ? "bg-primary-50/60" : "hover:bg-primary-50/50"}`}
              >
                <td className="px-4 py-2">
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {d.name}
                  <div className="text-xs text-slate-400">Cập nhật lần cuối: {formatLastUpdated(d.updatedAt)}</div>
                </td>
                <td className="px-4 py-2 text-slate-600">{deviceCategoryLabel(d.category)}</td>
                <td className="px-4 py-2 text-slate-500">{SOURCE_LABEL[d.source]}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy thiết bị nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
