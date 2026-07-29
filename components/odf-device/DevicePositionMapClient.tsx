"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import { deviceCategoryLabel, getAdn1StationId, UNCATEGORIZED_LABEL } from "@/lib/devices";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { matchTrunkPosition, formatCanonicalOdfPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import ResizableTh from "@/components/ui/ResizableTh";
import FilterInput from "@/components/ui/FilterInput";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";
import type { DeviceRow } from "@/lib/devices";

type SortKey = "deviceName" | "devicePosition" | "odfPosition";

// Cả 3 cột dữ liệu đều có thể dài (yêu cầu người dùng 2026-07-27: "các bảng
// dữ liệu đều" kéo dãn được) — chỉ "Thao tác" (nút bấm) giữ cố định.
const DEFAULT_COL_WIDTHS: Record<SortKey, number> = { deviceName: 220, devicePosition: 180, odfPosition: 200 };

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
  devices,
  trunkPorts,
}: {
  rows: DevicePositionMapRow[];
  devices: DeviceRow[];
  trunkPorts: TrunkPortRow[];
}) {
  const router = useRouter();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("deviceName");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<SortKey>("device-position-map-col-widths", DEFAULT_COL_WIDTHS);
  const [filters, setFilters] = useState<Record<SortKey, string>>({ deviceName: "", devicePosition: "", odfPosition: "" });
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cảnh báo khi dòng vừa Thêm bị CHÍNH bộ lọc/lĩnh vực đang chọn ẩn mất khỏi
  // bảng ngay sau khi lưu — lỗi thực tế gặp phải 2026-07-29 (tưởng bấm Thêm
  // không có tác dụng, thật ra dữ liệu đã lưu đúng, chỉ là đang bị lọc ẩn).
  // Không tự ý xóa bộ lọc thay người dùng (có thể họ đang cố tình lọc theo 1
  // lĩnh vực để thêm liên tiếp nhiều dòng cùng loại) — chỉ báo rõ + có nút để
  // tự bỏ lọc nếu muốn xem ngay.
  const [addHiddenNotice, setAddHiddenNotice] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  // Mặc định MỞ SẴN (không thu gọn) — người dùng phản hồi 2026-07-27: bấm
  // lọc "Chưa phân loại" ở khung Lĩnh vực chỉ lọc bảng bên dưới, không liên
  // quan gì tới khung này, nên nếu thu gọn sẵn thì không biết chỗ nào để
  // tick chọn/chuẩn hóa tên. Vẫn giữ nút Ẩn để gọn lại sau khi dùng xong.
  const [standardizeOpen, setStandardizeOpen] = useState(true);
  const [renameSelected, setRenameSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState("");
  const [renameCategory, setRenameCategory] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const deviceNameOptions = useMemo(() => devices.map((d) => d.name), [devices]);

  const realCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) if (d.category) set.add(d.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [devices]);

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setAddHiddenNotice(null);
  }

  const odfPositionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.odfPosition) set.add(r.odfPosition);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  // Lĩnh vực của 1 dòng thư viện: tra theo tên thiết bị (chuẩn hóa, bỏ tiền
  // tố "ADN1."/khoảng trắng thừa — xem lib/deviceNotes.ts) đối chiếu với bảng
  // devices thật. device_position_map.device_name là text tự do nên không
  // phải dòng nào cũng khớp được — dòng không khớp rơi vào "Chưa phân loại",
  // đúng là chưa xác định được chứ không phải lỗi.
  const categoryByDeviceKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) map.set(normalizeDeviceNameKey(d.name), deviceCategoryLabel(d.category));
    return map;
  }, [devices]);

  function rowCategory(r: DevicePositionMapRow): string {
    return categoryByDeviceKey.get(normalizeDeviceNameKey(r.deviceName)) ?? UNCATEGORIZED_LABEL;
  }

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(rowCategory(r));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [rows, categoryByDeviceKey]);

  const existingDeviceKeys = useMemo(() => new Set(devices.map((d) => normalizeDeviceNameKey(d.name))), [devices]);

  // Nhóm các dòng có tên thiết bị KHÔNG khớp bảng devices thật (nguyên nhân
  // chính khiến 1 dòng rơi vào "Chưa phân loại" — yêu cầu người dùng
  // 2026-07-27: tên lấy từ ghi chú nên chưa đồng bộ với tên đã chuẩn hóa).
  // Gộp theo khóa chuẩn hóa để 1 lần "Áp dụng" sửa được HÀNG LOẠT dòng cùng
  // tên, thay vì phải sửa từng dòng trib/port riêng lẻ.
  interface UnmatchedGroup {
    key: string;
    variants: { text: string; count: number }[];
    rows: DevicePositionMapRow[];
  }
  const unmatchedGroups = useMemo(() => {
    const map = new Map<string, UnmatchedGroup>();
    for (const r of rows) {
      const key = normalizeDeviceNameKey(r.deviceName);
      if (existingDeviceKeys.has(key)) continue;
      let g = map.get(key);
      if (!g) {
        g = { key, variants: [], rows: [] };
        map.set(key, g);
      }
      g.rows.push(r);
      const raw = r.deviceName.trim();
      const v = g.variants.find((item) => item.text === raw);
      if (v) v.count += 1;
      else g.variants.push({ text: raw, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length);
  }, [rows, existingDeviceKeys]);
  const unmatchedRowCount = useMemo(() => unmatchedGroups.reduce((sum, g) => sum + g.rows.length, 0), [unmatchedGroups]);

  // "Chưa phân loại" có 2 NGUYÊN NHÂN KHÁC NHAU, dễ nhầm (phát hiện thực tế
  // 2026-07-27 — người dùng chuẩn hóa xong tên qua khung trên nhưng vẫn thấy
  // dòng "Chưa phân loại", vì tên đã khớp đúng thiết bị rồi nhưng CHÍNH thiết
  // bị đó lại chưa được gán lĩnh vực): (1) tên chưa khớp thiết bị nào — sửa ở
  // khung "Chuẩn hóa tên thiết bị chưa khớp" bên trên; (2) tên ĐÃ khớp đúng 1
  // thiết bị thật nhưng thiết bị đó chưa có lĩnh vực — phải sang trang "Danh
  // mục thiết bị" (/devices) gán, sửa tên ở đây không giải quyết được.
  const categorylessMatchedDevices = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const key = normalizeDeviceNameKey(r.deviceName);
      if (existingDeviceKeys.has(key) && rowCategory(r) === UNCATEGORIZED_LABEL) set.add(key);
    }
    return set.size;
  }, [rows, existingDeviceKeys, categoryByDeviceKey]);

  function toggleRenameSelect(key: string) {
    setRenameSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // "Áp dụng" dùng cho cả 2 tình huống người dùng nêu: (1) map về 1 thiết bị
  // ĐÃ chuẩn hóa có sẵn — dùng đúng chữ viết chuẩn của thiết bị đó, tránh tạo
  // thêm 1 biến thể tên khác; sửa kèm lĩnh vực nếu gõ khác lĩnh vực hiện tại.
  // (2) gõ tên chưa từng có -> hỏi xác nhận tạo devices mới (cùng cơ chế với
  // maybeCreateCounterpartDevice ở DeviceCircuitList.tsx) rồi mới đổi tên
  // hàng loạt các dòng đã chọn về đúng tên đó.
  async function applyRenameGroups() {
    const target = renameTarget.trim();
    if (!target) {
      setRenameError("Nhập tên thiết bị chuẩn trước khi áp dụng.");
      return;
    }
    if (renameSelected.size === 0) return;
    setRenameBusy(true);
    setRenameError(null);
    try {
      const targetKey = normalizeDeviceNameKey(target);
      const existingMatch = devices.find((d) => normalizeDeviceNameKey(d.name) === targetKey);
      let finalName = target;
      if (existingMatch) {
        finalName = existingMatch.name;
        const newCategory = renameCategory.trim();
        if (newCategory && newCategory !== (existingMatch.category ?? "")) {
          const { error: catErr } = await supabase.from("devices").update({ category: newCategory }).eq("id", existingMatch.id);
          if (catErr) throw catErr;
        }
      } else {
        if (!confirm(`Chưa có thiết bị "${target}" trong hệ thống.\n\nTạo mới thiết bị này?`)) {
          setRenameBusy(false);
          return;
        }
        const stationId = await getAdn1StationId();
        const { error: insErr } = await supabase
          .from("devices")
          .insert({ station_id: stationId, name: target, category: renameCategory.trim() || null, source: "manual" });
        if (insErr) throw insErr;
      }

      const groupsToApply = unmatchedGroups.filter((g) => renameSelected.has(g.key));
      const ids = groupsToApply.flatMap((g) => g.rows.map((r) => r.id));
      const chunkSize = 200;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const batch = ids.slice(i, i + chunkSize);
        const { error: updErr } = await supabase.from("device_position_map").update({ device_name: finalName }).in("id", batch);
        if (updErr) throw updErr;
      }

      setRenameSelected(new Set());
      setRenameTarget("");
      setRenameCategory("");
      router.refresh();
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenameBusy(false);
    }
  }

  // Cùng kiểu bấm nhanh + cộng dồn nhiều lĩnh vực như DeviceCircuitList (xem
  // file đó để biết lý do không reset lựa chọn khác khi đổi lĩnh vực).
  function toggleCategory(cat: string) {
    setCategoryFilter((prev) => {
      if (prev === null) return [cat];
      if (prev.includes(cat)) {
        const next = prev.filter((c) => c !== cat);
        return next.length === 0 ? null : next;
      }
      return [...prev, cat];
    });
    setAddHiddenNotice(null);
  }

  function resetCategory() {
    setCategoryFilter(null);
    setAddHiddenNotice(null);
  }

  const filtered = useMemo(() => {
    let list = rows.filter(
      (r) =>
        matchesFilter(r.deviceName, filters.deviceName) &&
        matchesFilter(r.devicePosition, filters.devicePosition) &&
        matchesFilter(r.odfPosition, filters.odfPosition)
    );
    if (categoryFilter !== null) {
      const set = new Set(categoryFilter);
      list = list.filter((r) => set.has(rowCategory(r)));
    }
    const arr = [...list].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [rows, filters, categoryFilter, categoryByDeviceKey, sortKey, sortDir]);

  async function addRow() {
    if (!draft.deviceName.trim()) {
      setError("Tên thiết bị không được để trống.");
      return;
    }
    setBusy(true);
    setError(null);
    setAddHiddenNotice(null);
    const deviceName = draft.deviceName.trim();
    const devicePosition = draft.devicePosition.trim() || null;
    const odfPosition = draft.odfPosition.trim() || null;
    const { error: err } = await supabase.from("device_position_map").insert({
      device_name: deviceName,
      device_position: devicePosition,
      odf_position: odfPosition,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }

    // Kiểm tra ngay: dòng vừa lưu có bị bộ lọc cột HOẶC chip Lĩnh vực đang
    // chọn loại khỏi bảng không — xem ghi chú ở khai báo addHiddenNotice.
    const passesColumnFilters =
      matchesFilter(deviceName, filters.deviceName) &&
      matchesFilter(devicePosition, filters.devicePosition) &&
      matchesFilter(odfPosition, filters.odfPosition);
    const newRowCategory = categoryByDeviceKey.get(normalizeDeviceNameKey(deviceName)) ?? UNCATEGORIZED_LABEL;
    const passesCategory = categoryFilter === null || categoryFilter.includes(newRowCategory);
    if (!passesColumnFilters || !passesCategory) {
      setAddHiddenNotice(`Đã lưu dòng mới ("${deviceName}"), nhưng đang bị ẩn bởi bộ lọc hiện tại.`);
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
            placeholder="VD: ADN1.OTS2 BB1"
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
            placeholder="VD: S1-1, 1/0/27"
            value={draft.devicePosition}
            onChange={(e) => setDraft({ ...draft, devicePosition: e.target.value })}
          />
          <input
            className="input w-auto max-w-[220px]"
            list="dpm-odf-position-options"
            placeholder="VD: ODF 5/7 (37,38)"
            value={draft.odfPosition}
            onChange={(e) => setDraft({ ...draft, odfPosition: e.target.value })}
            onBlur={() => {
              const match = matchTrunkPosition(draft.odfPosition, trunkPorts);
              const canonical = formatCanonicalOdfPosition(match);
              if (canonical && canonical !== draft.odfPosition) setDraft((d) => ({ ...d, odfPosition: canonical }));
            }}
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
        {addHiddenNotice && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>{addHiddenNotice}</span>
            <button
              type="button"
              className="font-medium underline hover:text-amber-900"
              onClick={() => {
                setFilters({ deviceName: "", devicePosition: "", odfPosition: "" });
                setCategoryFilter(null);
                setAddHiddenNotice(null);
              }}
            >
              Bỏ lọc để xem
            </button>
          </div>
        )}
      </div>

      <div className="mb-4">
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
                  (active ? "border-primary-600 bg-primary-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")
                }
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {unmatchedGroups.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-amber-800">
              Chuẩn hóa tên thiết bị chưa khớp ({unmatchedGroups.length} tên khác nhau, {unmatchedRowCount} dòng đang
              "Chưa phân loại")
            </p>
            <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setStandardizeOpen((v) => !v)}>
              {standardizeOpen ? "Ẩn" : "Mở"}
            </button>
          </div>

          {standardizeOpen && (
            <>
              {renameError && <p className="mt-2 text-sm text-red-600">Lỗi: {renameError}</p>}
              <p className="mt-2 text-xs text-amber-700">
                Tick chọn 1 hoặc nhiều tên bên dưới (có thể là nhiều biến thể khác nhau của CÙNG 1 thiết bị thật), gõ
                tên chuẩn muốn gộp về rồi bấm Áp dụng — đổi tên hàng loạt cho toàn bộ dòng thuộc các tên đã tick,
                không cần sửa từng dòng trib/port riêng.
              </p>

              {renameSelected.size > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary-200 bg-white p-3">
                  <p className="text-sm font-medium text-primary-800">Đã chọn {renameSelected.size} tên — gộp về:</p>
                  <input
                    className="input w-auto max-w-[240px]"
                    list="dpm-device-name-options"
                    placeholder="Tên thiết bị chuẩn"
                    value={renameTarget}
                    onChange={(e) => setRenameTarget(e.target.value)}
                  />
                  <input
                    className="input w-auto max-w-[200px]"
                    list="dpm-category-options"
                    placeholder="Lĩnh vực (nếu tạo thiết bị mới)"
                    value={renameCategory}
                    onChange={(e) => setRenameCategory(e.target.value)}
                  />
                  <datalist id="dpm-category-options">
                    {realCategoryOptions.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                  <button className="btn-primary" onClick={applyRenameGroups} disabled={renameBusy}>
                    {renameBusy ? "Đang lưu..." : "Áp dụng"}
                  </button>
                </div>
              )}

              <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto">
                {unmatchedGroups.map((g) => (
                  <label
                    key={g.key}
                    className="flex items-start gap-2 rounded-md border border-slate-200 bg-white p-2 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={renameSelected.has(g.key)}
                      onChange={() => toggleRenameSelect(g.key)}
                    />
                    <span>
                      <span className="text-slate-700">{g.variants.map((v) => `${v.text} (${v.count})`).join(", ")}</span>
                      <span className="ml-2 text-xs text-slate-400">— {g.rows.length} dòng</span>
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {categorylessMatchedDevices > 0 && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-sm text-sky-800">
          Còn <strong>{categorylessMatchedDevices} thiết bị</strong> tên đã khớp đúng (không phải lỗi tên) nhưng CHÍNH
          thiết bị đó chưa được gán lĩnh vực — khung "Chuẩn hóa tên thiết bị" ở trên không xử lý được trường hợp này.
          Sang trang{" "}
          <Link href="/devices" className="font-medium underline hover:text-sky-900">
            Danh mục thiết bị
          </Link>{" "}
          để tick chọn và gán lĩnh vực cho các thiết bị này.
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <p className="text-sm text-slate-500">
          {filtered.length}/{rows.length} dòng
        </p>
        {Object.values(filters).some((v) => v) && (
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() => setFilters({ deviceName: "", devicePosition: "", odfPosition: "" })}
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: colWidths.deviceName }} />
            <col style={{ width: colWidths.devicePosition }} />
            <col style={{ width: colWidths.odfPosition }} />
            <col style={{ width: 140 }} />
          </colgroup>
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <ResizableTh
                label="Tên thiết bị"
                sortKey="deviceName"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.deviceName}
                onResize={(w) => resizeCol("deviceName", w)}
              />
              <ResizableTh
                label="Vị trí thiết bị"
                sortKey="devicePosition"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.devicePosition}
                onResize={(w) => resizeCol("devicePosition", w)}
              />
              <ResizableTh
                label="Vị trí ODF/DDF"
                sortKey="odfPosition"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.odfPosition}
                onResize={(w) => resizeCol("odfPosition", w)}
              />
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
                          onBlur={() => {
                            const match = matchTrunkPosition(editDraft.odfPosition, trunkPorts);
                            const canonical = formatCanonicalOdfPosition(match);
                            if (canonical && canonical !== editDraft.odfPosition)
                              setEditDraft((d) => ({ ...d, odfPosition: canonical }));
                          }}
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
                      <td className="px-4 py-2 text-slate-700 break-words">{r.deviceName}</td>
                      <td className="px-4 py-2 text-slate-600 break-words">{r.devicePosition ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600 break-words">{r.odfPosition ?? "—"}</td>
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
