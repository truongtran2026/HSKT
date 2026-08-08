"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import { deviceCategoryLabel } from "@/lib/devices";
import { syncDevicePositionMapNames, deleteDevicePositionMapForNames } from "@/lib/devicePositionMap";
import { mergeDeviceInto } from "@/lib/deviceDedup";
import { findMirrorTrunkCircuits, type MirrorTrunkMatch } from "@/lib/mirrorTrunkCircuits";
import { confirmBulkDelete } from "@/lib/dangerousConfirm";
import { formatLastUpdated } from "@/lib/format";
import { translatePgError } from "@/lib/translatePgError";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import DataTh from "@/components/ui/DataTh";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EmptyUntilFiltered from "@/components/ui/EmptyUntilFiltered";
import { IconTrash } from "@/components/ui/icons";
import RoleGate from "@/components/ui/RoleGate";
import type { DeviceRow } from "@/lib/devices";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

type SortKey = "name" | "category" | "source";

// Chỉ "Tên thiết bị" cần kéo dãn (có thể rất dài) — Lĩnh vực/Nguồn giá trị
// ngắn, cố định (yêu cầu người dùng 2026-07-27: "các bảng dữ liệu đều" kéo
// dãn được).
type ResizableCol = "name";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { name: 280 };

// Tên thiết bị luôn hiện (như Port/Tên luồng ở các bảng khác) — Lĩnh vực/
// Nguồn ẩn/hiện được (quy định chung mọi bảng, xem architecture.md).
type VisibleCol = "category" | "source";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = { category: true, source: true };
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "category", label: "Lĩnh vực" },
  { key: "source", label: "Nguồn" },
];

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
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("device-category-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("device-category-col-visibility", DEFAULT_VISIBLE);
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  // Mặc định KHÔNG hiện bảng (yêu cầu người dùng 2026-08-08) — chỉ hiện khi
  // đã lọc theo lĩnh vực THẬT hoặc chủ động bấm "Xem tất cả", cùng cơ chế đã
  // làm ở DeviceCircuitList.tsx.
  const [viewAll, setViewAll] = useState(false);
  const scopeChosen = viewAll || categoryFilter !== null;
  const [filters, setFilters] = useState<Record<SortKey, string>>({ name: "", category: "", source: "" });

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }
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

  // Thêm mới thiết bị tay (yêu cầu người dùng 2026-08-07 — trang này trước
  // đây chỉ tạo được thiết bị GIÁN TIẾP qua "gán tên" ở khung pendingGroups
  // phía trên hoặc qua các form nhập luồng — chưa có nút thêm trực tiếp).
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceCoordinate, setNewDeviceCoordinate] = useState("");
  const [newDeviceCategory, setNewDeviceCategory] = useState("");

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
    // Bấm "Tất cả" là 1 lựa chọn CHỦ ĐỘNG — coi như viewAll luôn (cùng cách
    // đã làm ở DeviceCircuitList.tsx).
    setCategoryFilter(null);
    setViewAll(true);
  }

  const filtered = useMemo(() => {
    let list = devices;
    if (categoryFilter !== null) {
      const set = new Set(categoryFilter);
      list = list.filter((d) => set.has(deviceCategoryLabel(d.category)));
    }
    list = list.filter((d) => (["name", "category", "source"] as SortKey[]).every((k) => matchesFilter(cellText(d, k), filters[k])));
    const arr = [...list].sort((a, b) => compareValues(cellText(a, sortKey), cellText(b, sortKey)));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [devices, categoryFilter, filters, sortKey, sortDir]);

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

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (d: DeviceRow) => string | number | null }[] = [{ label: "Tên thiết bị", getValue: (d) => d.name }];
    if (visible.category) cols.push({ label: "Lĩnh vực", getValue: (d) => deviceCategoryLabel(d.category) });
    if (visible.source) cols.push({ label: "Nguồn", getValue: (d) => SOURCE_LABEL[d.source] });
    return cols;
  }, [visible]);

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
        setError(translatePgError(err.message));
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
        // Phần lõi chuyển luồng + xóa thiết bị nguồn tách sang lib/deviceDedup.ts
        // (yêu cầu người dùng 2026-07-29, dùng chung với trang "Chất lượng dữ
        // liệu" mới) — hành vi giữ nguyên 100%.
        await mergeDeviceInto(supabase, d.id, targetId);
      }

      try {
        await syncDevicePositionMapNames(supabase, oldNames, finalName);
      } catch (syncErr) {
        setError(
          `Đã đổi tên/gộp xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? translatePgError(syncErr.message) : String(syncErr)
          }`
        );
      }

      setSelected(new Set());
      setBulkRename("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Số luồng sẽ bị xóa kèm theo nếu xóa hẳn các thiết bị đang tick — tính
  // trước để báo rõ trong hộp thoại xác nhận (yêu cầu người dùng 2026-07-28:
  // "xóa luôn một thiết bị", tránh xóa nhầm hàng loạt luồng mà không biết).
  const selectedCircuitCount = useMemo(
    () => circuits.filter((c) => c.deviceId && selected.has(c.deviceId)).length,
    [circuits, selected]
  );

  // Xóa HẲN 1 hoặc nhiều thiết bị đã tick (yêu cầu người dùng 2026-07-28,
  // khác "gộp" ở applyBulkRename — ở đây không có thiết bị đích nào giữ lại,
  // toàn bộ luồng đang gán cho các thiết bị này bị xóa theo luôn, vì luồng
  // thiết bị không có ý nghĩa khi không còn thiết bị sở hữu). Đồng bộ dọn
  // luôn thư viện "Vị trí thiết bị" (device_position_map, xem
  // deleteDevicePositionMapForNames) để không sót gợi ý cho thiết bị đã xóa —
  // đúng yêu cầu "chú ý đồng bộ dữ liệu với các Hồ sơ khác cho chuẩn". Không
  // đụng racks/transit_links vì đã kiểm tra thực tế: không rack/transit_link
  // nào đang tham chiếu devices qua device_id/target_device_id (2 cột đó luôn
  // null với dữ liệu ADN1 hiện có).
  //
  // Bug thật gặp 2026-07-31 (xem architecture.md mục 32): cửa xóa này CŨNG
  // xóa thẳng circuits.device_id, cùng lớp nguy cơ để lại mirror mồ côi bên
  // trung kế như deleteCircuit() ở DeviceCircuitList.tsx. Từ migration
  // `circuits_mirror_of`, xóa circuits ở đây tự cascade xóa mirror rồi
  // (`mirror_of_id on delete cascade`, không phụ thuộc code này nữa) — chỉ
  // còn cần dọn `ports.status`/`transit_links` sau đó (xem
  // lib/mirrorTrunkCircuits.ts, không tự cascade được).
  async function deleteSelectedDevices() {
    if (selected.size === 0) return;
    setError(null);
    const circuitIdsToDelete = circuits.filter((c) => c.deviceId && selected.has(c.deviceId)).map((c) => c.id);
    let mirrors: MirrorTrunkMatch[];
    try {
      mirrors = [...(await findMirrorTrunkCircuits(supabase, circuitIdsToDelete)).values()];
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
      return;
    }
    const deviceLabel = selected.size === 1 ? "thiết bị này" : `${selected.size} thiết bị đã chọn`;
    const circuitWarning =
      selectedCircuitCount > 0 ? ` Toàn bộ ${selectedCircuitCount} luồng đang gán cho ${deviceLabel} sẽ bị xóa theo.` : "";
    const mirrorWarning =
      mirrors.length > 0
        ? ` Trong đó ${mirrors.length} luồng đã có "mirror" tự sinh bên Hồ sơ ODF Trung kế — sẽ bị xóa theo, (các) port trung kế tương ứng trở về trạng thái trống.`
        : "";
    // confirmBulkDelete (Đợt 3.4 audit, 2026-08-07) thay confirm() OK/Cancel
    // thường — bắt gõ "XÓA" + giới hạn 20 dòng/lần.
    if (!confirmBulkDelete(`Xóa vĩnh viễn ${deviceLabel}?${circuitWarning}${mirrorWarning} Không thể hoàn tác.`, selected.size))
      return;

    setBusy(true);
    try {
      const ids = [...selected];
      const names = selectedDevices.map((d) => d.name);

      // Phần CƠ HỌC (xóa circuits theo device_id, dọn port/transit_links của
      // mirror trung kế bị cascade xóa theo, xóa devices) gộp thành 1 RPC
      // nguyên tử (Đợt 2, 2026-08-04, xem migration 20260804000003) — trước
      // đây là nhiều lời gọi Supabase rời rạc (kể cả chia batch 200), mất
      // mạng/đóng tab giữa chừng để lại thiết bị đã mất luồng nhưng còn tồn
      // tại, hoặc ngược lại. RPC nhận thẳng mảng id, không cần tự chia batch
      // (Postgres xử lý `= any(uuid[])` tốt với mảng lớn hơn 200 nhiều).
      const { error: rpcErr } = await supabase.rpc("delete_devices_with_circuits", { p_device_ids: ids });
      if (rpcErr) throw rpcErr;

      // Phần dọn device_position_map (khớp theo TÊN đã chuẩn hóa qua
      // normalizeDeviceNameKey() — hàm JS, chưa có bản SQL tương đương nên
      // KHÔNG đưa vào RPC) vẫn giữ nguyên là bước best-effort riêng sau khi
      // RPC đã thành công, đúng hành vi cũ.
      try {
        await deleteDevicePositionMapForNames(supabase, names);
      } catch (syncErr) {
        setError(
          `Đã xóa thiết bị xong, nhưng dọn thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? translatePgError(syncErr.message) : String(syncErr)
          }`
        );
      }

      setSelected(new Set());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Thêm mới 1 thiết bị (2026-08-07) — tự thêm tiền tố "ADN1." nếu chưa gõ,
  // ĐÚNG quy ước tạo thiết bị đã dùng ở mọi nơi khác (PortTable.tsx,
  // DeviceCircuitList.tsx: maybeCreateCounterpartDevice/resolveOrCreateNextDevice)
  // — không phát minh quy ước mới. Chặn trùng tên TRƯỚC khi insert (so theo
  // khóa đã chuẩn hóa qua normalizeDeviceNameKey, không phân biệt hoa/thường/
  // dấu) vì `devices.name` KHÔNG có ràng buộc unique ở tầng CSDL (chưa làm ở
  // đợt nào — chỉ mới ràng buộc racks.code, xem architecture.md mục 65).
  async function addDevice() {
    const typed = newDeviceName.trim();
    if (!typed) {
      setError("Nhập tên thiết bị.");
      return;
    }
    const fullName = /^adn1\./i.test(typed) ? typed : `ADN1.${typed}`;
    const key = normalizeDeviceNameKey(fullName);
    if (devices.some((d) => normalizeDeviceNameKey(d.name) === key)) {
      setError(`Thiết bị "${fullName}" đã tồn tại — không tạo trùng, tìm trong danh sách bên dưới để sửa nếu cần.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coordinate = newDeviceCoordinate.trim() || null;
      const { error: err } = await supabase.from("devices").insert({
        station_id: stationId,
        name: fullName,
        coordinate_text: coordinate,
        full_label: coordinate ? `${fullName}(${coordinate})` : fullName,
        category: newDeviceCategory.trim() || null,
        source: "manual",
      });
      if (err) throw err;
      setNewDeviceName("");
      setNewDeviceCoordinate("");
      setNewDeviceCategory("");
      setShowAddForm(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
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
        await syncDevicePositionMapNames(supabase, g.variants.map((v) => v.text), finalName);
      } catch (syncErr) {
        setError(
          `Đã gán thiết bị xong, nhưng đồng bộ thư viện "Vị trí thiết bị" thất bại: ${
            syncErr instanceof Error ? translatePgError(syncErr.message) : String(syncErr)
          }`
        );
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
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
                    <RoleGate allow={["operator", "admin"]}>
                      <button
                        className="btn-primary px-3 py-1 text-xs"
                        onClick={() => applyPendingGroup(g)}
                        disabled={pendingBusyKey !== null}
                      >
                        {pendingBusyKey === g.key ? "Đang lưu..." : "Áp dụng"}
                      </button>
                    </RoleGate>
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
        {!showAddForm ? (
          <RoleGate allow={["operator", "admin"]}>
            <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setShowAddForm(true)}>
              + Thêm thiết bị
            </button>
          </RoleGate>
        ) : (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white p-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Tên thiết bị *</span>
              <input
                className="input w-56"
                placeholder="vd OTS2 hoặc ADN1.OTS2"
                value={newDeviceName}
                onChange={(e) => setNewDeviceName(e.target.value)}
                autoFocus
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Tọa độ (tùy chọn)</span>
              <input
                className="input w-32"
                placeholder="vd 1-3-3"
                value={newDeviceCoordinate}
                onChange={(e) => setNewDeviceCoordinate(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-slate-500">Lĩnh vực (tùy chọn)</span>
              <input
                className="input w-40"
                list="device-category-options"
                value={newDeviceCategory}
                onChange={(e) => setNewDeviceCategory(e.target.value)}
              />
            </label>
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={addDevice} disabled={busy}>
              {busy ? "Đang tạo..." : "Tạo"}
            </button>
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-sm"
              onClick={() => {
                setShowAddForm(false);
                setNewDeviceName("");
                setNewDeviceCoordinate("");
                setNewDeviceCategory("");
              }}
              disabled={busy}
            >
              Hủy
            </button>
          </div>
        )}
      </div>

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

      <div className="mb-2 flex flex-wrap items-center gap-3">
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
        <div className="ml-auto flex gap-2">
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Danh mục thiết bị" fileNamePrefix="Danh_muc_thiet_bi" />
          <ColumnPicker items={COLUMN_ITEMS} visible={visible} onToggle={toggleColumn} />
        </div>
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
            <RoleGate allow={["operator", "admin"]}>
              <button className="btn-primary" onClick={applyBulkCategory} disabled={busy}>
                {busy ? "Đang lưu..." : "Áp dụng"}
              </button>
            </RoleGate>
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
            <RoleGate allow={["operator", "admin"]}>
              <button className="btn-primary" onClick={applyBulkRename} disabled={busy}>
                {busy ? "Đang lưu..." : "Áp dụng"}
              </button>
            </RoleGate>
          </div>
          {selected.size > 1 && (
            <p className="text-xs text-primary-700">
              Gộp sẽ chuyển toàn bộ luồng của {selected.size - 1} thiết bị còn lại sang thiết bị đích rồi xóa các
              thiết bị không còn dùng — không thể hoàn tác.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 border-t border-primary-200 pt-2">
            <p className="w-full text-sm font-medium text-red-700 sm:w-auto">
              Xóa vĩnh viễn {selected.size === 1 ? "thiết bị này" : `${selected.size} thiết bị đã chọn`}
              {selectedCircuitCount > 0 ? ` (kèm ${selectedCircuitCount} luồng)` : ""}:
            </p>
            <RoleGate allow={["admin"]}>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={deleteSelectedDevices}
                disabled={busy}
                title="Xóa"
              >
                <IconTrash className="h-4 w-4" />
                {busy ? "Đang xóa..." : "Xóa"}
              </button>
            </RoleGate>
          </div>
          <p className="text-xs text-red-600">
            Xóa thiết bị sẽ xóa luôn mọi luồng đang gán cho thiết bị đó và dọn thư viện &quot;Vị trí thiết bị&quot;
            liên quan — không thể hoàn tác.
          </p>
        </div>
      )}

      <EmptyUntilFiltered active={scopeChosen} onShowAll={() => setViewAll(true)} prompt="Chọn lĩnh vực ở trên để xem, hoặc">
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: colWidths.name }} />
            {visible.category && <col style={{ width: 140 }} />}
            {visible.source && <col style={{ width: 100 }} />}
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 text-left align-top font-semibold">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearVisible())}
                  title="Chọn/bỏ chọn tất cả đang hiện"
                />
              </th>
              <DataTh
                label="Tên thiết bị"
                sortKey="name"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
                filterValue={filters.name}
                onFilterChange={(v) => setFilter("name", v)}
              />
              {visible.category && (
                <DataTh
                  label="Lĩnh vực"
                  sortKey="category"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.category}
                  onFilterChange={(v) => setFilter("category", v)}
                />
              )}
              {visible.source && (
                <DataTh
                  label="Nguồn"
                  sortKey="source"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.source}
                  onFilterChange={(v) => setFilter("source", v)}
                />
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr
                key={d.id}
                className={`border-t border-slate-100 ${selected.has(d.id) ? "bg-primary-50/60" : "hover:bg-primary-50/50"}`}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelect(d.id)} />
                </td>
                <td className="px-3 py-2 text-slate-700 break-words">
                  {d.name}
                  <div className="text-xs text-slate-400">Cập nhật lần cuối: {formatLastUpdated(d.updatedAt)}</div>
                </td>
                {visible.category && <td className="px-3 py-2 text-slate-600">{deviceCategoryLabel(d.category)}</td>}
                {visible.source && <td className="px-3 py-2 text-slate-500">{SOURCE_LABEL[d.source]}</td>}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={2 + COLUMN_ITEMS.filter((c) => visible[c.key]).length} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy thiết bị nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </EmptyUntilFiltered>
    </div>
  );
}
