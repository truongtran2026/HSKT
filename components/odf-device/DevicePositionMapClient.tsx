"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeDeviceNameKey, normalizeDevicePositionKey, looksLikeRealPositionText } from "@/lib/deviceNotes";
import { deviceCategoryLabel, getAdn1StationId, UNCATEGORIZED_LABEL } from "@/lib/devices";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { useColumnOrder } from "@/lib/useColumnOrder";
import { matchTrunkPosition, formatCanonicalOdfPosition, type TrunkPortRow } from "@/lib/trunkPorts";
import { resolveDeviceByExactOrAlias, type DeviceAliasRow } from "@/lib/deviceAliases";
import { findMirrorTrunkCircuits, cleanupAfterMirrorCascade } from "@/lib/mirrorTrunkCircuits";
import { translatePgError } from "@/lib/translatePgError";
import DataTh from "@/components/ui/DataTh";
import ClearableInput from "@/components/ui/ClearableInput";
import ColumnPicker from "@/components/ui/ColumnPicker";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import RefreshButton from "@/components/ui/RefreshButton";
import { IconEdit, IconTrash } from "@/components/ui/icons";
import RoleGate from "@/components/ui/RoleGate";
import { findCircuitsUsingLibraryRow, type DevicePositionMapRow, type RelatedCircuitRef } from "@/lib/devicePositionMap";
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

// Lưu tạm khung "Thêm dòng mới" vào sessionStorage (yêu cầu người dùng
// 2026-08-17: "xóa một port... nó reset lại các ô của khung thêm dòng mới —
// chưa đạt yêu cầu"). Rà lại toàn bộ file xác nhận KHÔNG có hàm nào tự ý gọi
// `setDraft` ngoài `addRow()` sau khi lưu THÀNH CÔNG (đúng ý muốn) — nên khả
// năng cao nhất là người dùng đã rời trang này (vd sang sửa/xóa port ở
// `/odf-device/[rackId]`) rồi quay lại: đó là 1 COMPONENT MỚI hoàn toàn
// (điều hướng sang route khác luôn hủy state React của trang cũ, không có
// cách nào giữ lại chỉ bằng state trong component) — không phải lỗi logic
// trong file này, mà là giới hạn tự nhiên của state React khi đổi trang. Lưu
// vào `sessionStorage` (còn sống hết phiên làm việc trong tab, mất khi đóng
// tab — hợp lý cho "đang gõ dở", không nên dùng `localStorage` sống mãi) để
// khung này sống sót qua MỌI tình huống làm mất state component (đổi trang,
// refresh cứng F5, hay bất kỳ nguyên nhân nào khác) — không cần biết chính
// xác nguyên nhân gốc, chỉ cần đảm bảo dữ liệu đang gõ dở không bao giờ mất.
const DRAFT_STORAGE_KEY = "device-position-map-draft-v1";

function loadStoredDraft(): Draft {
  if (typeof window === "undefined") return EMPTY_DRAFT;
  try {
    const raw = window.sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    return {
      deviceName: typeof parsed.deviceName === "string" ? parsed.deviceName : "",
      devicePosition: typeof parsed.devicePosition === "string" ? parsed.devicePosition : "",
      odfPosition: typeof parsed.odfPosition === "string" ? parsed.odfPosition : "",
    };
  } catch {
    return EMPTY_DRAFT;
  }
}

function draftPreviewActive(d: Draft): boolean {
  return !!(d.deviceName.trim() || d.devicePosition.trim() || d.odfPosition.trim());
}

// Lọc bảng chính theo khung "Thêm dòng mới" đang gõ dở (yêu cầu người dùng
// 2026-08-17) — để soi trùng lặp TRƯỚC khi bấm Thêm: gõ Thiết bị+Trib -> chỉ
// còn các dòng khớp thiết bị+trib đó (để biết đã có chưa); gõ thêm ô ODF thì
// bảng HIỆN THÊM (OR, không thay bộ lọc thiết bị+trib) bất kỳ dòng nào (dù
// thiết bị/trib khác) đang trùng đúng ODF đó — phát hiện port đã bị thiết bị
// khác chiếm trước khi lưu nhầm/ghi đè. Không dùng chung matchesFilter AND
// như bộ lọc cột (đó là lọc thu hẹp thông thường) vì đây là 2 nhóm câu hỏi
// khác nhau ("dòng này giống gì tôi sắp thêm" và "ODF này đã bị ai chiếm"),
// cố tình OR để không bỏ sót nhóm thứ 2.
function matchesDraftPreview(r: DevicePositionMapRow, d: Draft): boolean {
  const deviceQ = d.deviceName.trim();
  const posQ = d.devicePosition.trim();
  const odfQ = d.odfPosition.trim();
  const hasIdentity = !!(deviceQ || posQ);
  const hasOdf = !!odfQ;
  const identityMatch = hasIdentity && (!deviceQ || matchesFilter(r.deviceName, deviceQ)) && (!posQ || matchesFilter(r.devicePosition, posQ));
  const odfMatch = hasOdf && matchesFilter(r.odfPosition, odfQ);
  return identityMatch || odfMatch;
}

