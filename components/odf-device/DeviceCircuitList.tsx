"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort, type SortDir } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import {
  isPlaceholderCircuitName,
  looksLikeRealPositionText,
  normalizeDeviceNameKey,
  normalizeDevicePositionKey,
} from "@/lib/deviceNotes";
import { deviceCategoryLabel, getAdn1StationId, UNCATEGORIZED_LABEL } from "@/lib/devices";
import { parseTransitText, isManagedStationCode } from "@/lib/parsers/transit-text";
import FilterInput from "@/components/ui/FilterInput";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";
import type { DeviceRow } from "@/lib/devices";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";

// Tiêu đề cột (bấm sắp xếp) GỘP CHUNG với ô lọc trong ĐÚNG 1 <th> — cố ý
// không tách 2 hàng <tr> riêng (tiêu đề + lọc) như trước nữa: sticky 2 hàng
// riêng cần tính "top" của hàng dưới theo chiều cao hàng trên, dễ lệch/che
// nhau khi cuộn (đã gặp thực tế). Gộp 1 hàng thì chỉ cần sticky top-0 duy
// nhất, không còn phép tính nào có thể sai.
//
// KHÔNG ép min-w/whitespace-nowrap cố định cho mọi cột (đã bỏ — phản hồi
// người dùng 2026-07-27: bảng không chịu co theo khung hình trình duyệt).
// Ép cứng 130px x8 cột = hơn 1000px sàn bất kể nội dung cột đó ngắn hay dài
// (khác PortTable.tsx không ép gì, tự co theo nội dung thật) — bỏ đi để
// bảng tự co khớp dữ liệu thật, chỉ tới ngưỡng đó mới cần cuộn ngang.
function SortFilterTh<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  filterValue,
  onFilterChange,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: SortDir;
  onSort: (key: K) => void;
  filterValue: string;
  onFilterChange: (v: string) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 align-top">
      <div
        className="mb-1 flex cursor-pointer select-none items-center gap-1 font-semibold hover:text-primary-900"
        onClick={() => onSort(sortKey)}
        title="Bấm để sắp xếp"
      >
        {label}
        <span className={`text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
          {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </div>
      <FilterInput value={filterValue} onChange={onFilterChange} />
    </th>
  );
}

// Cột có lọc nhưng KHÔNG sắp xếp được (vd Ghi chú — text dài, sắp xếp không
// có nhiều ý nghĩa).
function FilterOnlyTh({ label, filterValue, onFilterChange }: { label: string; filterValue: string; onFilterChange: (v: string) => void }) {
  return (
    <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 align-top">
      <div className="mb-1 font-semibold">{label}</div>
      <FilterInput value={filterValue} onChange={onFilterChange} />
    </th>
  );
}

// Anchor để trang khác (vd danh sách trùng vị trí ở /odf-device/chuan-hoa)
// trỏ thẳng vào đúng dòng luồng cần sửa — xem rowAnchor()/useEffect bên dưới.
export function rowAnchor(circuitId: string): string {
  return `dc-${circuitId}`;
}

// Tên tự sinh "(chưa đặt tên)..." chỉ hiện khi CHƯA có vị trí ODF tiếp theo
// (chưa có luồng dịch vụ thật) — hiện đúng tên hồ sơ khi đã có, để trống cho
// gọn khi chưa có (xem lib/deviceNotes.ts).
function displayName(c: DeviceCircuitRow): string {
  if (isPlaceholderCircuitName(c.name) && !c.devicePositionNext) return "";
  return c.name;
}

type SortKey = "name" | "trib" | "device" | "positionOwn" | "positionNext" | "interface" | "counterpart";
type FilterKey = SortKey | "notes";

function cellText(c: DeviceCircuitRow, key: FilterKey): string | null {
  switch (key) {
    case "name":
      return c.name;
    case "trib":
      return c.tribText;
    case "device":
      return c.deviceName ?? "(chưa xác định)";
    case "positionOwn":
      return c.devicePositionOwn;
    case "positionNext":
      return c.devicePositionNext;
    case "interface":
      return c.interfaceType;
    case "counterpart":
      return c.counterpartText;
    case "notes":
      return c.notes;
  }
}

function compareByKey(key: SortKey, a: DeviceCircuitRow, b: DeviceCircuitRow): number {
  return compareValues(cellText(a, key), cellText(b, key));
}

const FILTER_KEYS: FilterKey[] = ["name", "trib", "device", "positionOwn", "positionNext", "interface", "counterpart", "notes"];

interface EditState {
  id: string;
  deviceName: string | null;
  name: string;
  tribText: string;
  positionOwn: string;
  positionNext: string;
  interfaceType: string;
  counterpartText: string;
  notes: string;
}

interface CreateDraft {
  category: string;
  deviceId: string;
  name: string;
  tribText: string;
  positionOwn: string;
  positionNext: string;
  interfaceType: string;
  counterpartText: string;
  notes: string;
}

const EMPTY_CREATE_DRAFT: CreateDraft = {
  category: "",
  deviceId: "",
  name: "",
  tribText: "",
  positionOwn: "",
  positionNext: "",
  interfaceType: "",
  counterpartText: "",
  notes: "",
};

export default function DeviceCircuitList({
  circuits,
  devices,
  devicePositionMap,
}: {
  circuits: DeviceCircuitRow[];
  devices: DeviceRow[];
  devicePositionMap: DevicePositionMapRow[];
}) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  const [deviceNames, setDeviceNames] = useState<string[] | null>(null); // null = tất cả thiết bị (trong phạm vi lĩnh vực)
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    name: "",
    trib: "",
    device: "",
    positionOwn: "",
    positionNext: "",
    interface: "",
    counterpart: "",
    notes: "",
  });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [conflictSearch, setConflictSearch] = useState("");
  const [conflictPageSize, setConflictPageSize] = useState(5);
  const [conflictPage, setConflictPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE_DRAFT);

  // Thư viện "thiết bị + vị trí thiết bị -> vị trí ODF/DDF" (bảng
  // device_position_map, quản lý ở /odf-device/vi-tri-thiet-bi) — dùng để
  // gợi ý (datalist) + tự điền 2 chiều Trib <-> Vị trí ODF khi nhập/sửa luồng,
  // theo yêu cầu người dùng 2026-07-26: chọn 1 trong 2 ô (đã có sẵn trong thư
  // viện của đúng thiết bị đó) thì ô còn lại tự ra, đỡ gõ tay dễ lệch định
  // dạng giữa các lần nhập.
  const libraryByDevice = useMemo(() => {
    const map = new Map<string, { devicePosition: string | null; odfPosition: string | null }[]>();
    for (const m of devicePositionMap) {
      const key = normalizeDeviceNameKey(m.deviceName);
      const list = map.get(key) ?? [];
      list.push({ devicePosition: m.devicePosition, odfPosition: m.odfPosition });
      map.set(key, list);
    }
    return map;
  }, [devicePositionMap]);

  function findLibraryMatchByOdf(deviceName: string | null, odfValue: string) {
    if (!deviceName) return null;
    const target = normalizeDevicePositionKey(odfValue);
    if (!target) return null;
    const list = libraryByDevice.get(normalizeDeviceNameKey(deviceName)) ?? [];
    return list.find((e) => normalizeDevicePositionKey(e.odfPosition ?? "") === target) ?? null;
  }

  function findLibraryMatchByTrib(deviceName: string | null, tribValue: string) {
    if (!deviceName) return null;
    const target = normalizeDevicePositionKey(tribValue);
    if (!target) return null;
    const list = libraryByDevice.get(normalizeDeviceNameKey(deviceName)) ?? [];
    return list.find((e) => normalizeDevicePositionKey(e.devicePosition ?? "") === target) ?? null;
  }

  function tribOptionsForDevice(deviceName: string | null): string[] {
    if (!deviceName) return [];
    const list = libraryByDevice.get(normalizeDeviceNameKey(deviceName)) ?? [];
    const set = new Set<string>();
    for (const e of list) if (e.devicePosition) set.add(e.devicePosition);
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // Gợi ý "Vị trí ODF (thiết bị)" — gộp cả thư viện device_position_map lẫn
  // các giá trị đã có sẵn trong chính circuits (dữ liệu cũ có thể chưa được
  // đưa vào thư viện), để gõ vài ký tự là lọc ra được ngay.
  const odfPositionOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of devicePositionMap) if (m.odfPosition) set.add(m.odfPosition);
    for (const c of circuits) if (c.devicePositionOwn) set.add(c.devicePositionOwn);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [devicePositionMap, circuits]);

  // Gợi ý "Giao tiếp" — tuyển tập các giá trị đã dùng qua, không cần bảng
  // thư viện riêng vì bản thân circuits.interface_type đã là kho dữ liệu đó.
  const interfaceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of circuits) if (c.interfaceType) set.add(c.interfaceType);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [circuits]);

  // Nếu đã gõ 1 "Vị trí ODF (thiết bị)" MỚI (chưa có trong thư viện của đúng
  // thiết bị đó) thì lưu thêm vào device_position_map — đúng yêu cầu "làm
  // thư viện" dần theo thời gian, không cần màn hình riêng để nhập trước.
  async function maybeGrowLibrary(deviceName: string | null, tribText: string, positionOwn: string) {
    const odf = positionOwn.trim();
    if (!deviceName || !odf) return;
    const nameKey = normalizeDeviceNameKey(deviceName);
    const odfKey = normalizeDevicePositionKey(odf);
    const exists = devicePositionMap.some(
      (m) => normalizeDeviceNameKey(m.deviceName) === nameKey && normalizeDevicePositionKey(m.odfPosition ?? "") === odfKey
    );
    if (exists) return;
    await supabase.from("device_position_map").insert({
      device_name: deviceName,
      device_position: tribText.trim() || null,
      odf_position: odf,
    });
  }

  const existingDeviceKeys = useMemo(() => new Set(devices.map((d) => normalizeDeviceNameKey(d.name))), [devices]);

  // Ô "Đối phương" đôi khi ghi rõ thiết bị + tọa độ ADN1 ở đầu bên kia (vd
  // "ADN1.PSS24X#3 BB1 (2-3-21)") mà bảng devices CHƯA có — theo yêu cầu
  // người dùng 2026-07-26 (và đúng architecture.md mục 3.7 "hỏi xác nhận tạo
  // mới" vốn định làm cho ô "Chuyển tiếp" bên trung kế nhưng chưa gắn UI nào
  // cả), khi phát hiện tên thiết bị ADN1 lạ thì hỏi xác nhận rồi tạo luôn.
  // CHỈ áp dụng ô Đối phương ở đây — "Chuyển tiếp" bên ODF trung kế là phạm
  // vi khác, chưa làm. Không chặn việc lưu luồng dù người dùng từ chối tạo
  // hay tạo thất bại — đây chỉ là bước phụ sau khi luồng đã lưu xong.
  async function maybeCreateCounterpartDevice(counterpartText: string) {
    const parsed = parseTransitText(counterpartText.trim());
    if (!parsed.matched || !parsed.stationCode || !parsed.deviceName || !isManagedStationCode(parsed.stationCode)) return;
    const key = normalizeDeviceNameKey(parsed.deviceName);
    if (!key || existingDeviceKeys.has(key)) return;
    const fullName = `ADN1.${parsed.deviceName.trim()}`;
    if (!confirm(`Chưa có thiết bị "${fullName}" trong hệ thống (nhận diện từ ô Đối phương).\n\nTạo mới thiết bị này?`)) return;
    try {
      const stationId = await getAdn1StationId();
      const { error: err } = await supabase.from("devices").insert({
        station_id: stationId,
        name: fullName,
        coordinate_text: parsed.coordinateText ?? null,
        full_label: `${fullName}(${parsed.coordinateText ?? ""})`,
        source: "auto",
      });
      if (err) throw err;
    } catch (e) {
      setError(`Luồng đã lưu, nhưng tạo thiết bị "${fullName}" thất bại: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Cuộn tới đúng dòng + tô sáng tạm thời khi hash là "#dc-<id>" — cả lúc
  // vào trang lần đầu (vd link ngoài) lẫn khi bấm link "trùng vị trí" ngay
  // trong CÙNG trang này (danh sách trùng vị trí giờ nằm chung 1 trang, xem
  // yêu cầu chuyển từ /odf-device/chuan-hoa sang đây).
  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash;
      if (!hash.startsWith("#dc-")) return;
      const id = hash.slice("#dc-".length);
      setHighlightId(id);
      requestAnimationFrame(() => {
        document.getElementById(rowAnchor(id))?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      setTimeout(() => setHighlightId(null), 5000);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  function setFilter(key: FilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  // Nhóm thiết bị theo lĩnh vực (devices.category, xem migration
  // devices_category) để khung chọn thiết bị dễ tìm hơn thay vì 1 danh sách
  // dài phẳng — thiết bị chưa có deviceName rõ ràng hoặc chưa có lĩnh vực
  // đều rơi vào nhóm "Chưa phân loại".
  const categoryByDeviceName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) map.set(d.name, deviceCategoryLabel(d.category));
    return map;
  }, [devices]);

  const deviceItems = useMemo(() => {
    const set = new Set<string>();
    for (const c of circuits) set.add(c.deviceName ?? "(chưa xác định)");
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name, group: categoryByDeviceName.get(name) ?? UNCATEGORIZED_LABEL }));
  }, [circuits, categoryByDeviceName]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of deviceItems) set.add(item.group);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [deviceItems]);

  // Lĩnh vực cho form "Thêm luồng mới" lấy trực tiếp từ `devices` (không chỉ
  // từ circuits hiện có) — 1 thiết bị vừa chuẩn hóa/import xong có thể chưa
  // có luồng nào (vd sau khi dọn port chưa dùng) nhưng vẫn cần chọn được.
  const allCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const d of devices) set.add(deviceCategoryLabel(d.category));
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [devices]);

  // Bước 1: chọn lĩnh vực trước — thu hẹp danh sách thiết bị đưa vào khung
  // chọn thiết bị (bước 2) thay vì trộn chung hết. Bấm 1 lĩnh vực lần đầu từ
  // trạng thái "tất cả" (null) sẽ CÔ LẬP về đúng lĩnh vực đó (đúng nhu cầu
  // "chọn IP trước"); bấm thêm lĩnh vực khác sau đó mới cộng dồn vào. KHÔNG
  // reset deviceNames ở đây nữa (yêu cầu người dùng 2026-07-26): trước đây
  // mỗi lần đổi lĩnh vực sẽ xóa sạch các thiết bị đã tick, nên tick ở lượt
  // lọc trước bị mất ngay khi lọc sang lĩnh vực khác. Giờ thiết bị đã tick
  // được giữ nguyên qua nhiều lượt đổi lĩnh vực — lĩnh vực chỉ thu hẹp danh
  // sách HIỂN THỊ trong khung chọn thiết bị (giống cách ô tìm kiếm trong
  // GroupedMultiSelect không xóa tick của mục đang bị ẩn).
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

  const scopedDeviceItems = useMemo(() => {
    if (categoryFilter === null) return deviceItems;
    const set = new Set(categoryFilter);
    return deviceItems.filter((item) => set.has(item.group));
  }, [deviceItems, categoryFilter]);

  const filtered = useMemo(() => {
    let list = circuits;
    // Đã tick cụ thể thiết bị nào (deviceNames khác null) thì lấy ĐÚNG tập đó
    // làm chuẩn để lọc bảng, không lọc thêm theo categoryFilter nữa — lúc này
    // lĩnh vực chỉ còn là công cụ tìm thêm thiết bị để tick (thu hẹp khung
    // chọn ở bước 2). Nếu vẫn AND thêm categoryFilter thì thiết bị đã tick ở
    // lĩnh vực trước sẽ biến mất khỏi bảng ngay khi đổi sang lĩnh vực khác dù
    // vẫn còn tick, sai với yêu cầu "tick dồn qua nhiều lượt lọc" (2026-07-26).
    if (deviceNames !== null) {
      const set = new Set(deviceNames);
      list = list.filter((c) => set.has(c.deviceName ?? "(chưa xác định)"));
    } else if (categoryFilter !== null) {
      const set = new Set(categoryFilter);
      list = list.filter((c) => set.has(categoryByDeviceName.get(c.deviceName ?? "(chưa xác định)") ?? UNCATEGORIZED_LABEL));
    }

    list = list.filter((c) => FILTER_KEYS.every((k) => matchesFilter(cellText(c, k), filters[k])));

    const arr = [...list].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [circuits, categoryFilter, categoryByDeviceName, deviceNames, filters, sortKey, sortDir]);

  // Chỉ ẩn cột "Thiết bị" khi đã lọc còn ĐÚNG 1 thiết bị cụ thể (dòng nào
  // cũng giống nhau) — còn lại (tất cả, hoặc chọn nhiều thiết bị cùng lúc)
  // vẫn cần cột này để phân biệt các dòng.
  const showDeviceColumn = deviceNames === null || deviceNames.length !== 1;
  const columnCount = showDeviceColumn ? 9 : 8;

  // Kiểm tra "1 vị trí ODF/DDF (thiết bị) không được gán cho 2 thiết bị khác
  // nhau" — CHỈ so sánh cột "Vị trí ODF (thiết bị)" (nơi CHÍNH thiết bị này
  // đấu cáp ra) với nhau, KHÔNG so với "Vị trí ODF (tiếp theo)" của thiết bị
  // khác. Lý do (người dùng chỉnh lại 2026-07-25): vị trí "tiếp theo" của
  // thiết bị A trùng vị trí "thiết bị" của thiết bị B là chuyện BÌNH THƯỜNG
  // — đó chính là chỗ nhảy dây đấu nối A với B, không phải lỗi trùng port.
  const positionConflicts = useMemo(() => {
    const map = new Map<
      string,
      { positionText: string; entries: { deviceName: string; circuitName: string; circuitId: string }[]; deviceIds: Set<string> }
    >();
    for (const c of circuits) {
      if (!c.deviceId) continue;
      const position = c.devicePositionOwn;
      if (!position || !looksLikeRealPositionText(position)) continue;
      const key = normalizeDevicePositionKey(position);
      if (!key) continue;
      const entry = map.get(key) ?? { positionText: position, entries: [], deviceIds: new Set<string>() };
      entry.entries.push({ deviceName: c.deviceName ?? "(không rõ)", circuitName: c.name, circuitId: c.id });
      entry.deviceIds.add(c.deviceId);
      map.set(key, entry);
    }
    return [...map.values()].filter((v) => v.deviceIds.size > 1);
  }, [circuits]);

  // Tra nhanh "luồng này có đang dính vị trí trùng không (cột Vị trí ODF
  // thiết bị), trùng với ai" — để bôi đỏ NGAY tại dòng trong bảng bên dưới,
  // đỡ phải bấm link lên khung cảnh báo mới biết. Vẫn giữ khung cảnh báo phía
  // trên (xem đủ danh sách + tìm/phân trang) — bôi đỏ tại bảng chỉ là thêm,
  // hữu ích nhất khi đang rà từng lĩnh vực/thiết bị theo bộ lọc phía trên.
  const conflictKeysByCircuit = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const conflict of positionConflicts) {
      const key = normalizeDevicePositionKey(conflict.positionText);
      for (const entry of conflict.entries) {
        const set = map.get(entry.circuitId) ?? new Set<string>();
        set.add(key);
        map.set(entry.circuitId, set);
      }
    }
    return map;
  }, [positionConflicts]);

  function othersForPosition(circuitId: string, position: string | null): string[] {
    if (!position) return [];
    const key = normalizeDevicePositionKey(position);
    const conflict = positionConflicts.find((c) => normalizeDevicePositionKey(c.positionText) === key);
    if (!conflict) return [];
    return conflict.entries.filter((e) => e.circuitId !== circuitId).map((e) => e.deviceName);
  }

  // Danh sách trùng vị trí có thể lên tới cả trăm dòng — lọc theo từ khóa
  // (vị trí / tên thiết bị / tên luồng) rồi phân trang để không kéo dài
  // trang xuống, thay vì hiện hết một lúc.
  const filteredConflicts = useMemo(() => {
    const q = conflictSearch.trim().toLowerCase();
    if (!q) return positionConflicts;
    return positionConflicts.filter(
      (c) =>
        c.positionText.toLowerCase().includes(q) ||
        c.entries.some((e) => e.deviceName.toLowerCase().includes(q) || e.circuitName.toLowerCase().includes(q))
    );
  }, [positionConflicts, conflictSearch]);

  const conflictPageCount = Math.max(1, Math.ceil(filteredConflicts.length / conflictPageSize));
  const conflictPageClamped = Math.min(conflictPage, conflictPageCount - 1);
  const pagedConflicts = filteredConflicts.slice(
    conflictPageClamped * conflictPageSize,
    conflictPageClamped * conflictPageSize + conflictPageSize
  );

  function changeConflictSearch(v: string) {
    setConflictSearch(v);
    setConflictPage(0);
  }

  function changeConflictPageSize(v: number) {
    setConflictPageSize(v);
    setConflictPage(0);
  }

  function openEdit(c: DeviceCircuitRow) {
    setEdit({
      id: c.id,
      deviceName: c.deviceName,
      name: c.name,
      tribText: c.tribText ?? "",
      positionOwn: c.devicePositionOwn ?? "",
      positionNext: c.devicePositionNext ?? "",
      interfaceType: c.interfaceType ?? "",
      counterpartText: c.counterpartText ?? "",
      notes: c.notes ?? "",
    });
    setError(null);
  }

  function cancelEdit() {
    setEdit(null);
    setError(null);
  }

  // Xóa nhanh 1 luồng thiết bị — luồng thiết bị không gắn port_circuit_links
  // (khác luồng trung kế, xem lib/deviceCircuits.ts) nên chỉ cần xóa đúng 1
  // dòng circuits, không đụng gì khác. Luôn hỏi trước vì không thể hoàn tác.
  async function deleteCircuit(c: DeviceCircuitRow) {
    if (!confirm(`Xóa luồng "${displayName(c) || "(chưa đặt tên)"}" (thiết bị: ${c.deviceName ?? "chưa xác định"})? Không thể hoàn tác.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("circuits").delete().eq("id", c.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    if (edit?.id === c.id) setEdit(null);
    router.refresh();
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("circuits")
      .update({
        name: edit.name.trim() || "(chưa đặt tên)",
        trib_text: edit.tribText.trim() || null,
        device_position_own: edit.positionOwn.trim() || null,
        device_position_next: edit.positionNext.trim() || null,
        interface_type: edit.interfaceType.trim() || null,
        counterpart_text: edit.counterpartText.trim() || null,
        notes: edit.notes.trim() || null,
      })
      .eq("id", edit.id);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    await maybeGrowLibrary(edit.deviceName, edit.tribText, edit.positionOwn);
    await maybeCreateCounterpartDevice(edit.counterpartText);
    setBusy(false);
    setEdit(null);
    router.refresh();
  }

  function openCreate() {
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setCreating(true);
    setError(null);
  }

  function cancelCreate() {
    setCreating(false);
    setError(null);
  }

  // Thiết bị đích của form "Thêm luồng mới" — chọn Lĩnh vực trước để thu hẹp
  // danh sách Thiết bị, giống đúng nếp "1. Lĩnh vực / 2. Thiết bị" đã dùng ở
  // khung lọc phía trên, tránh phải lướt cả trăm thiết bị dồn 1 chỗ.
  const createDeviceOptions = useMemo(() => {
    return devices
      .filter((d) => !createDraft.category || deviceCategoryLabel(d.category) === createDraft.category)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [devices, createDraft.category]);

  const createDeviceName = devices.find((d) => d.id === createDraft.deviceId)?.name ?? null;

  async function submitCreate() {
    if (!createDraft.deviceId) {
      setError("Chọn thiết bị trước khi thêm luồng.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("circuits").insert({
      name: createDraft.name.trim() || "(chưa đặt tên)",
      trib_text: createDraft.tribText.trim() || null,
      device_position_own: createDraft.positionOwn.trim() || null,
      device_position_next: createDraft.positionNext.trim() || null,
      interface_type: createDraft.interfaceType.trim() || null,
      counterpart_text: createDraft.counterpartText.trim() || null,
      notes: createDraft.notes.trim() || null,
      device_id: createDraft.deviceId,
    });
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    await maybeGrowLibrary(createDeviceName, createDraft.tribText, createDraft.positionOwn);
    await maybeCreateCounterpartDevice(createDraft.counterpartText);
    setBusy(false);
    setCreating(false);
    setCreateDraft(EMPTY_CREATE_DRAFT);
    router.refresh();
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}

      {/* Datalist dùng chung cho gợi ý "Vị trí ODF (thiết bị/tiếp theo)" và
          "Giao tiếp" — khai báo 1 lần, tham chiếu từ nhiều ô input (dòng đang
          sửa + form thêm mới) qua thuộc tính list. */}
      <datalist id="dc-odf-position-options">
        {odfPositionOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dc-interface-options">
        {interfaceOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dc-trib-options-edit">
        {tribOptionsForDevice(edit?.deviceName ?? null).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dc-trib-options-create">
        {tribOptionsForDevice(createDeviceName).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary-800">Thêm luồng thiết bị mới</p>
          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => (creating ? cancelCreate() : openCreate())}>
            {creating ? "Hủy" : "+ Thêm luồng mới"}
          </button>
        </div>
        {creating && (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-slate-500">
                Lĩnh vực
                <select
                  className="input mt-1"
                  value={createDraft.category}
                  onChange={(e) => setCreateDraft({ ...createDraft, category: e.target.value, deviceId: "" })}
                >
                  <option value="">Tất cả</option>
                  {allCategoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Thiết bị
                <select
                  className="input mt-1"
                  value={createDraft.deviceId}
                  onChange={(e) => setCreateDraft({ ...createDraft, deviceId: e.target.value })}
                >
                  <option value="">-- Chọn thiết bị --</option>
                  {createDeviceOptions.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500">
                Tên luồng
                {/* textarea (không phải input) để kéo to/nhỏ được như ô Ghi
                    chú — tên luồng thực tế có thể rất dài (yêu cầu người
                    dùng 2026-07-27: ô nhỏ quá, phải cuộn ngang mới xem/sửa
                    hết được). rows=1 để mặc định thấp gần bằng ô input bên
                    cạnh, kéo lớn khi cần. */}
                <textarea
                  className="input mt-1 resize-y"
                  rows={1}
                  placeholder="VD: 100GE ADN1.P2 (1/0/3) - 2T9.P1(4/0/3)"
                  value={createDraft.name}
                  onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Trib
                <input
                  className="input mt-1"
                  list="dc-trib-options-create"
                  placeholder="VD: S1-1, 1/0/27"
                  value={createDraft.tribText}
                  onChange={(e) => {
                    const v = e.target.value;
                    const match = findLibraryMatchByTrib(createDeviceName, v);
                    setCreateDraft((prev) => ({ ...prev, tribText: v, positionOwn: match?.odfPosition ?? prev.positionOwn }));
                  }}
                />
              </label>
              <label className="text-xs text-slate-500">
                Vị trí ODF (thiết bị)
                <input
                  className="input mt-1"
                  list="dc-odf-position-options"
                  placeholder="VD: ODF 5/7 (37,38)"
                  value={createDraft.positionOwn}
                  onChange={(e) => {
                    const v = e.target.value;
                    const match = findLibraryMatchByOdf(createDeviceName, v);
                    setCreateDraft((prev) => ({ ...prev, positionOwn: v, tribText: match?.devicePosition ?? prev.tribText }));
                  }}
                />
              </label>
              <label className="text-xs text-slate-500">
                Vị trí ODF (tiếp theo)
                <input
                  className="input mt-1"
                  list="dc-odf-position-options"
                  placeholder="VD: ODF 3/14 (27,28)"
                  value={createDraft.positionNext}
                  onChange={(e) => setCreateDraft({ ...createDraft, positionNext: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Giao tiếp
                <input
                  className="input mt-1"
                  list="dc-interface-options"
                  placeholder="VD: 100GE, 10GE"
                  value={createDraft.interfaceType}
                  onChange={(e) => setCreateDraft({ ...createDraft, interfaceType: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500">
                Đối phương
                {/* Cùng lý do textarea như Tên luồng — tên thiết bị đối
                    phương kèm tọa độ cũng thường dài. */}
                <textarea
                  className="input mt-1 resize-y"
                  rows={1}
                  placeholder="VD: ADN1.PSS24X#3 BB1 (2-3-21)"
                  value={createDraft.counterpartText}
                  onChange={(e) => setCreateDraft({ ...createDraft, counterpartText: e.target.value })}
                />
              </label>
              <label className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
                Ghi chú
                <textarea
                  className="input mt-1 resize-y"
                  rows={2}
                  placeholder="Ghi chú thêm (nếu có)..."
                  value={createDraft.notes}
                  onChange={(e) => setCreateDraft({ ...createDraft, notes: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" onClick={submitCreate} disabled={busy}>
                Thêm luồng
              </button>
              <button className="btn-secondary" onClick={cancelCreate} disabled={busy}>
                Hủy
              </button>
            </div>
          </>
        )}
      </div>

      {positionConflicts.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <h2 className="font-semibold text-red-800">
            Phát hiện {positionConflicts.length} vị trí DDF/ODF bị gán cho nhiều hơn 1 thiết bị
          </h2>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input w-auto max-w-[260px] border-red-300"
              placeholder="Lọc theo vị trí / thiết bị / tên luồng..."
              value={conflictSearch}
              onChange={(e) => changeConflictSearch(e.target.value)}
            />
            <span className="text-xs text-red-600">
              {filteredConflicts.length}/{positionConflicts.length} vị trí
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-red-700">
              Số dòng/trang:
              <select
                className="input w-auto py-1"
                value={conflictPageSize}
                onChange={(e) => changeConflictPageSize(Number(e.target.value))}
              >
                {[5, 10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-2 max-h-80 space-y-2 overflow-y-auto text-sm text-red-700">
            {pagedConflicts.map((conflict) => (
              <li key={conflict.positionText}>
                <span className="font-medium">Vị trí &quot;{conflict.positionText}&quot;:</span>{" "}
                {conflict.entries.map((e, i) => (
                  <span key={i}>
                    {i > 0 && "; "}
                    {e.deviceName} (
                    <a href={`#${rowAnchor(e.circuitId)}`} className="underline hover:text-red-900">
                      {e.circuitName}
                    </a>
                    )
                  </span>
                ))}
              </li>
            ))}
            {pagedConflicts.length === 0 && <li className="text-red-400">Không có vị trí nào khớp bộ lọc.</li>}
          </ul>

          {conflictPageCount > 1 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-700">
              <button
                className="btn-secondary px-2 py-1"
                onClick={() => setConflictPage((p) => Math.max(0, p - 1))}
                disabled={conflictPageClamped === 0}
              >
                ← Trước
              </button>
              <span>
                Trang {conflictPageClamped + 1}/{conflictPageCount}
              </span>
              <button
                className="btn-secondary px-2 py-1"
                onClick={() => setConflictPage((p) => Math.min(conflictPageCount - 1, p + 1))}
                disabled={conflictPageClamped >= conflictPageCount - 1}
              >
                Sau →
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">1. Lĩnh vực</p>
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

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="mb-1 w-full text-xs font-semibold uppercase tracking-wide text-slate-400">2. Thiết bị</p>
        <GroupedMultiSelect items={scopedDeviceItems} selected={deviceNames} onChange={setDeviceNames} buttonLabel="Thiết bị" />
      </div>

      <p className="text-sm text-slate-500 mb-2">
        {filtered.length}/{circuits.length} luồng
      </p>

      {/* max-h + overflow-auto (thay vì chỉ overflow-x-auto) là bắt buộc để
          sticky hoạt động: overflow-x khác "visible" mà overflow-y vẫn
          "visible" thì trình duyệt tự đổi overflow-y thành "auto" ngầm —
          nhưng khung này lúc đó không có chiều cao giới hạn nên KHÔNG BAO GIỜ
          thật sự cuộn ở chính nó (trang cuộn thay), khiến sticky vô tác dụng.
          Giới hạn chiều cao để khung THẬT SỰ tự cuộn, khi đó tiêu đề bảng mới
          dính lại đúng như mong đợi. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="text-primary-800">
            <tr>
              <SortFilterTh
                label="Tên luồng"
                sortKey="name"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.name}
                onFilterChange={(v) => setFilter("name", v)}
              />
              <SortFilterTh
                label="Trib"
                sortKey="trib"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.trib}
                onFilterChange={(v) => setFilter("trib", v)}
              />
              {showDeviceColumn && (
                <SortFilterTh
                  label="Thiết bị"
                  sortKey="device"
                  activeKey={sortKey}
                  dir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.device}
                  onFilterChange={(v) => setFilter("device", v)}
                />
              )}
              <SortFilterTh
                label="Vị trí ODF (thiết bị)"
                sortKey="positionOwn"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.positionOwn}
                onFilterChange={(v) => setFilter("positionOwn", v)}
              />
              <SortFilterTh
                label="Vị trí ODF (tiếp theo)"
                sortKey="positionNext"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.positionNext}
                onFilterChange={(v) => setFilter("positionNext", v)}
              />
              <SortFilterTh
                label="Giao tiếp"
                sortKey="interface"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.interface}
                onFilterChange={(v) => setFilter("interface", v)}
              />
              <SortFilterTh
                label="Đối phương"
                sortKey="counterpart"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.counterpart}
                onFilterChange={(v) => setFilter("counterpart", v)}
              />
              <FilterOnlyTh label="Ghi chú" filterValue={filters.notes} onFilterChange={(v) => setFilter("notes", v)} />
              <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 align-top font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const editing = edit?.id === c.id;
              const conflictKeys = conflictKeysByCircuit.get(c.id);
              const ownConflict = !!(conflictKeys && c.devicePositionOwn && conflictKeys.has(normalizeDevicePositionKey(c.devicePositionOwn)));
              const inConflict = ownConflict;
              return (
                <tr
                  key={c.id}
                  id={rowAnchor(c.id)}
                  className={`border-t border-slate-100 align-top ${
                    highlightId === c.id
                      ? "bg-amber-100"
                      : editing
                        ? "bg-primary-50/60"
                        : inConflict
                          ? "bg-red-50 hover:bg-red-100"
                          : "hover:bg-primary-50/50"
                  }`}
                >
                  {editing ? (
                    <>
                      <td className="px-4 py-2">
                        <textarea
                          className="input min-w-[180px] resize-y"
                          rows={1}
                          placeholder="VD: 100GE ADN1.P2 (1/0/3) - 2T9.P1(4/0/3)"
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          autoFocus
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dc-trib-options-edit"
                          placeholder="VD: S1-1, 1/0/27"
                          value={edit.tribText}
                          onChange={(e) => {
                            const v = e.target.value;
                            const match = findLibraryMatchByTrib(edit.deviceName, v);
                            setEdit({ ...edit, tribText: v, positionOwn: match?.odfPosition ?? edit.positionOwn });
                          }}
                        />
                      </td>
                      {showDeviceColumn && (
                        <td className="px-4 py-2 text-slate-500 text-xs">
                          {c.deviceName ?? "(chưa xác định)"}
                          <div>(sửa tên thiết bị ở Danh mục thiết bị)</div>
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dc-odf-position-options"
                          placeholder="VD: ODF 5/7 (37,38)"
                          value={edit.positionOwn}
                          onChange={(e) => {
                            const v = e.target.value;
                            const match = findLibraryMatchByOdf(edit.deviceName, v);
                            setEdit({ ...edit, positionOwn: v, tribText: match?.devicePosition ?? edit.tribText });
                          }}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dc-odf-position-options"
                          placeholder="VD: ODF 3/14 (27,28)"
                          value={edit.positionNext}
                          onChange={(e) => setEdit({ ...edit, positionNext: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="input"
                          list="dc-interface-options"
                          placeholder="VD: 100GE, 10GE"
                          value={edit.interfaceType}
                          onChange={(e) => setEdit({ ...edit, interfaceType: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <textarea
                          className="input min-w-[160px] resize-y"
                          rows={1}
                          placeholder="VD: ADN1.PSS24X#3 BB1 (2-3-21)"
                          value={edit.counterpartText}
                          onChange={(e) => setEdit({ ...edit, counterpartText: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <textarea
                          className="input min-w-[220px] resize-y"
                          rows={5}
                          value={edit.notes}
                          onChange={(e) => setEdit({ ...edit, notes: e.target.value })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-col gap-1">
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
                      <td className="px-4 py-2 text-slate-700">{displayName(c) || "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{c.tribText ?? "—"}</td>
                      {showDeviceColumn && (
                        <td className="px-4 py-2 text-slate-600">
                          {c.deviceName ?? "(chưa xác định)"}
                          {!c.deviceId && (
                            <span className="ml-1 text-xs text-amber-600" title="Chưa chuẩn hóa — xem trang Danh mục thiết bị">
                              (chưa chuẩn hóa)
                            </span>
                          )}
                        </td>
                      )}
                      <td className={`px-4 py-2 ${ownConflict ? "font-semibold text-red-700" : "text-slate-600"}`}>
                        {c.devicePositionOwn ?? "—"}
                        {ownConflict && (
                          <div className="text-xs font-normal text-red-600" title={othersForPosition(c.id, c.devicePositionOwn).join(", ")}>
                            Trùng với: {othersForPosition(c.id, c.devicePositionOwn).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{c.devicePositionNext ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{c.interfaceType ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-600">{c.counterpartText ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500 max-w-xs">
                        <div className="whitespace-pre-line line-clamp-3" title={c.notes ?? ""}>
                          {c.notes ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button className="text-primary-600 hover:underline" onClick={() => openEdit(c)} disabled={busy}>
                            Sửa
                          </button>
                          <button className="text-red-600 hover:underline" onClick={() => deleteCircuit(c)} disabled={busy}>
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
                <td colSpan={columnCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy kết quả nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