// Tên thiết bị luôn hiện — 2 cột còn lại ẩn/hiện được (quy định chung mọi
// bảng, xem architecture.md).
type VisibleCol = "devicePosition" | "odfPosition";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = { devicePosition: true, odfPosition: true };
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "devicePosition", label: "Vị trí thiết bị" },
  { key: "odfPosition", label: "Vị trí ODF/DDF" },
];

// Kéo-thả TOÀN BỘ cột, kể cả "Tên thiết bị"/"Thao tác" trước giờ cố định
// đầu/cuối bảng (yêu cầu người dùng 2026-08-08, đồng bộ từ PortTable.tsx —
// xem architecture.md Mục 84). "actions" không thuộc `SortKey` (không sắp
// xếp/lọc được) nên KHÔNG dùng chung kiểu ép "AllCol trùng SortKey" như
// RackListTable/SearchClient — mỗi case tự khai báo sortKey riêng.
type StructuralCol = "deviceName" | "actions";
type AllCol = StructuralCol | VisibleCol;
const DEFAULT_ALL_ORDER: AllCol[] = ["deviceName", ...COLUMN_ITEMS.map((c) => c.key), "actions"];
const STRUCTURAL_COLUMNS = new Set<AllCol>(["deviceName", "actions"]);
const OPTIONAL_COL_SET = new Set<AllCol>(COLUMN_ITEMS.map((c) => c.key));

export default function DevicePositionMapClient({
  rows,
  devices,
  trunkPorts,
  deviceAliases,
  deviceCategories,
}: {
  rows: DevicePositionMapRow[];
  devices: DeviceRow[];
  trunkPorts: TrunkPortRow[];
  deviceAliases: DeviceAliasRow[];
  deviceCategories: string[];
}) {
  const router = useRouter();
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("deviceName");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<SortKey>("device-position-map-col-widths", DEFAULT_COL_WIDTHS);
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("device-position-map-col-visibility", DEFAULT_VISIBLE);
  // "-v2" (yêu cầu người dùng 2026-08-08, cùng lý do đã đổi ở PortTable.tsx).
  const {
    order: colOrder,
    moveColumn,
    reset: resetColOrder,
  } = useColumnOrder<AllCol>("device-position-map-col-order-v2", DEFAULT_ALL_ORDER);
  const orderedAll = colOrder.filter((col) => STRUCTURAL_COLUMNS.has(col) || visible[col as VisibleCol]);
  const [filters, setFilters] = useState<Record<SortKey, string>>({ deviceName: "", devicePosition: "", odfPosition: "" });
  // Lazy init đọc thẳng sessionStorage (xem loadStoredDraft ở trên) — khôi
  // phục lại đúng những gì đang gõ dở nếu component này vừa được tạo lại
  // (đổi trang rồi quay lại, F5, v.v...), không đợi 1 nhịp render rồi mới
  // nạp (tránh nháy rỗng rồi mới hiện lại).
  const [draft, setDraft] = useState<Draft>(loadStoredDraft);
  useEffect(() => {
    try {
      window.sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
      // Best-effort — sessionStorage có thể bị chặn (chế độ ẩn danh khắt khe
      // v.v...), không quan trọng tới mức phải báo lỗi cho người dùng.
    }
  }, [draft]);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Banner xác nhận Thêm/Sửa/Xóa đã thành công (yêu cầu người dùng 2026-08-17
  // — trước đó chỉ có cảnh báo cho ca "Thêm xong nhưng bị bộ lọc ẩn mất",
  // giờ gộp chung cho cả 3 thao tác để luôn biết chắc đã lưu/xóa xong).
  // `highlightId`: id dòng vừa Thêm/Sửa — dùng để cuộn tới + nháy viền xanh
  // (xem useEffect bên dưới), không áp dụng cho Xóa (dòng không còn nữa).
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực

  // Cuộn tới + nháy viền xanh dòng vừa Thêm/Sửa (yêu cầu người dùng
  // 2026-08-17: "phải hiện ra tôi mới biết là thêm thành công hay chưa") —
  // đợi tới khi `rows` (prop mới sau router.refresh()) THẬT SỰ chứa id đó
  // rồi mới cuộn (tránh cuộn hụt khi DOM dòng đó chưa kịp render).
  useEffect(() => {
    if (!highlightId) return;
    if (!rows.some((r) => r.id === highlightId)) return;
    const el = document.getElementById(`dpm-row-${highlightId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    highlightTimeoutRef.current = setTimeout(() => setHighlightId(null), 3000);
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    };
  }, [highlightId, rows]);
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

  // Cảnh báo luồng thiết bị (circuits) đang phụ thuộc đúng dòng thư viện sắp
  // Sửa/Xóa (yêu cầu người dùng 2026-08-17: "thư viện xóa mà luồng vẫn còn
  // thì ko logic") — set khi findCircuitsUsingLibraryRow() tìm thấy kết quả,
  // chặn thao tác thật lại chờ người dùng chọn 1 trong 3 lựa chọn ở panel
  // (xem renderRelatedCircuitsPanel bên dưới).
  interface RelatedCircuitsPrompt {
    action: "edit" | "delete";
    row: DevicePositionMapRow;
    editDraft?: Draft; // chỉ có khi action="edit" — dữ liệu đã validate xong, chờ xác nhận cascade rồi mới lưu
    matches: RelatedCircuitRef[];
    selectedIds: Set<string>;
  }
  const [relatedCircuitsPrompt, setRelatedCircuitsPrompt] = useState<RelatedCircuitsPrompt | null>(null);
  const [circuitCheckBusy, setCircuitCheckBusy] = useState(false);

  const deviceNameOptions = useMemo(() => devices.map((d) => d.name), [devices]);

  function setFilter(key: SortKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSaveNotice(null);
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
        const stationId = await getAdn1StationId(supabase);
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
    setSaveNotice(null);
  }

  function resetCategory() {
    setCategoryFilter(null);
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
    if (draftPreviewActive(draft)) list = list.filter((r) => matchesDraftPreview(r, draft));
    const arr = [...list].sort((a, b) => compareByKey(sortKey, a, b));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [rows, filters, categoryFilter, categoryByDeviceKey, sortKey, sortDir, draft]);

  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (r: DevicePositionMapRow) => string | number | null }[] = [
      { label: "Tên thiết bị", getValue: (r) => r.deviceName },
    ];
    if (visible.devicePosition) cols.push({ label: "Vị trí thiết bị", getValue: (r) => r.devicePosition });
    if (visible.odfPosition) cols.push({ label: "Vị trí ODF/DDF", getValue: (r) => r.odfPosition });
    return cols;
  }, [visible]);

  // Validate CHUNG cho cả Thêm dòng mới lẫn Sửa inline (yêu cầu người dùng
  // 2026-08-03, mở rộng 2026-08-10):
  // (1) tên thiết bị PHẢI khớp đúng 1 thiết bị thật đã chuẩn hóa (không cho
  //     gõ tự do — trước đây đây là nguồn gây lệch tên với /devices);
  // (2) Vị trí thiết bị (Trib)/Vị trí ODF/DDF bắt buộc không rỗng;
  // (3) Vị trí ODF/DDF (khi CÓ VẺ là 1 tọa độ thật — nhắc tới "ODF"/"DDF",
  //     xem looksLikeRealPositionText, loại trừ text kiểu "Kết nối trực
  //     tiếp") PHẢI khớp đúng 1 rack CÓ THẬT trong CSDL (bảng `racks`, xem
  //     `/odf-device`/`/odf-trunk`) và số port phải tồn tại trong rack đó
  //     (yêu cầu người dùng 2026-08-10: "Vị trí ODF/DDF chưa tồn tại trong
  //     CSDL của Hồ sơ ODF thiết bị nhưng vẫn thêm được vào bên thư viện...
  //     là không đúng" — trước đây thư viện cho lưu tọa độ KHÔNG có thật,
  //     khác nguyên tắc "cho lưu text-only trước" áp dụng cho ô luồng thiết
  //     bị (DeviceCircuitList.tsx) vì Ô ĐÓ là dữ liệu vận hành thật còn
  //     THƯ VIỆN này chỉ là gợi ý — gợi ý sai (trỏ tới rack không tồn tại)
  //     không có giá trị, nên chặn hẳn thay vì cho lưu rồi chuẩn hóa sau);
  // (4) trong CÙNG 1 thiết bị, 2 Trib khác nhau không được cùng 1 Vị trí
  //     ODF/DDF THẬT — trừ "Kết nối trực tiếp" (dùng chung hợp lệ cho nhiều
  //     Trib);
  // (5) MỚI (yêu cầu người dùng 2026-08-10): NGƯỢC LẠI — cùng 1 thiết bị +
  //     cùng 1 Trib thì CHỈ được ứng với ĐÚNG 1 Vị trí ODF/DDF (không loại
  //     trừ "Kết nối trực tiếp" — 1 Trib vật lý không thể vừa "nối trực
  //     tiếp" vừa "ra ODF X" cùng lúc, khác rule (4) vốn cho phép NHIỀU Trib
  //     dùng chung 1 giá trị "Kết nối trực tiếp" không mang tính tọa độ).
  function validateLibraryDraft(d: Draft, excludeId: string | null): { canonicalDeviceName: string } | { error: string } {
    const deviceNameTrimmed = d.deviceName.trim();
    const devicePositionTrimmed = d.devicePosition.trim();
    const odfPositionTrimmed = d.odfPosition.trim();
    if (!deviceNameTrimmed) return { error: "Tên thiết bị không được để trống." };
    if (!devicePositionTrimmed) return { error: "Vị trí thiết bị (Trib/port) không được để trống." };
    if (!odfPositionTrimmed) return { error: "Vị trí ODF/DDF không được để trống." };

    const matched = resolveDeviceByExactOrAlias(deviceNameTrimmed, devices, deviceAliases);
    if (!matched) {
      return {
        error: `"${deviceNameTrimmed}" chưa khớp đúng 1 thiết bị nào trong Danh mục thiết bị — chọn đúng tên có sẵn trong gợi ý (hoặc vào /devices tạo thiết bị mới trước).`,
      };
    }

    const isRealPosition = looksLikeRealPositionText(odfPositionTrimmed);
    if (isRealPosition) {
      const rackMatch = matchTrunkPosition(odfPositionTrimmed, trunkPorts);
      if (!rackMatch.matched) {
        return {
          error: `"${odfPositionTrimmed}" chưa khớp rack ODF/DDF nào có thật trong hệ thống — vào /odf-device (hoặc /odf-trunk nếu là tuyến cáp trung kế) thêm rack đó trước (mã rack, loại ODF, số port), rồi mới nhập ở đây.`,
        };
      }
      if (rackMatch.invalidPortNumbers && rackMatch.invalidPortNumbers.length > 0) {
        return {
          error: `Port ${rackMatch.invalidPortNumbers.join(",")} không tồn tại trong rack "${rackMatch.rackCode}" — kiểm tra lại số port, hoặc sửa số port của rack đó nếu thiếu.`,
        };
      }
    }

    const nameKey = normalizeDeviceNameKey(matched.name);
    const tribKey = normalizeDevicePositionKey(devicePositionTrimmed);
    const odfKey = normalizeDevicePositionKey(odfPositionTrimmed);

    // Rule (5) MỚI — cùng thiết bị + cùng Trib phải cùng 1 Vị trí ODF/DDF.
    const tribConflict = rows.find(
      (r) =>
        r.id !== excludeId &&
        normalizeDeviceNameKey(r.deviceName) === nameKey &&
        normalizeDevicePositionKey(r.devicePosition ?? "") === tribKey &&
        normalizeDevicePositionKey(r.odfPosition ?? "") !== odfKey
    );
    if (tribConflict) {
      return {
        error: `"${matched.name}" ở Trib "${devicePositionTrimmed}" đã có vị trí ODF/DDF khác là "${tribConflict.odfPosition ?? ""}" (dòng khác) — 1 Trib chỉ được ứng với ĐÚNG 1 vị trí ODF/DDF. Sửa hoặc xóa dòng cũ trước nếu vị trí thật sự đã đổi.`,
      };
    }

    // Rule (4) đã có — cùng thiết bị, 2 Trib khác nhau không dùng chung 1
    // vị trí ODF/DDF THẬT (trừ "Kết nối trực tiếp").
    if (isRealPosition) {
      const conflict = rows.find(
        (r) =>
          r.id !== excludeId &&
          normalizeDeviceNameKey(r.deviceName) === nameKey &&
          normalizeDevicePositionKey(r.devicePosition ?? "") !== tribKey &&
          normalizeDevicePositionKey(r.odfPosition ?? "") === odfKey
      );
      if (conflict) {
        return {
          error: `Vị trí "${odfPositionTrimmed}" đã được dùng cho "${matched.name}" ở Trib "${conflict.devicePosition ?? ""}" (dòng khác) — 1 vị trí ODF/DDF chỉ được gán cho ĐÚNG 1 Trib của thiết bị này (trừ "Kết nối trực tiếp").`,
        };
      }
    }
    return { canonicalDeviceName: matched.name };
  }

  async function addRow() {
    setError(null);
    const validated = validateLibraryDraft(draft, null);
    if ("error" in validated) {
      setError(validated.error);
      return;
    }
    setBusy(true);
    setSaveNotice(null);
    const deviceName = validated.canonicalDeviceName;
    const devicePosition = draft.devicePosition.trim();
    const odfPosition = draft.odfPosition.trim();
    const { data: inserted, error: err } = await supabase
      .from("device_position_map")
      .insert({ device_name: deviceName, device_position: devicePosition, odf_position: odfPosition })
      .select("id")
      .single();
    setBusy(false);
    if (err) {
      setError(translatePgError(err.message));
      return;
    }

    // Kiểm tra ngay: dòng vừa lưu có bị bộ lọc cột HOẶC chip Lĩnh vực đang
    // chọn loại khỏi bảng không — xem ghi chú ở khai báo saveNotice.
    const passesColumnFilters =
      matchesFilter(deviceName, filters.deviceName) &&
      matchesFilter(devicePosition, filters.devicePosition) &&
      matchesFilter(odfPosition, filters.odfPosition);
    const newRowCategory = categoryByDeviceKey.get(normalizeDeviceNameKey(deviceName)) ?? UNCATEGORIZED_LABEL;
    const passesCategory = categoryFilter === null || categoryFilter.includes(newRowCategory);
    setSaveNotice(
      !passesColumnFilters || !passesCategory
        ? `Đã lưu dòng mới ("${deviceName}"), nhưng đang bị ẩn bởi bộ lọc hiện tại.`
        : `Đã lưu dòng mới ("${deviceName}" — "${devicePosition}" — "${odfPosition}").`
    );
    setHighlightId(inserted?.id ?? null);
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

  // Thực thi THẬT sự lệnh Sửa (đã qua validate + đã qua bước hỏi cascade nếu
  // cần) — tách riêng khỏi saveEdit() vì có 2 lối gọi tới: lưu thẳng (không
  // có luồng liên quan) hoặc lưu sau khi người dùng đã chọn xong ở panel
  // cảnh báo (xem renderRelatedCircuitsPanel).
  async function performSaveEdit(id: string, canonicalDeviceName: string, d: Draft) {
    setBusy(true);
    const { error: err } = await supabase
      .from("device_position_map")
      .update({ device_name: canonicalDeviceName, device_position: d.devicePosition.trim(), odf_position: d.odfPosition.trim() })
      .eq("id", id);
    setBusy(false);
    if (err) {
      setError(translatePgError(err.message));
      return;
    }
    setSaveNotice(`Đã sửa dòng ("${canonicalDeviceName}" — "${d.devicePosition.trim()}" — "${d.odfPosition.trim()}").`);
    setHighlightId(id);
    setEditId(null);
    router.refresh();
  }

  async function saveEdit() {
    if (!editId) return;
    setError(null);
    const validated = validateLibraryDraft(editDraft, editId); // excludeId = chính dòng đang sửa, không tự đụng với chính nó
    if ("error" in validated) {
      setError(validated.error);
      return;
    }
    const oldRow = rows.find((r) => r.id === editId);
    const identityChanged =
      !oldRow ||
      normalizeDeviceNameKey(oldRow.deviceName) !== normalizeDeviceNameKey(validated.canonicalDeviceName) ||
      normalizeDevicePositionKey(oldRow.devicePosition ?? "") !== normalizeDevicePositionKey(editDraft.devicePosition) ||
      normalizeDevicePositionKey(oldRow.odfPosition ?? "") !== normalizeDevicePositionKey(editDraft.odfPosition);
    if (oldRow && identityChanged) {
      setCircuitCheckBusy(true);
      let matches: RelatedCircuitRef[] = [];
      try {
        matches = await findCircuitsUsingLibraryRow(supabase, {
          deviceName: oldRow.deviceName,
          devicePosition: oldRow.devicePosition ?? "",
          odfPosition: oldRow.odfPosition ?? "",
        });
      } catch (e) {
        setCircuitCheckBusy(false);
        setError(e instanceof Error ? translatePgError(e.message) : String(e));
        return;
      }
      setCircuitCheckBusy(false);
      if (matches.length > 0) {
        setRelatedCircuitsPrompt({ action: "edit", row: oldRow, editDraft, matches, selectedIds: new Set() });
        return;
      }
    }
    await performSaveEdit(editId, validated.canonicalDeviceName, editDraft);
  }

  async function performDeleteRow(r: DevicePositionMapRow) {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from("device_position_map").delete().eq("id", r.id);
    setBusy(false);
    if (err) {
      setError(translatePgError(err.message));
      return;
    }
    setSaveNotice(`Đã xóa dòng ("${r.deviceName}" — "${r.devicePosition ?? ""}" — "${r.odfPosition ?? ""}").`);
    router.refresh();
  }

  async function deleteRow(r: DevicePositionMapRow) {
    setError(null);
    setCircuitCheckBusy(true);
    let matches: RelatedCircuitRef[] = [];
    try {
      matches = await findCircuitsUsingLibraryRow(supabase, {
        deviceName: r.deviceName,
        devicePosition: r.devicePosition ?? "",
        odfPosition: r.odfPosition ?? "",
      });
    } catch (e) {
      setCircuitCheckBusy(false);
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
      return;
    }
    setCircuitCheckBusy(false);
    if (matches.length > 0) {
      setRelatedCircuitsPrompt({ action: "delete", row: r, matches, selectedIds: new Set() });
      return;
    }
    // Không có luồng nào liên quan — giữ nguyên hành vi confirm() gọn như cũ.
    if (!confirm(`Xóa dòng "${r.deviceName}" — "${r.devicePosition ?? ""}" — "${r.odfPosition ?? ""}"?`)) return;
    await performDeleteRow(r);
  }

  // Xóa hàng loạt luồng THẬT (circuits) đã tick trong panel cảnh báo — tái
  // dùng ĐÚNG quy trình an toàn của DeviceCircuitList.tsx (tra mirror trung
  // kế TRƯỚC khi xóa, dọn ports/transit_links SAU khi xóa) để không để sót
  // mirror mồ côi, xem lib/mirrorTrunkCircuits.ts.
  async function deleteCircuitsCascade(ids: string[]) {
    if (ids.length === 0) return;
    const mirrors = [...(await findMirrorTrunkCircuits(supabase, ids)).values()];
    const { error: err } = await supabase.from("circuits").delete().in("id", ids);
    if (err) throw err;
    if (mirrors.length > 0) await cleanupAfterMirrorCascade(supabase, mirrors);
  }

  function toggleRelatedCircuitSelect(id: string) {
    setRelatedCircuitsPrompt((prev) => {
      if (!prev) return prev;
      const next = new Set(prev.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...prev, selectedIds: next };
    });
  }

  // 3 lựa chọn ở panel cảnh báo (xem renderRelatedCircuitsPanel): giữ
  // nguyên các luồng, xóa các luồng đã tick trước khi Sửa/Xóa thư viện, hoặc
  // hủy toàn bộ (không đụng gì).
  async function resolveRelatedCircuitsPrompt(mode: "onlyLibrary" | "withCircuits" | "cancel") {
    const prompt = relatedCircuitsPrompt;
    if (!prompt) return;
    if (mode === "cancel") {
      setRelatedCircuitsPrompt(null);
      return;
    }
    setBusy(true);
    try {
      if (mode === "withCircuits" && prompt.selectedIds.size > 0) {
        await deleteCircuitsCascade([...prompt.selectedIds]);
      }
    } catch (e) {
      setBusy(false);
      setError(`Xóa luồng liên quan thất bại, CHƯA thực hiện thao tác thư viện: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
      return;
    }
    setBusy(false);
    setRelatedCircuitsPrompt(null);
    if (prompt.action === "delete") {
      await performDeleteRow(prompt.row);
    } else {
      const validated = validateLibraryDraft(prompt.editDraft!, prompt.row.id);
      if ("error" in validated) {
        setError(validated.error); // Không thể xảy ra thực tế (đã validate ở saveEdit() trước khi mở panel) — phòng hờ.
        return;
      }
      await performSaveEdit(prompt.row.id, validated.canonicalDeviceName, prompt.editDraft!);
    }
  }

  function colWidthOf(col: AllCol): number {
    if (col === "actions") return 140;
    return colWidths[col];
  }

  function renderHeaderCell(col: AllCol) {
    // `activeSortKey` ép kiểu AllCol (thay vì SortKey rộng hơn) chỉ để
    // TypeScript suy luận đúng K=AllCol cho <DataTh> ở đây. "actions" không
    // sortable/filterable (không phải dữ liệu) — mỗi case tự khai báo
    // sortKey riêng thay vì gộp chung vào `common`.
    const common = {
      key: col,
      activeSortKey: sortKey as AllCol,
      sortDir,
      onSort: toggleSort as (k: AllCol) => void,
      reorderKey: col,
      onReorderColumn: moveColumn,
    } as const;
    switch (col) {
      case "deviceName":
        return (
          <DataTh
            {...common}
            sortKey="deviceName"
            label="Tên thiết bị"
            width={colWidths.deviceName}
            onResize={(w) => resizeCol("deviceName", w)}
            filterValue={filters.deviceName}
            onFilterChange={(v) => setFilter("deviceName", v)}
          />
        );
      case "devicePosition":
        return (
          <DataTh
            {...common}
            sortKey="devicePosition"
            label="Vị trí thiết bị"
            width={colWidths.devicePosition}
            onResize={(w) => resizeCol("devicePosition", w)}
            filterValue={filters.devicePosition}
            onFilterChange={(v) => setFilter("devicePosition", v)}
          />
        );
      case "odfPosition":
        return (
          <DataTh
            {...common}
            sortKey="odfPosition"
            label="Vị trí ODF/DDF"
            width={colWidths.odfPosition}
            onResize={(w) => resizeCol("odfPosition", w)}
            filterValue={filters.odfPosition}
            onFilterChange={(v) => setFilter("odfPosition", v)}
          />
        );
      case "actions":
        return <DataTh {...common} sortKey={undefined} label="Thao tác" />;
    }
  }

  function renderEditCell(col: AllCol) {
    switch (col) {
      case "deviceName":
        return (
          <td key={col} className="px-3 py-2">
            <input
              className="input"
              list="dpm-device-name-options"
              value={editDraft.deviceName}
              onChange={(e) => setEditDraft({ ...editDraft, deviceName: e.target.value })}
              autoFocus
            />
          </td>
        );
      case "devicePosition":
        return (
          <td key={col} className="px-3 py-2">
            <input
              className="input"
              value={editDraft.devicePosition}
              onChange={(e) => setEditDraft({ ...editDraft, devicePosition: e.target.value })}
            />
          </td>
        );
      case "odfPosition":
        return (
          <td key={col} className="px-3 py-2">
            <input
              className="input"
              list="dpm-odf-position-options"
              value={editDraft.odfPosition}
              onChange={(e) => setEditDraft({ ...editDraft, odfPosition: e.target.value })}
              onBlur={() => {
                const match = matchTrunkPosition(editDraft.odfPosition, trunkPorts);
                const canonical = formatCanonicalOdfPosition(match);
                if (canonical && canonical !== editDraft.odfPosition) setEditDraft((d) => ({ ...d, odfPosition: canonical }));
              }}
            />
          </td>
        );
      case "actions":
        return (
          <td key={col} className="px-3 py-2">
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveEdit} disabled={busy}>
                Lưu
              </button>
              <button className="btn-secondary" onClick={cancelEdit} disabled={busy}>
                Hủy
              </button>
            </div>
          </td>
        );
    }
  }

  function renderViewCell(col: AllCol, r: DevicePositionMapRow) {
    switch (col) {
      case "deviceName": {
        // Highlight NGAY TẠI DÒNG khi tên chưa khớp thiết bị nào trong Danh
        // mục thiết bị (yêu cầu người dùng 2026-08-10) — bổ sung cho khung
        // tổng hợp "Chuẩn hóa tên thiết bị chưa khớp" phía trên (chỉ liệt kê
        // gộp nhóm, không thấy ngay khi đang cuộn/lọc bảng chính).
        const unmatched = !existingDeviceKeys.has(normalizeDeviceNameKey(r.deviceName));
        return (
          <td key={col} className="px-3 py-2 text-slate-700 break-words">
            {r.deviceName}
            {unmatched && (
              <span
                className="ml-1.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                title='Tên thiết bị này chưa khớp thiết bị nào trong Danh mục thiết bị (/devices) — thêm thiết bị đó vào Danh mục nếu còn tồn tại, hoặc xóa dòng này nếu không còn dùng nữa.'
              >
                chưa khớp Danh mục
              </span>
            )}
          </td>
        );
      }
      case "devicePosition":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.devicePosition ?? "—"}
          </td>
        );
      case "odfPosition":
        return (
          <td key={col} className="px-3 py-2 text-slate-600 break-words">
            {r.odfPosition ?? "—"}
          </td>
        );
      case "actions":
        return (
          <td key={col} className="px-3 py-2">
            <RoleGate allow={["operator", "admin"]}>
              <div className="flex gap-2">
                <button
                  className="text-primary-600 hover:underline disabled:opacity-50"
                  onClick={() => openEdit(r)}
                  disabled={busy || circuitCheckBusy}
                  title="Sửa"
                  aria-label="Sửa"
                >
                  <IconEdit />
                </button>
                <button
                  className="text-red-600 hover:underline disabled:opacity-50"
                  onClick={() => deleteRow(r)}
                  disabled={busy || circuitCheckBusy}
                  title={circuitCheckBusy ? "Đang kiểm tra luồng liên quan..." : "Xóa"}
                  aria-label="Xóa"
                >
                  <IconTrash />
                </button>
              </div>
            </RoleGate>
          </td>
        );
    }
  }

  // Panel cảnh báo khi Sửa/Xóa 1 dòng thư viện đang có luồng THẬT (circuits)
  // tham chiếu đúng vị trí đó (yêu cầu người dùng 2026-08-17: "thư viện xóa
  // mà luồng vẫn còn thì ko logic") — xem findCircuitsUsingLibraryRow() ở
  // lib/devicePositionMap.ts. Checkbox mặc định KHÔNG tick (không tự chọn
  // xóa hộ luồng thật thay người dùng).
  function renderRelatedCircuitsPanel(prompt: {
    action: "edit" | "delete";
    row: DevicePositionMapRow;
    matches: RelatedCircuitRef[];
    selectedIds: Set<string>;
  }) {
    const actionLabel = prompt.action === "delete" ? "Xóa" : "Sửa";
    return (
      <div className="mb-4 rounded-lg border border-red-200 bg-red-50/60 p-3">
        <p className="text-sm font-medium text-red-800">
          {actionLabel} dòng thư viện "{prompt.row.deviceName}" — "{prompt.row.devicePosition ?? ""}" — "{prompt.row.odfPosition ?? ""}
          " sẽ khiến {prompt.matches.length} luồng thiết bị sau LỆCH khỏi thư viện (Hồ sơ đấu nối):
        </p>
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {prompt.matches.map((m) => (
            <label key={m.id} className="flex items-start gap-2 rounded-md border border-red-100 bg-white p-2 text-sm hover:bg-red-50/40">
              <input type="checkbox" className="mt-1" checked={prompt.selectedIds.has(m.id)} onChange={() => toggleRelatedCircuitSelect(m.id)} />
              <span>
                <span className="text-slate-700">{m.name || "(chưa đặt tên)"}</span>
                <span className="ml-2 text-xs text-slate-400">
                  — {m.side === "own" ? "luồng của chính thiết bị/Trib này" : `luồng của thiết bị khác (${m.deviceName ?? "?"} — ${m.tribText ?? ""})`}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-red-700">Tick chọn luồng muốn XÓA LUÔN (không thể hoàn tác), hoặc để trống nếu chỉ muốn {actionLabel.toLowerCase()} thư viện.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => resolveRelatedCircuitsPrompt("withCircuits")} disabled={busy}>
            {actionLabel} thư viện + xóa luồng đã tick ({prompt.selectedIds.size})
          </button>
          <button className="btn-secondary" onClick={() => resolveRelatedCircuitsPrompt("onlyLibrary")} disabled={busy}>
            Chỉ {actionLabel.toLowerCase()} thư viện, giữ nguyên luồng
          </button>
          <button className="text-sm text-slate-500 hover:underline" onClick={() => resolveRelatedCircuitsPrompt("cancel")} disabled={busy}>
            Hủy
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}

      <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
        <p className="text-sm font-medium text-primary-800 mb-2">Thêm dòng mới</p>
        <div className="flex flex-wrap items-center gap-2">
          <ClearableInput
            className="w-auto max-w-[220px]"
            list="dpm-device-name-options"
            placeholder="VD: ADN1.OTS2 BB1"
            value={draft.deviceName}
            onChange={(v) => setDraft({ ...draft, deviceName: v })}
          />
          <datalist id="dpm-device-name-options">
            {deviceNameOptions.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
          <ClearableInput
            className="w-auto max-w-[220px]"
            placeholder="VD: S1-1, 1/0/27"
            value={draft.devicePosition}
            onChange={(v) => setDraft({ ...draft, devicePosition: v })}
          />
          <ClearableInput
            className="w-auto max-w-[220px]"
            list="dpm-odf-position-options"
            placeholder="VD: ODF 5/7 (37,38)"
            value={draft.odfPosition}
            onChange={(v) => setDraft({ ...draft, odfPosition: v })}
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
          <RoleGate allow={["operator", "admin"]}>
            <button className="btn-primary" onClick={addRow} disabled={busy}>
              Thêm
            </button>
          </RoleGate>
        </div>
        {saveNotice && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <span>{saveNotice}</span>
            {(Object.values(filters).some((v) => v) || categoryFilter !== null || draftPreviewActive(draft)) && (
              <button
                type="button"
                className="font-medium underline hover:text-emerald-900"
                onClick={() => {
                  setFilters({ deviceName: "", devicePosition: "", odfPosition: "" });
                  setCategoryFilter(null);
                  setSaveNotice(null);
                }}
              >
                Bỏ lọc để xem
              </button>
            )}
          </div>
        )}
      </div>

      {relatedCircuitsPrompt && renderRelatedCircuitsPanel(relatedCircuitsPrompt)}

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
                  <select className="input w-auto max-w-[200px]" value={renameCategory} onChange={(e) => setRenameCategory(e.target.value)}>
                    <option value="">Lĩnh vực (nếu tạo thiết bị mới)</option>
                    {deviceCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <RoleGate allow={["operator", "admin"]}>
                    <button className="btn-primary" onClick={applyRenameGroups} disabled={renameBusy}>
                      {renameBusy ? "Đang lưu..." : "Áp dụng"}
                    </button>
                  </RoleGate>
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
        <div className="ml-auto flex gap-2">
          <RefreshButton />
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Vị trí thiết bị" fileNamePrefix="Thu_vien_vi_tri_thiet_bi" />
          <ColumnPicker
            items={COLUMN_ITEMS}
            order={colOrder.filter((col): col is VisibleCol => OPTIONAL_COL_SET.has(col))}
            visible={visible}
            onToggle={toggleColumn}
            onReorderColumn={moveColumn as (dragged: VisibleCol, target: VisibleCol) => void}
            onResetOrder={resetColOrder}
          />
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {orderedAll.map((col) => (
              <col key={col} style={{ width: colWidthOf(col) }} />
            ))}
          </colgroup>
          <thead className="text-primary-800">
            <tr>{orderedAll.map((col) => renderHeaderCell(col))}</tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const editing = editId === r.id;
              const unmatched = !existingDeviceKeys.has(normalizeDeviceNameKey(r.deviceName));
              const highlighted = r.id === highlightId;
              return (
                <tr
                  key={r.id}
                  id={`dpm-row-${r.id}`}
                  className={`border-t border-slate-100 transition-colors ${
                    highlighted ? "bg-green-100 ring-2 ring-inset ring-green-400" : unmatched && !editing ? "bg-amber-50 hover:bg-amber-100" : "hover:bg-primary-50/50"
                  }`}
                >
                  {editing ? orderedAll.map((col) => renderEditCell(col)) : orderedAll.map((col) => renderViewCell(col, r))}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={2 + COLUMN_ITEMS.filter((c) => visible[c.key]).length}
                  className="px-4 py-6 text-center text-slate-400"
                >
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
