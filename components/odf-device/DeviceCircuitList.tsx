"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import { isPlaceholderCircuitName, normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";
import { deviceCategoryLabel, getAdn1StationId, UNCATEGORIZED_LABEL } from "@/lib/devices";
import { formatLastUpdated, isUpdatedToday } from "@/lib/format";
import {
  parseTransitText,
  isManagedStationCode,
  splitOdfDeviceStructure,
  combinePositionNext,
} from "@/lib/parsers/transit-text";
import {
  matchTrunkPosition,
  findPortsByFiberNumbers,
  parseNumberList,
  formatCanonicalOdfPosition,
  type TrunkPortRow,
  type TrunkPositionMatch,
} from "@/lib/trunkPorts";
import { useColumnWidths } from "@/lib/useColumnWidths";
import { useColumnVisibility } from "@/lib/useColumnVisibility";
import { buildDeviceCircuitReportText } from "@/lib/circuitReportText";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import SearchableSelect from "@/components/ui/SearchableSelect";
import DataTh from "@/components/ui/DataTh";
import SlideOverPanel from "@/components/ui/SlideOverPanel";
import MirrorLinkStatusIcon from "@/components/ui/MirrorLinkStatusIcon";
import ColumnPicker from "@/components/ui/ColumnPicker";
import CircuitReportPanel from "@/components/ui/CircuitReportPanel";
import ReportHistoryDrawer from "@/components/ui/ReportHistoryDrawer";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EmptyUntilFiltered from "@/components/ui/EmptyUntilFiltered";
import { IconEdit, IconTrash } from "@/components/ui/icons";
import RoleGate from "@/components/ui/RoleGate";
import {
  unlinkCircuitMirror,
  mirrorLinkStatusLabel,
  mirrorLinkFilterKey,
  MIRROR_LINK_FILTER_OPTIONS,
  type MirrorLinkStatus,
} from "@/lib/mirrorLinkStatus";
import { applySyncFromDevice, hasPositionChanged, hasTribChanged, type CircuitPairDetail } from "@/lib/circuitPairSync";
import CircuitPairSyncPanel from "@/components/data-quality/CircuitPairSyncPanel";
import { findDevicePositionConflicts, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { confirmBulkDelete } from "@/lib/dangerousConfirm";
import {
  findMirrorTrunkCircuits,
  cleanupAfterMirrorCascade,
  autoCreateTrunkMirrorForCircuit,
  replaceOccupantAndCreateTrunkMirror,
  type MirrorTrunkMatch,
} from "@/lib/mirrorTrunkCircuits";
import { autoCreateMirrorForCircuit, replaceMismatchedDeviceMirror } from "@/lib/deviceDeviceSync";
import { resolveDeviceByExactOrAlias, findLooseDeviceCandidate, saveDeviceAlias, type DeviceAliasRow } from "@/lib/deviceAliases";
import { translatePgError } from "@/lib/translatePgError";
import type { DeviceRow } from "@/lib/devices";
import type { DevicePositionMapRow } from "@/lib/devicePositionMap";

// Header dùng components/ui/DataTh.tsx (quy định chung cho mọi bảng, xem
// architecture.md) — trước đây có 2 bản viết riêng (SortFilterTh/
// FilterOnlyTh) ở đây, đã gộp vào DataTh dùng chung với PortTable.tsx và các
// bảng khác.

// rowAnchor() chuyển sang lib/deviceCircuitAnchor.ts (file "use client" này
// không dùng trực tiếp được từ Server Component như DeviceRackPortView.tsx)
// — import lại ở đây (dùng ở nhiều chỗ trong file này, xem bên dưới).
export { rowAnchor };

// Tên tự sinh "(chưa đặt tên)..." chỉ hiện khi CHƯA có vị trí ODF tiếp theo
// (chưa có luồng dịch vụ thật) — hiện đúng tên hồ sơ khi đã có, để trống cho
// gọn khi chưa có (xem lib/deviceNotes.ts).
function displayName(c: DeviceCircuitRow): string {
  if (isPlaceholderCircuitName(c.name) && !c.devicePositionNext) return "";
  return c.name;
}

// Hiện tên tuyến cáp trung kế NGAY trong bảng danh sách, không cần bấm Sửa
// mới thấy (yêu cầu người dùng 2026-07-28: "chưa bấm sửa thì không có tên
// ODF Trung kế đó còn bấm vào sửa thì nó mới hiện thị"). Dữ liệu CŨ (trước
// form 3 ô 2026-07-27) chỉ lưu tọa độ ODF trơn trong device_position_next —
// splitOdfDeviceStructure() không khớp được cấu trúc "ODF... - Tên (...)"
// nên chưa có tên nào đính kèm để hiện. Chỉ trong trường hợp NÀY mới cần tự
// tính thêm (đối chiếu sống qua matchTrunkPosition, y hệt cách form Sửa đang
// làm) rồi nối thêm tên tuyến cáp vào cho dễ xem — dòng đã có cấu trúc sẵn
// (đã lưu qua form mới) thì giữ nguyên chữ đã lưu, không tính lại (tránh
// lệch nếu tên tuyến cáp đổi sau khi luồng này đã lưu).
function positionNextDisplay(raw: string | null, trunkPorts: TrunkPortRow[]): string {
  if (!raw) return "—";
  if (splitOdfDeviceStructure(raw).matched) return raw;
  const trunkMatch = matchTrunkPosition(raw, trunkPorts);
  if (trunkMatch.matched && trunkMatch.rackDomain === "trunk" && trunkMatch.cableRouteName) {
    return `${raw} - ${trunkMatch.cableRouteName}`;
  }
  return raw;
}

type SortKey = "name" | "linkStatus" | "trib" | "device" | "positionOwn" | "positionNext" | "interface" | "counterpart";
type FilterKey = SortKey | "notes";

function cellText(c: DeviceCircuitRow, key: FilterKey, mirrorLinkStatuses?: Record<string, MirrorLinkStatus>): string | null {
  switch (key) {
    case "name":
      return c.name;
    case "linkStatus":
      return mirrorLinkFilterKey(mirrorLinkStatuses?.[c.id]);
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

function compareByKey(key: SortKey, a: DeviceCircuitRow, b: DeviceCircuitRow, mirrorLinkStatuses?: Record<string, MirrorLinkStatus>): number {
  return compareValues(cellText(a, key, mirrorLinkStatuses), cellText(b, key, mirrorLinkStatuses));
}

const FILTER_KEYS: FilterKey[] = ["name", "linkStatus", "trib", "device", "positionOwn", "positionNext", "interface", "counterpart", "notes"];

// Ô "Vị trí ODF (tiếp theo)" tách 3 ô khi sửa/nhập (yêu cầu người dùng
// 2026-07-27, tinh chỉnh lại yêu cầu ngày 2026-07-27 sau: tự nhận diện chế độ
// Thiết bị/Cáp quang trung kế, KHÔNG cần chọn tay nữa): Ô1 = tọa độ ODF, Ô2 =
// "tiếp theo" là THIẾT BỊ hay CÁP QUANG TRUNG KẾ, Ô3 = Trib/Sợi "tiếp theo".
// Chế độ được SUY RA từ chính Ô1 qua matchTrunkPosition() (lib/trunkPorts.ts)
// — nếu Ô1 khớp được 1 rack trung kế THẬT thì chắc chắn là ca "đấu thẳng ra
// trung kế" (rack/port bên ODF/DDF thiết bị KHÔNG được tạo thật trong hệ
// thống — xem architecture.md mục 7.2, vẫn luôn là text tự do — nên không thể
// nhầm 2 trường hợp). Khi đã khớp: Ô2 tự điền tên tuyến cáp (KHÔNG cho sửa
// tay, đảm bảo toàn vẹn dữ liệu), Ô3 tự suy 2 chiều Port<->Sợi qua
// findPortsByFiberNumbers(). Vẫn lưu gộp lại ĐÚNG 1 chuỗi vào
// circuits.device_position_next (KHÔNG đổi schema — xem combinePositionNext
// trong lib/parsers/transit-text) giống hệt cách "Chuyển tiếp" bên trung kế
// đã làm.
//
// Khảo sát thật 2026-07-27: 100% dữ liệu device_position_next TỪ TRƯỚC chỉ là
// tọa độ ODF trơn (không có cấu trúc ghép) — nên khi KHÔNG khớp
// splitOdfDeviceStructure, coi toàn bộ text cũ là Ô1, để trống Ô2/Ô3, không
// mất dữ liệu. Khác PortTable.tsx (ẩn/hiện 2 ô tùy có khớp cấu trúc hay
// không) — ở đây LUÔN hiện đủ 3 ô vì đa số dữ liệu vốn chỉ có Ô1.
// Sửa 2026-08-02 (người dùng, khi Sửa 1 luồng báo thiếu "Cáp quang (tiếp
// theo)" dù Ô1 đã khớp đúng 1 tuyến cáp trung kế thật): Ô2/Ô3 ở CHẾ ĐỘ CÁP
// QUANG hiển thị (render) LUÔN đọc trực tiếp từ `matchTrunkPosition()` sống
// (xem renderCircuitFormFields, dòng `trunkMatch.cableRouteName`) — KHÔNG
// đọc từ state được tách ở đây. Trước đây hàm này CHỈ tách qua
// `splitOdfDeviceStructure` (đòi hỏi đúng mẫu "ODF... - Tên (n,m)"); dữ liệu
// cũ/import có thể khớp rack trung kế thật ở Ô1 nhưng không đúng y hệt mẫu
// đó (thiếu "()" quanh Sợi, cách ghi khác) khiến STATE `positionNextDevice`
// bị để RỖNG dù trên màn hình vẫn hiện đúng tên tuyến cáp — lệch giữa "cái
// đang thấy" và "cái sắp lưu", tới lúc `findMissingRequiredFields()` đọc
// STATE thì báo thiếu SAI. Fix tại gốc: khi Ô1 khớp rack trung kế thật, LUÔN
// suy Ô2/Ô3 từ chính rack/port thật đó (giống hệt onChange của Ô1), không
// phụ thuộc dữ liệu text cũ có đúng mẫu ghép hay không.
function splitPositionNextForEdit(raw: string, trunkPorts: TrunkPortRow[]): { odf: string; device: string; trib: string } {
  const split = splitOdfDeviceStructure(raw);
  const odf = split.matched ? split.odfPart ?? "" : raw.trim();
  const trunkMatch = matchTrunkPosition(odf, trunkPorts);
  if (trunkMatch.matched && trunkMatch.rackDomain === "trunk") {
    const cleanPorts = !trunkMatch.invalidPortNumbers || trunkMatch.invalidPortNumbers.length === 0;
    const fiberText =
      cleanPorts && trunkMatch.resolvedPorts && trunkMatch.resolvedPorts.length > 0
        ? trunkMatch.resolvedPorts.map((p) => p.fiberNumber ?? p.portNumber).join(",")
        : split.matched
          ? split.port ?? ""
          : "";
    return { odf, device: trunkMatch.cableRouteName ?? "", trib: fiberText };
  }
  if (split.matched && split.deviceName && split.port) {
    return { odf: split.odfPart ?? "", device: split.deviceName, trib: split.port };
  }
  return { odf, device: "", trib: "" };
}

interface EditState {
  id: string;
  deviceName: string | null;
  name: string;
  tribText: string;
  positionOwn: string;
  positionNextOdf: string;
  positionNextDevice: string;
  positionNextTrib: string;
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
  positionNextOdf: string;
  positionNextDevice: string;
  positionNextTrib: string;
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
  positionNextOdf: "",
  positionNextDevice: "",
  positionNextTrib: "",
  interfaceType: "",
  counterpartText: "",
  notes: "",
};

// Các trường DÙNG CHUNG giữa form "Thêm luồng mới" và "Sửa luồng" (yêu cầu
// người dùng 2026-07-27: khung Sửa phải giống hệt khung Thêm, vì bản chất là
// cùng các trường đó) — chỉ khác ở phần chọn/hiển thị Thiết bị (Thêm được
// chọn Lĩnh vực+Thiết bị, Sửa chỉ hiện tên thiết bị tĩnh vì không đổi thiết
// bị của luồng đã có ở đây). EditState/CreateDraft cùng đặt tên field giống
// hệt nhau cho phần chung này nên Pick từ CreateDraft dùng chung được cho cả
// 2 phía.
type SharedCircuitFields = Pick<
  CreateDraft,
  | "name"
  | "tribText"
  | "positionOwn"
  | "positionNextOdf"
  | "positionNextDevice"
  | "positionNextTrib"
  | "interfaceType"
  | "counterpartText"
  | "notes"
>;

// Id gắn vào khung "Sửa luồng thiết bị" để cuộn tới khi bấm Sửa — khung này
// nằm cố định ngay dưới khung "Thêm luồng mới" (đầu trang), có thể ở ngoài
// tầm nhìn nếu người dùng đang cuộn sâu trong bảng khi bấm Sửa.
const EDIT_BOX_ID = "dc-edit-box";

// Độ rộng cột co dãn được (yêu cầu người dùng 2026-07-27: "các bảng dữ liệu
// đều" phải kéo to/nhỏ cột được) — chỉ áp cho cột chứa text dài, các cột
// ngắn/giá trị cố định (Trib, Giao tiếp, Thao tác) giữ nguyên không co dãn.
type ResizableCol = "name" | "device" | "positionOwn" | "positionNext" | "counterpart" | "notes";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = {
  name: 260,
  device: 180,
  positionOwn: 170,
  positionNext: 220,
  counterpart: 200,
  notes: 200,
};

// Ẩn/hiện cột tùy chọn (yêu cầu người dùng 2026-08-07) — tick, "Tên luồng",
// "Thao tác" luôn hiện. "Thiết bị" KHÔNG nằm trong danh sách này — cột đó đã
// có cơ chế ẩn/hiện riêng theo bộ lọc (showDeviceColumn ở trên), không trộn
// 2 cơ chế lại với nhau.
type VisibleCol = "linkStatus" | "trib" | "positionOwn" | "positionNext" | "interface" | "counterpart" | "notes";
const DEFAULT_VISIBLE: Record<VisibleCol, boolean> = {
  linkStatus: true,
  trib: true,
  positionOwn: true,
  positionNext: true,
  interface: true,
  counterpart: true,
  notes: true,
};
const COLUMN_ITEMS: { key: VisibleCol; label: string }[] = [
  { key: "linkStatus", label: "Trạng thái" },
  { key: "trib", label: "Trib" },
  { key: "positionOwn", label: "Vị trí ODF (thiết bị)" },
  { key: "positionNext", label: "Vị trí ODF (tiếp theo)" },
  { key: "interface", label: "Giao tiếp" },
  { key: "counterpart", label: "Đối phương" },
  { key: "notes", label: "Ghi chú" },
];

export default function DeviceCircuitList({
  circuits,
  devices,
  devicePositionMap,
  trunkPorts,
  mirrorLinkStatuses,
  circuitPairDetails,
  deviceAliases,
}: {
  circuits: DeviceCircuitRow[];
  devices: DeviceRow[];
  devicePositionMap: DevicePositionMapRow[];
  trunkPorts: TrunkPortRow[];
  mirrorLinkStatuses?: Record<string, MirrorLinkStatus>;
  circuitPairDetails?: CircuitPairDetail[];
  deviceAliases: DeviceAliasRow[];
}) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  const [deviceNames, setDeviceNames] = useState<string[] | null>(null); // null = tất cả thiết bị (trong phạm vi lĩnh vực)
  // Mặc định KHÔNG hiện bảng (yêu cầu người dùng 2026-08-08: bảng 2000+ luồng
  // load hết ngay lúc mở tab làm chậm) — chỉ hiện khi đã chọn lĩnh vực/thiết
  // bị THẬT (categoryFilter/deviceNames khác null) HOẶC người dùng chủ động
  // bấm "Xem tất cả". Khác với trước đây (categoryFilter=null mặc định coi là
  // "xem hết") — giờ null CHỈ còn nghĩa "chưa lọc theo lĩnh vực", việc có HIỆN
  // bảng hay không tách riêng qua viewAll.
  const [viewAll, setViewAll] = useState(false);
  const scopeChosen = viewAll || categoryFilter !== null || deviceNames !== null;
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>(
    "odf-device-circuits-col-widths",
    DEFAULT_COL_WIDTHS
  );
  const { visible, toggle: toggleColumn } = useColumnVisibility<VisibleCol>("device-circuit-col-visibility", DEFAULT_VISIBLE);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    name: "",
    linkStatus: "",
    trib: "",
    device: "",
    positionOwn: "",
    positionNext: "",
    interface: "",
    counterpart: "",
    notes: "",
  });
  const [edit, setEdit] = useState<EditState | null>(null);
  // Toggle panel "Kiểm tra đồng bộ" (yêu cầu người dùng 2026-08-02) — reset
  // về ẩn mỗi khi ĐỔI DÒNG đang sửa (key theo edit.id) để không lỡ hiện panel
  // của dòng cũ khi mở sửa dòng khác.
  const [showSyncCheck, setShowSyncCheck] = useState(false);
  const editId = edit?.id ?? null;
  useEffect(() => setShowSyncCheck(false), [editId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cảnh báo MỀM (không chặn thao tác gì tiếp theo) khi maybeGrowLibrary()
  // phát hiện Trib đã có trong thư viện nhưng ODF ghi khác — xem chỗ khai báo
  // maybeGrowLibrary để biết lý do không tự ghi đè. Reset về null mỗi lần
  // bấm Lưu mới (saveEdit/submitCreate).
  const [libraryGrowWarning, setLibraryGrowWarning] = useState<LibraryGrowConflict | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  // Tô nền + đẩy lên đầu bảng cho MỌI luồng vừa thêm/sửa TRONG NGÀY HÔM NAY
  // (yêu cầu người dùng 2026-07-31, thay cho cơ chế cũ chỉ ghim đúng 1 dòng
  // vừa thêm trong 5 giây) — thuần dựa vào circuits[].updatedAt thật (đã có
  // sẵn, tự cập nhật qua trigger DB), KHÔNG cần state/timer riêng: qua nửa
  // đêm là tự "hết hạn" vì isUpdatedToday() so theo ngày thật lúc đó.
  const [onlyUpdatedToday, setOnlyUpdatedToday] = useState(false);
  const updatedTodayIds = useMemo(() => new Set(circuits.filter((c) => isUpdatedToday(c.updatedAt)).map((c) => c.id)), [circuits]);
  // Slide-over "xem nhanh port trung kế" (yêu cầu người dùng 2026-07-29,
  // "Giai đoạn 2") — renderCircuitFormFields() gọi từ CẢ form Sửa lẫn form
  // Thêm mới, nên đặt state dùng chung ở đây thay vì lặp lại 2 nơi. Lưu
  // thẳng TrunkPositionMatch (không chỉ 1 flag) vì mỗi lần bấm có thể là
  // match khác nhau (từ dòng đang sửa khác nhau).
  const [quickViewTrunkMatch, setQuickViewTrunkMatch] = useState<TrunkPositionMatch | null>(null);
  const quickViewTrunkPorts = useMemo(() => {
    if (!quickViewTrunkMatch || !quickViewTrunkMatch.resolvedPorts) return [];
    const portNumbers = new Set(quickViewTrunkMatch.resolvedPorts.map((p) => p.portNumber));
    return trunkPorts.filter((p) => p.rackCode === quickViewTrunkMatch.rackCode && portNumbers.has(p.portNumber));
  }, [quickViewTrunkMatch, trunkPorts]);
  // Tick chọn nhiều dòng để xóa cùng lúc (yêu cầu người dùng 2026-07-28) —
  // tập id độc lập với bộ lọc/sắp xếp đang hiển thị, cùng cách
  // DeviceCategoryClient.tsx đã làm cho bảng thiết bị (đổi bộ lọc không mất
  // tick đã chọn).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [conflictSearch, setConflictSearch] = useState("");
  const [conflictPageSize, setConflictPageSize] = useState(5);
  // Tick "dùng để tự đặt tên luồng" cạnh Thiết bị/Thiết bị (tiếp theo)/Đối
  // phương ở form "Thêm luồng mới" (yêu cầu người dùng 2026-07-27) — CHỈ áp
  // dụng lúc Thêm mới, không áp dụng khi Sửa (Thiết bị đã cố định, đổi tên
  // luồng theo ý người dùng thường không còn muốn tự sinh lại nữa).
  const [nameTicks, setNameTicks] = useState<{ own: boolean; next: boolean; counterpart: boolean }>({
    own: false,
    next: false,
    counterpart: false,
  });
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

  // Gợi ý "Thiết bị (tiếp theo)" (Ô2 của Vị trí ODF tiếp theo, 2026-07-27) —
  // toàn bộ thiết bị local ADN1 đã biết (không cần đã có luồng nào), để gõ
  // vài ký tự là ra ngay tên chuẩn đã có, đỡ gõ sai/lệch với tên đã lưu.
  const localDeviceNameOptions = useMemo(() => devices.map((d) => d.name).sort((a, b) => a.localeCompare(b)), [devices]);

  // Gợi ý "Giao tiếp" — tuyển tập các giá trị đã dùng qua, không cần bảng
  // thư viện riêng vì bản thân circuits.interface_type đã là kho dữ liệu đó.
  const interfaceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of circuits) if (c.interfaceType) set.add(c.interfaceType);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [circuits]);

  // Map id -> chữ hiện ở cột "Vị trí ODF (tiếp theo)" trong bảng danh sách,
  // xem positionNextDisplay() ở trên — tính 1 lần cho toàn bộ circuits (giống
  // các map tra nhanh khác trong file này) thay vì tính lại mỗi lần render
  // từng dòng (matchTrunkPosition quét qua trunkPorts, không rẻ nếu gọi lặp
  // lại cho mỗi dòng đang hiện mỗi khi gõ lọc/đổi sắp xếp).
  const positionNextDisplayById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of circuits) map.set(c.id, positionNextDisplay(c.devicePositionNext, trunkPorts));
    return map;
  }, [circuits, trunkPorts]);

  // Kết quả conflict trả về từ maybeGrowLibrary — hiện cảnh báo mềm sau khi
  // lưu (xem setLibraryGrowWarning ở saveEdit/submitCreate), KHÔNG chặn lưu.
  interface LibraryGrowConflict {
    deviceName: string;
    trib: string;
    existingOdf: string | null;
    newOdf: string;
  }

  // Nếu đã gõ 1 "Vị trí ODF (thiết bị)" MỚI (chưa có trong thư viện của đúng
  // thiết bị + Trib đó) thì lưu thêm vào device_position_map — đúng yêu cầu
  // "làm thư viện" dần theo thời gian, không cần màn hình riêng để nhập trước.
  //
  // SỬA LỖI khóa so khớp (người dùng xác nhận 2026-08-03, phát hiện qua ca
  // thật ADN1.ADX): khóa "đã có chưa" PHẢI là (Thiết bị, Trib), KHÔNG PHẢI
  // (Thiết bị, ODF) như bản cũ — nghiệp vụ thật là 1 thiết bị + 1 Trib chỉ có
  // ĐÚNG 1 cách ra (1 tọa độ ODF thật, hoặc "Kết nối trực tiếp"). Khóa theo
  // ODF sai vì "Kết nối trực tiếp" dùng CHUNG cho nhiều Trib khác nhau của
  // cùng 1 thiết bị — bản cũ tưởng các lần lưu đó là "cùng 1 cặp đã có" rồi
  // GHI ĐÈ Trib của dòng trước mỗi lần, cuối cùng thư viện chỉ còn sót 1 dòng
  // (mất 3/4 Trib thật của ADX).
  async function maybeGrowLibrary(
    deviceName: string | null,
    tribText: string,
    positionOwn: string
  ): Promise<LibraryGrowConflict | undefined> {
    const odf = positionOwn.trim();
    const trib = tribText.trim();
    // Cần đủ CẢ 3 để xác định đúng 1 dòng thư viện — thiếu Trib thì không
    // biết so khớp/tạo dòng nào (1 thiết bị có nhiều Trib, mỗi Trib đúng 1
    // cách ra).
    if (!deviceName || !odf || !trib) return;
    const nameKey = normalizeDeviceNameKey(deviceName);
    const tribKey = normalizeDevicePositionKey(trib);
    const existingEntry = devicePositionMap.find(
      (m) => normalizeDeviceNameKey(m.deviceName) === nameKey && normalizeDevicePositionKey(m.devicePosition ?? "") === tribKey
    );
    if (!existingEntry) {
      await supabase.from("device_position_map").insert({ device_name: deviceName, device_position: trib, odf_position: odf });
      return;
    }
    const existingOdfKey = normalizeDevicePositionKey(existingEntry.odfPosition ?? "");
    const newOdfKey = normalizeDevicePositionKey(odf);
    if (existingOdfKey === newOdfKey) return; // Đã khớp thư viện, không có gì để làm.
    // Trib đã có nhưng ODF ghi KHÁC — CONFLICT THẬT (thư viện và luồng vừa
    // lưu không khớp nhau, không rõ bên nào đúng) — KHÔNG tự ghi đè thư viện
    // (có thể lần này sai, hoặc lần trước sai), chỉ báo lại cho nơi gọi hiện
    // cảnh báo mềm; rà soát/xử lý đầy đủ ở /data-quality (khung riêng).
    return { deviceName, trib, existingOdf: existingEntry.odfPosition, newOdf: odf };
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
      const stationId = await getAdn1StationId(supabase);
      const { error: err } = await supabase.from("devices").insert({
        station_id: stationId,
        name: fullName,
        coordinate_text: parsed.coordinateText ?? null,
        full_label: `${fullName}(${parsed.coordinateText ?? ""})`,
        source: "auto",
      });
      if (err) throw err;
    } catch (e) {
      setError(`Luồng đã lưu, nhưng tạo thiết bị "${fullName}" thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
    }
  }

  // Ô "Thiết bị (tiếp theo)" (Ô2 của Vị trí ODF tiếp theo, thêm 2026-07-27) —
  // tên thiết bị LOCAL (ADN1), KHÔNG có tiền tố trạm như ô Đối phương, nên
  // không cần parseTransitText ở đây — chỉ kiểm tra thẳng tên đã có trong
  // devices chưa. Chỉ được gọi khi KHÔNG ở chế độ Cáp quang (xem
  // saveEdit/submitCreate gọi qua validatePositionNext().isCableMode) — tức
  // là gọi cả khi Ô1 không khớp gì LẪN khi khớp ODF/DDF nội bộ (domain=
  // 'device'), chỉ trừ khi khớp đúng rack trung kế thật.
  type NextDeviceResolution =
    | { status: "resolved"; deviceId: string; deviceName: string }
    | { status: "declined" }
    | { status: "error"; message: string };

  // Thay maybeCreateNextDevice cũ — GIỜ CHẠY TRƯỚC khi lưu circuit (yêu cầu
  // người dùng 2026-08-03), không còn là bước phụ chạy sau lưu. Phải trả về
  // tên CHUẨN thật từ `devices` (không ghi thẳng chuỗi gõ tay) để
  // maybeGrowLibrary dùng đúng khóa — bản cũ ghi thư viện bằng tên gõ tay
  // TRƯỚC khi thiết bị mới được tạo (tên chuẩn có tiền tố "ADN1." tạo SAU),
  // 2 nơi không bao giờ đồng bộ lại — đây là nguyên nhân chính của 94/120
  // dòng thư viện lệch tên hiển thị so với /devices đã đo được thực tế.
  //
  // Nếu người dùng bấm Hủy ở hộp xác nhận tạo mới -> trả "declined" để nơi
  // gọi HỦY TOÀN BỘ việc lưu circuit (khác hành vi maybeCreateCounterpartDevice
  // — hàm đó KHÔNG đổi, vẫn không chặn lưu, ngoài phạm vi yêu cầu lần này).
  async function resolveOrCreateNextDevice(typedName: string): Promise<NextDeviceResolution> {
    const trimmed = typedName.trim();
    if (!trimmed) return { status: "declined" };

    // Cấp 1+2: khớp chính xác/alias đã xác nhận trước — tái dùng đúng hàm
    // dùng chung với PortTable.tsx, không viết map so khớp riêng ở đây.
    const existing = resolveDeviceByExactOrAlias(trimmed, devices, deviceAliases);
    if (existing) return { status: "resolved", deviceId: existing.id, deviceName: existing.name };

    // Cấp 3: gợi ý so khớp LỎNG trước khi hỏi tạo mới, tránh tạo trùng thiết
    // bị chỉ vì gõ tắt/khác số 0 đầu (cùng cơ chế PortTable.tsx).
    const looseCandidate = findLooseDeviceCandidate(trimmed, devices);
    if (looseCandidate) {
      const useExisting = confirm(
        `"${trimmed}" (Thiết bị tiếp theo) chưa khớp chính xác thiết bị nào, nhưng có thể là thiết bị đã có "${looseCandidate.name}".\n\n` +
          `OK = dùng thiết bị đã có (ghi nhớ cách gõ này cho lần sau)\nCancel = tạo thiết bị MỚI tên "ADN1.${trimmed}"`
      );
      if (useExisting) {
        try {
          await saveDeviceAlias(supabase, looseCandidate.id, trimmed);
        } catch {
          // Lỗi lưu alias không quan trọng bằng việc lưu được luồng — vẫn
          // tiếp tục dùng thiết bị đã tìm thấy.
        }
        return { status: "resolved", deviceId: looseCandidate.id, deviceName: looseCandidate.name };
      }
    }

    const fullName = /^adn1\./i.test(trimmed) ? trimmed : `ADN1.${trimmed}`;
    if (!confirm(`Chưa có thiết bị "${fullName}" trong hệ thống (nhận diện từ ô Thiết bị (tiếp theo)).\n\nTạo mới thiết bị này?`)) {
      return { status: "declined" };
    }
    try {
      const stationId = await getAdn1StationId(supabase);
      const { data, error: err } = await supabase
        .from("devices")
        .insert({ station_id: stationId, name: fullName, coordinate_text: null, full_label: fullName, source: "auto" })
        .select("id")
        .single();
      if (err) throw err;
      return { status: "resolved", deviceId: data.id as string, deviceName: fullName };
    } catch (e) {
      return { status: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

  // Gọi ngay sau khi 1 luồng thiết bị được lưu (thêm mới hoặc sửa) — tự tạo
  // "mirror" phía đối diện nếu còn thiếu, CẢ 2 LOẠI: (1) đối diện là 1 thiết
  // bị local khác (lib/deviceDeviceSync.ts, mục 38 — ca ASBR#2 (7/1/8)/(7/1/9)
  // không tự đồng bộ bên PSS24X#3 BB1), (2) đối diện là 1 port ODF TRUNG KẾ
  // thật (lib/mirrorTrunkCircuits.ts, mục 39 — ca ASBR#2 (7/1/2) không tự có
  // luồng bên ODF1/10). Cả 2 cơ chế trước 2026-07-31 CHỈ chạy qua script dọn
  // dữ liệu cũ 1 lần, chưa từng gắn vào form Thêm/Sửa trên UI — gọi cả 2 ở
  // đây vì 1 luồng chỉ có thể khớp ĐÚNG 1 trong 2 loại (không match thì trả
  // "no-gap", vô hại). Không chặn lưu luồng dù bước này lỗi — chỉ báo cho
  // người dùng biết để tự xử lý tay, cùng tinh thần với
  // maybeCreateCounterpartDevice/maybeCreateNextDevice ở trên.
  async function autoMirrorAfterSave(circuitId: string, sourceName: string) {
    // Bước 3/6 (yêu cầu người dùng 2026-08-02, trả lời câu hỏi phân loại theo
    // LOẠI cặp bằng: "cũng là odf, cũng có port, cũng có tên... như nhau mà
    // có gì đâu mà phải phân loại lắm thế" — MỘT cách xử lý duy nhất, không
    // phân biệt trung kế/thiết bị): bên VỪA LƯU luôn là chuẩn. Đầu xa trống
    // thì tự tạo (giữ nguyên, "created"/"no-gap"). Đầu xa đã có dữ liệu:
    // TÊN KHỚP HỆT (chắc chắn cùng 1 luồng, chỉ chưa gắn liên kết) -> tự liên
    // kết NGAY, không hỏi. TÊN KHÁC (dù gần hay lệch hẳn port) -> xác nhận
    // từng bước: xóa dữ liệu đầu xa CŨ rồi tạo lại đúng theo bên vừa lưu
    // (KHÔNG âm thầm bỏ qua/chỉ báo lỗi mềm như trước — đó là lỗ hổng khiến
    // 2 bên tiếp tục lệch nhau vô thời hạn).
    try {
      const result = await autoCreateMirrorForCircuit(supabase, circuitId);
      if (result.status === "mismatch") {
        const ok = confirm(
          `Thiết bị "${result.targetDeviceName}" đã có 1 luồng cùng tên "${sourceName}" nhưng Trib ghi "${
            result.existingTrib ?? "(trống)"
          }" khác với Trib mong đợi "${result.expectedTrib}" (từ luồng vừa lưu).\n\nXÓA luồng cũ đó và TẠO LẠI đúng theo luồng vừa lưu?`
        );
        if (ok) {
          try {
            const retry = await replaceMismatchedDeviceMirror(supabase, result.existingCircuitId, circuitId);
            if (retry.status === "error") setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${translatePgError(retry.message)}`);
          } catch (e) {
            setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
          }
        }
      } else if (result.status === "error") {
        setError(`Luồng đã lưu, nhưng tự tạo mirror bên thiết bị đích thất bại: ${translatePgError(result.message)}`);
      }
    } catch (e) {
      setError(`Luồng đã lưu, nhưng tự tạo mirror bên thiết bị đích thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
    }
    try {
      const trunkResult = await autoCreateTrunkMirrorForCircuit(supabase, circuitId);
      if (trunkResult.status === "occupied") {
        if (trunkResult.occupantCircuitName.trim() === sourceName.trim()) {
          // Tên khớp hệt -> chắc chắn cùng 1 luồng, chỉ chưa gắn liên kết —
          // tự liên kết ngay, không hỏi (Case B).
          const { error: linkErr } = await supabase
            .from("circuits")
            .update({ mirror_of_id: circuitId })
            .eq("id", trunkResult.occupantCircuitId);
          if (linkErr) setError(`Luồng đã lưu, nhưng tự liên kết với luồng trung kế trùng tên thất bại: ${translatePgError(linkErr.message)}`);
        } else {
          const ok = confirm(
            `Port ${trunkResult.rackCode} (${trunkResult.portNumbers.join(",")}) đang có luồng trung kế khác: "${
              trunkResult.occupantCircuitName
            }" — không trùng tên với luồng vừa lưu ("${sourceName}").\n\nXÓA luồng trung kế đó và TẠO LẠI đúng theo luồng vừa lưu?`
          );
          if (ok) {
            try {
              const retry = await replaceOccupantAndCreateTrunkMirror(supabase, trunkResult.occupantCircuitId, circuitId);
              if (retry.status === "error") setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${translatePgError(retry.message)}`);
            } catch (e) {
              setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
            }
          }
        }
      } else if (trunkResult.status === "error") {
        setError(`Luồng đã lưu, nhưng tự tạo mirror bên ODF trung kế thất bại: ${translatePgError(trunkResult.message)}`);
      }
    } catch (e) {
      setError(`Luồng đã lưu, nhưng tự tạo mirror bên ODF trung kế thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
    }
  }

  // Tính TRẠNG THÁI của "Vị trí ODF (tiếp theo)" (yêu cầu người dùng
  // 2026-07-27) — gọi lại mỗi lần render (từ giá trị HIỆN TẠI của Ô1/Ô3), có
  // 3 phần:
  //   - trunkMatch: kết quả khớp rack/port trung kế thật của Ô1 (dùng để
  //     quyết định chế độ Thiết bị/Cáp quang, và để renderCircuitFormFields
  //     tự điền Ô2/Ô3).
  //   - error: LỖI CHẶN LƯU — port/sợi gõ không tồn tại thật trong tuyến cáp
  //     đã khớp ("báo là ko đúng để bắt nhập liệu cho đúng").
  //   - warning: CẢNH BÁO không chặn — port đã khớp NHƯNG đang có luồng khác
  //     dùng rồi (vẫn cho lưu, tự rà lại luồng cũ sau).
  function validatePositionNext(
    odfText: string,
    tribText: string
  ): { trunkMatch: TrunkPositionMatch; isCableMode: boolean; error: string | null; warning: string | null } {
    const trunkMatch = matchTrunkPosition(odfText, trunkPorts);
    // "Chế độ Cáp quang" CHỈ khi khớp rack TRUNG KẾ thật (đấu thẳng ra tuyến
    // cáp) — khớp rack ODF/DDF nội bộ (domain='device', thêm 2026-07-27, xem
    // scripts/import-internal-odf-racks.ts) vẫn ở "chế độ Thiết bị" như cũ vì
    // đó là đấu chéo thiết bị-thiết bị tại chỗ, không phải tuyến cáp ra trạm
    // khác — chỉ khác 1 điểm: Ô1 vẫn được chuẩn hóa + validate port vì giờ đã
    // có dữ liệu port thật để đối chiếu.
    const isCableMode = trunkMatch.matched && trunkMatch.rackDomain === "trunk";
    if (!trunkMatch.matched) return { trunkMatch, isCableMode, error: null, warning: null };

    if (trunkMatch.invalidPortNumbers && trunkMatch.invalidPortNumbers.length > 0) {
      const placeLabel = isCableMode ? "tuyến cáp" : "ODF/DDF";
      return {
        trunkMatch,
        isCableMode,
        error: `Port ${trunkMatch.invalidPortNumbers.join(",")} không tồn tại trong ${placeLabel} "${trunkMatch.rackCode}".`,
        warning: null,
      };
    }

    // Ô3 (Sợi) hiện tại có thật sự khớp đúng với port đã suy ra ở Ô1 không —
    // bắt các trường hợp người dùng gõ tay Sợi không có thật (onChange của Ô3
    // chỉ ghi lại Ô1 khi tìm thấy khớp, nên gõ sai sẽ để lại Ô3 "mồ côi").
    // CHỈ áp dụng ở chế độ Cáp quang — ODF/DDF nội bộ thì Ô3 là "Trib" tự do
    // (vd "S1-1"), không phải số Sợi, không có gì để đối chiếu port<->sợi.
    const tribTrimmed = tribText.trim();
    if (isCableMode && tribTrimmed && trunkMatch.rackCode) {
      const fiberNumbers = parseNumberList(tribTrimmed);
      const foundByFiber = fiberNumbers ? findPortsByFiberNumbers(trunkMatch.rackCode, fiberNumbers, trunkPorts) : null;
      if (!foundByFiber) {
        return {
          trunkMatch,
          isCableMode,
          error: `Sợi "${tribTrimmed}" không tồn tại trong tuyến cáp "${trunkMatch.rackCode}".`,
          warning: null,
        };
      }
    }

    const inUsePorts = (trunkMatch.resolvedPorts ?? []).filter((p) => p.inUse);
    const warning =
      inUsePorts.length > 0
        ? `Port ${inUsePorts.map((p) => p.portNumber).join(",")} đang có luồng khác (${inUsePorts
            .map((p) => p.circuitName ?? "?")
            .join(", ")}) — vẫn thêm được, nên rà lại luồng cũ cho khớp sau nếu cần.`
        : null;
    return { trunkMatch, isCableMode, error: null, warning };
  }

  // Bắt buộc nhập đủ MỌI ô số liệu khi Thêm mới/Sửa luồng thiết bị, TRỪ Đối
  // phương và Ghi chú (yêu cầu người dùng 2026-07-27 — 2 ô này vẫn luôn được
  // để trống như thiết kế gốc, xem architecture.md mục 3.4). Nhãn Thiết
  // bị/Trib "(tiếp theo)" đổi theo đúng chế độ đang hiển thị (isCableMode) để
  // thông báo khớp với những gì người dùng đang thấy trên form.
  function findMissingRequiredFields(values: SharedCircuitFields, isCableMode: boolean): string[] {
    const missing: string[] = [];
    if (!values.name.trim()) missing.push("Tên luồng");
    if (!values.tribText.trim()) missing.push("Trib");
    if (!values.positionOwn.trim()) missing.push("Vị trí ODF (thiết bị)");
    if (!values.positionNextOdf.trim()) missing.push("Vị trí ODF (tiếp theo)");
    if (!values.positionNextDevice.trim()) missing.push(isCableMode ? "Cáp quang (tiếp theo)" : "Thiết bị (tiếp theo)");
    if (!values.positionNextTrib.trim()) missing.push(isCableMode ? "Sợi quang (tiếp theo)" : "Trib (tiếp theo)");
    if (!values.interfaceType.trim()) missing.push("Giao tiếp");
    return missing;
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
    // Bấm "Tất cả" là 1 lựa chọn CHỦ ĐỘNG (khác lúc mới mở tab chưa chọn gì)
    // — coi như viewAll luôn, để bảng hiện ngay thay vì quay lại màn hình
    // trống rồi phải bấm thêm "Xem tất cả" lần nữa.
    setCategoryFilter(null);
    setViewAll(true);
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

    list = list.filter((c) => FILTER_KEYS.every((k) => matchesFilter(cellText(c, k, mirrorLinkStatuses), filters[k])));

    // Chỉ hiện luồng vừa thêm/sửa hôm nay (yêu cầu người dùng 2026-07-31,
    // checkbox trong thanh công cụ) — lọc SAU các bộ lọc cột khác, cùng logic
    // "AND" như mọi bộ lọc còn lại.
    if (onlyUpdatedToday) {
      list = list.filter((c) => updatedTodayIds.has(c.id));
    }

    const arr = [...list].sort((a, b) => compareByKey(sortKey, a, b, mirrorLinkStatuses));
    const sortedArr = sortDir === "desc" ? arr.reverse() : arr;

    // Mọi luồng vừa thêm/sửa HÔM NAY luôn nổi lên ĐẦU bảng, bất kể đang sắp
    // xếp/lọc theo cột nào (yêu cầu người dùng 2026-07-28, mở rộng 2026-07-31
    // từ "chỉ 1 dòng vừa thêm trong 5s" thành "mọi dòng đổi trong ngày, giữ
    // tới hết ngày") — trong nhóm này, dòng sửa gần nhất lên trước. Phần còn
    // lại (không đổi hôm nay) giữ nguyên thứ tự theo sortKey/sortDir đã chọn.
    const todayArr = sortedArr.filter((c) => updatedTodayIds.has(c.id)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const restArr = sortedArr.filter((c) => !updatedTodayIds.has(c.id));
    return [...todayArr, ...restArr];
  }, [circuits, categoryFilter, categoryByDeviceName, deviceNames, filters, sortKey, sortDir, onlyUpdatedToday, updatedTodayIds, mirrorLinkStatuses]);

  // Chỉ ẩn cột "Thiết bị" khi đã lọc còn ĐÚNG 1 thiết bị cụ thể (dòng nào
  // cũng giống nhau) — còn lại (tất cả, hoặc chọn nhiều thiết bị cùng lúc)
  // vẫn cần cột này để phân biệt các dòng.
  const showDeviceColumn = deviceNames === null || deviceNames.length !== 1;
  const columnCount = (showDeviceColumn ? 10 : 9) + 1 - COLUMN_ITEMS.filter((c) => !visible[c.key]).length; // +1 cho cột tick chọn

  // Xuất Excel theo ĐÚNG cột đang hiển thị (quy định chung mọi bảng).
  const exportColumns = useMemo(() => {
    const cols: { label: string; getValue: (c: DeviceCircuitRow) => string | number | null }[] = [
      { label: "Tên luồng", getValue: (c) => c.name },
    ];
    if (visible.linkStatus) cols.push({ label: "Trạng thái", getValue: (c) => mirrorLinkStatusLabel(mirrorLinkStatuses?.[c.id]) });
    if (visible.trib) cols.push({ label: "Trib", getValue: (c) => c.tribText });
    if (showDeviceColumn) cols.push({ label: "Thiết bị", getValue: (c) => c.deviceName });
    if (visible.positionOwn) cols.push({ label: "Vị trí ODF (thiết bị)", getValue: (c) => c.devicePositionOwn });
    if (visible.positionNext) cols.push({ label: "Vị trí ODF (tiếp theo)", getValue: (c) => c.devicePositionNext });
    if (visible.interface) cols.push({ label: "Giao tiếp", getValue: (c) => c.interfaceType });
    if (visible.counterpart) cols.push({ label: "Đối phương", getValue: (c) => c.counterpartText });
    if (visible.notes) cols.push({ label: "Ghi chú", getValue: (c) => c.notes });
    return cols;
  }, [visible, showDeviceColumn, mirrorLinkStatuses]);

  // Đoạn text báo cáo sinh sẵn cho các luồng ĐANG TICK — tái dùng nguyên
  // `selected` (vốn dùng cho xóa hàng loạt, yêu cầu người dùng 2026-08-07:
  // "chưa có nút tick... ở hồ sơ này" ý nói bên PortTable.tsx, còn ở đây đã
  // có sẵn tick nên dùng thẳng luôn, không cần state chọn mới).
  const reportItems = useMemo(() => {
    return [...selected].flatMap((id) => {
      const c = circuits.find((row) => row.id === id);
      if (!c) return [];
      const text = buildDeviceCircuitReportText({
        name: c.name,
        deviceName: c.deviceName,
        tribText: c.tribText,
        devicePositionOwn: c.devicePositionOwn,
        devicePositionNext: c.devicePositionNext,
        trunkPorts,
      });
      return [{ key: id, text }];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, circuits, trunkPorts]);

  // Kiểm tra "1 vị trí ODF/DDF (thiết bị) không được gán cho 2 thiết bị khác
  // nhau" — CHỈ so sánh cột "Vị trí ODF (thiết bị)" (nơi CHÍNH thiết bị này
  // đấu cáp ra) với nhau, KHÔNG so với "Vị trí ODF (tiếp theo)" của thiết bị
  // khác. Lý do (người dùng chỉnh lại 2026-07-25): vị trí "tiếp theo" của
  // thiết bị A trùng vị trí "thiết bị" của thiết bị B là chuyện BÌNH THƯỜNG
  // — đó chính là chỗ nhảy dây đấu nối A với B, không phải lỗi trùng port.
  // Logic tách sang lib/deviceCircuits.ts (yêu cầu người dùng 2026-07-29, dùng
  // lại ở trang "Chất lượng dữ liệu" mới) — hành vi giữ nguyên 100%.
  const positionConflicts = useMemo(() => findDevicePositionConflicts(circuits), [circuits]);

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
    // Chế độ Ô2 (Thiết bị/Cáp quang) KHÔNG cần suy luận/lưu riêng nữa — luôn
    // tính lại từ positionNextOdf qua matchTrunkPosition() mỗi lần render
    // (xem renderCircuitFormFields), đảm bảo nhất quán tuyệt đối với Ô1.
    const nextSplit = splitPositionNextForEdit(c.devicePositionNext ?? "", trunkPorts);
    setEdit({
      id: c.id,
      deviceName: c.deviceName,
      name: c.name,
      tribText: c.tribText ?? "",
      positionOwn: c.devicePositionOwn ?? "",
      positionNextOdf: nextSplit.odf,
      positionNextDevice: nextSplit.device,
      positionNextTrib: nextSplit.trib,
      interfaceType: c.interfaceType ?? "",
      counterpartText: c.counterpartText ?? "",
      notes: c.notes ?? "",
    });
    setNameTicks({ own: false, next: false, counterpart: false });
    setError(null);
    requestAnimationFrame(() => {
      document.getElementById(EDIT_BOX_ID)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function cancelEdit() {
    setEdit(null);
    setError(null);
  }

  // Xóa nhanh 1 luồng thiết bị — luồng thiết bị không gắn port_circuit_links
  // (khác luồng trung kế, xem lib/deviceCircuits.ts) nên chỉ cần xóa đúng 1
  // dòng circuits, không đụng gì khác CỦA CHÍNH NÓ. Luôn hỏi trước vì không
  // thể hoàn tác.
  //
  // Bug thật gặp 2026-07-31: nếu luồng này từng được
  // `scripts/sync-missing-trunk-circuits.ts` tự tạo 1 luồng "mirror" bên Hồ
  // sơ ODF Trung kế (rack/port thật), xóa CHỈ luồng thiết bị để lại luồng
  // mirror mồ côi — port trung kế báo "đang dùng" mãi dù luồng gốc không còn.
  // Từ migration `circuits_mirror_of` (2026-07-31), `circuits.mirror_of_id
  // on delete cascade` đã tự đảm bảo xóa luồng gốc là mirror tự xóa theo Ở
  // TẦNG CSDL (không phụ thuộc code này) — chỉ còn cần: (1) tra trước để báo
  // rõ trong confirm(), (2) dọn `ports.status`/`transit_links` sau khi xóa
  // (2 việc KHÔNG tự cascade, xem lib/mirrorTrunkCircuits.ts).
  async function deleteCircuit(c: DeviceCircuitRow) {
    setError(null);
    let mirror: MirrorTrunkMatch | null = null;
    try {
      mirror = (await findMirrorTrunkCircuits(supabase, [c.id])).get(c.id) ?? null;
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
      return;
    }
    const mirrorNote = mirror
      ? `\n\nLƯU Ý: luồng này đã có 1 luồng "mirror" tự sinh bên Hồ sơ ODF Trung kế ("${mirror.circuitName}") — sẽ bị xóa theo, port trung kế tương ứng trở về trạng thái trống.`
      : "";
    if (
      !confirm(
        `Xóa luồng "${displayName(c) || "(chưa đặt tên)"}" (thiết bị: ${c.deviceName ?? "chưa xác định"})? Không thể hoàn tác.${mirrorNote}`
      )
    ) {
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.from("circuits").delete().eq("id", c.id);
    if (err) {
      setBusy(false);
      setError(translatePgError(err.message));
      return;
    }
    if (mirror) {
      try {
        await cleanupAfterMirrorCascade(supabase, [mirror]);
      } catch (e) {
        setError(
          `Đã xóa luồng thiết bị (mirror trung kế đã tự xóa theo), nhưng dọn port/transit_links thất bại: ${
            e instanceof Error ? translatePgError(e.message) : String(e)
          }`
        );
      }
    }
    setBusy(false);
    if (edit?.id === c.id) setEdit(null);
    router.refresh();
  }

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
      for (const c of filtered) next.add(c.id);
      return next;
    });
  }

  function clearVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) next.delete(c.id);
      return next;
    });
  }

  function clearAllSelected() {
    setSelected(new Set());
  }

  // Xóa nhiều luồng thiết bị cùng lúc (yêu cầu người dùng 2026-07-28: "tick
  // chọn rồi bấm xóa") — cùng lý do an toàn như deleteCircuit() ở trên (luồng
  // thiết bị không gắn port_circuit_links nào), chỉ khác là xóa theo lô id đã
  // tick thay vì đúng 1 dòng. Cùng cơ chế dọn "mirror" trung kế mồ côi như
  // deleteCircuit() (xem comment ở đó + lib/mirrorTrunkCircuits.ts).
  async function deleteSelectedCircuits() {
    if (selected.size === 0) return;
    setError(null);
    const ids = [...selected];
    let mirrors: MirrorTrunkMatch[] = [];
    try {
      mirrors = [...(await findMirrorTrunkCircuits(supabase, ids)).values()];
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
      return;
    }
    const mirrorNote =
      mirrors.length > 0
        ? `\n\nLƯU Ý: ${mirrors.length} luồng trong số này đã có luồng "mirror" tự sinh bên Hồ sơ ODF Trung kế — sẽ bị xóa theo, (các) port trung kế tương ứng trở về trạng thái trống.`
        : "";
    // confirmBulkDelete (Đợt 3.4 audit, 2026-08-07) thay confirm() OK/Cancel
    // thường — bắt gõ "XÓA" + giới hạn 20 dòng/lần, xóa hàng loạt khó hoàn
    // tác hơn xóa 1 dòng nên cần rào chắn mạnh hơn.
    if (!confirmBulkDelete(`Xóa vĩnh viễn ${selected.size} luồng đã chọn? Không thể hoàn tác.${mirrorNote}`, selected.size))
      return;
    setBusy(true);
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = ids.slice(i, i + chunkSize);
      const { error: err } = await supabase.from("circuits").delete().in("id", batch);
      if (err) {
        setBusy(false);
        setError(translatePgError(err.message));
        return;
      }
    }
    if (mirrors.length > 0) {
      try {
        await cleanupAfterMirrorCascade(supabase, mirrors);
      } catch (e) {
        setError(
          `Đã xóa các luồng thiết bị (mirror trung kế đã tự xóa theo), nhưng dọn port/transit_links thất bại: ${
            e instanceof Error ? translatePgError(e.message) : String(e)
          }`
        );
      }
    }
    setBusy(false);
    if (edit && selected.has(edit.id)) setEdit(null);
    setSelected(new Set());
    router.refresh();
  }

  async function saveEdit() {
    if (!edit) return;
    // Port/Sợi (tiếp theo) gõ không có thật trong tuyến cáp đã khớp -> CHẶN
    // lưu (yêu cầu người dùng 2026-07-27: "báo là ko đúng để bắt nhập liệu
    // cho đúng").
    const { isCableMode, error: positionNextError } = validatePositionNext(edit.positionNextOdf, edit.positionNextTrib);
    if (positionNextError) {
      setError(positionNextError);
      return;
    }
    // Bắt buộc đủ mọi ô số liệu, trừ Đối phương/Ghi chú (yêu cầu người dùng
    // 2026-07-27).
    const missingFields = findMissingRequiredFields(edit, isCableMode);
    if (missingFields.length > 0) {
      setError(`Vui lòng nhập đủ: ${missingFields.join(", ")}.`);
      return;
    }
    // Chặn lưu TOÀN BỘ khi luồng ĐÃ liên kết và Vị trí ODF (thiết bị)/Vị trí
    // ODF (tiếp theo)/Trib vừa đổi sang SỐ LIỆU THẬT khác (yêu cầu người
    // dùng 2026-08-02, bước 2/6 — đối xứng chốt chặn ở PortTable.tsx
    // saveEdit(), cùng lỗ hổng gây ra ca AĐN1.P2(2/1/2) đầu phiên: trước đây,
    // mục 49, vẫn cho lưu rồi hỏi confirm() có đẩy sang trung kế không, im
    // lặng tin bên vừa sửa là đúng). Kiểm tra CẢ "Vị trí ODF (tiếp theo)" —
    // trước đây (mục 49) KHÔNG kiểm tra trường này, đúng lỗ hổng gốc của ca
    // P2 (đổi luôn "đầu xa ở đâu" mà vẫn còn liên kết mirror_of_id cũ).
    if (edit.id) {
      const linkedPair = circuitPairDetails?.find((d) => d.deviceCircuitId === edit.id && d.isLinked);
      if (linkedPair) {
        const newOwnPosition = edit.positionOwn.trim() || null;
        const newTrib = edit.tribText.trim() || null;
        const newNextPosition = combinePositionNext(edit.positionNextOdf, edit.positionNextDevice, edit.positionNextTrib) || null;
        const ownChanged = hasPositionChanged(linkedPair.trunkTransitOdfPart, newOwnPosition);
        const tribChanged = hasTribChanged(linkedPair.trunkTransitTrib, newTrib);
        const nextChanged = hasPositionChanged(linkedPair.trunkOwnPositionCanonical, newNextPosition);
        if (ownChanged || tribChanged || nextChanged) {
          setError(
            `Luồng này đang liên kết với luồng trung kế "${linkedPair.trunkName}" (${linkedPair.rackCode} port ${linkedPair.portNumbers.join(
              ","
            )}). Không lưu được vì Vị trí ODF/Trib vừa đổi sang số liệu khác — dùng "Kiểm tra đồng bộ với hồ sơ ODF trung kế" để chọn đúng bên, hoặc "Gỡ liên kết" trước nếu đây thực sự là 1 đấu nối khác.`
          );
          return;
        }
      }
    }
    setBusy(true);
    setError(null);
    setLibraryGrowWarning(null);

    // ĐẢO THỨ TỰ (Lỗi 2, người dùng xác nhận 2026-08-03): xác nhận/tạo thiết
    // bị cho Ô2 "Thiết bị (tiếp theo)" PHẢI XONG TRƯỚC khi lưu circuit, không
    // phải SAU như bản cũ — nếu người dùng bấm Hủy ở hộp xác nhận tạo mới,
    // HỦY TOÀN BỘ việc lưu (không chỉ riêng thư viện), bắt sửa lại tên hoặc
    // xác nhận tạo thiết bị mới trước khi lưu được luồng này.
    let resolvedNextDevice: { deviceId: string; deviceName: string } | null = null;
    if (!isCableMode) {
      const resolution = await resolveOrCreateNextDevice(edit.positionNextDevice);
      if (resolution.status === "declined") {
        setBusy(false);
        setError(
          'Chưa lưu luồng: cần xác nhận thiết bị cho "Thiết bị (tiếp theo)" trước khi lưu — sửa lại tên cho khớp thiết bị đã có, hoặc xác nhận tạo thiết bị mới ở hộp thoại.'
        );
        return;
      }
      if (resolution.status === "error") {
        setBusy(false);
        setError(`Chưa lưu luồng: tạo thiết bị "${edit.positionNextDevice}" thất bại — ${translatePgError(resolution.message)}`);
        return;
      }
      resolvedNextDevice = resolution;
    }

    const { error: err } = await supabase
      .from("circuits")
      .update({
        name: edit.name.trim() || "(chưa đặt tên)",
        trib_text: edit.tribText.trim() || null,
        device_position_own: edit.positionOwn.trim() || null,
        device_position_next:
          combinePositionNext(edit.positionNextOdf, resolvedNextDevice?.deviceName ?? edit.positionNextDevice, edit.positionNextTrib) ||
          null,
        interface_type: edit.interfaceType.trim() || null,
        counterpart_text: edit.counterpartText.trim() || null,
        notes: edit.notes.trim() || null,
      })
      .eq("id", edit.id);
    if (err) {
      setBusy(false);
      setError(translatePgError(err.message));
      return;
    }
    const conflictOwn = await maybeGrowLibrary(edit.deviceName, edit.tribText, edit.positionOwn);
    if (conflictOwn) setLibraryGrowWarning(conflictOwn);
    await maybeCreateCounterpartDevice(edit.counterpartText);
    // Chế độ Cáp quang (isCableMode) thì Ô2 ghi tên tuyến cáp, không phải
    // thiết bị — không có gì để ghi thư viện device_position_map, nên dòng
    // dưới chỉ chạy khi KHÔNG phải cáp quang (thiết bị đã resolve xong ở
    // trên, dùng TÊN CHUẨN thay vì chuỗi gõ tay — sửa tận gốc Lỗi 2).
    if (!isCableMode && resolvedNextDevice) {
      const conflictNext = await maybeGrowLibrary(resolvedNextDevice.deviceName, edit.positionNextTrib, edit.positionNextOdf);
      if (conflictNext) setLibraryGrowWarning(conflictNext);
    }
    // SỬA LỖI (người dùng 2026-08-03, phát hiện qua ca thật ADN1.ASBR#2-
    // MX2020 (2/1/8) đi ODF 1/2 (47,48) không tự tạo mirror trung kế): trước
    // đây `autoMirrorAfterSave` (gồm CẢ phần tự tạo mirror bên ODF trung kế
    // `autoCreateTrunkMirrorForCircuit`) bị nhốt chung trong `if (!isCableMode)`
    // phía trên — đúng ra chỉ 2 dòng `maybeGrowLibrary`/`maybeCreateNextDevice`
    // (thật sự chỉ có nghĩa khi Ô2 là THIẾT BỊ) mới cần điều kiện đó. Chế độ
    // Cáp quang chính là trường hợp CẦN autoMirrorAfterSave NHẤT (đầu kia luôn
    // là 1 port ODF trung kế cụ thể) — bị nhốt chung khiến MỌI luồng nhập ở
    // Chế độ Cáp quang từ trước tới giờ không bao giờ tự tạo mirror trung kế,
    // âm thầm không ai biết. Xem lib/mirrorTrunkCircuits.ts —
    // `autoCreateMirrorForCircuit` (nhánh device-device trong cùng hàm) vẫn AN
    // TOÀN khi gọi ở Chế độ Cáp quang: tên "thiết bị" parse ra thực chất là
    // tên tuyến cáp, không khớp bảng `devices` nào nên tự trả "no-gap", không
    // gây hại gì.
    await autoMirrorAfterSave(edit.id, edit.name.trim() || "(chưa đặt tên)");

    // Tự đồng bộ TÊN sang luồng trung kế ĐÃ liên kết — KHÔNG hỏi confirm()
    // nữa (yêu cầu người dùng 2026-08-02, bước 2/6 — đối xứng PortTable.tsx
    // saveEdit()). Vị trí ODF/Trib đổi SỐ THẬT đã bị CHẶN LƯU ở đầu hàm, nên
    // tới đây chỉ còn khả năng đổi TÊN (hoặc đổi cách ghi mà số liệu vẫn
    // khớp) là an toàn để tự đẩy sang, không cần hỏi lại.
    const pairDetail = circuitPairDetails?.find((d) => d.deviceCircuitId === edit.id && d.isLinked);
    if (pairDetail) {
      const newDeviceName = edit.name.trim() || "(chưa đặt tên)";
      if (newDeviceName !== pairDetail.trunkName.trim()) {
        try {
          await applySyncFromDevice(supabase, {
            ...pairDetail,
            deviceName: newDeviceName,
            deviceOwnPosition: edit.positionOwn.trim() || null,
            deviceTrib: edit.tribText.trim() || null,
          });
        } catch (e) {
          setError(`Đã lưu luồng, nhưng đồng bộ tên sang trung kế thất bại: ${e instanceof Error ? translatePgError(e.message) : String(e)}`);
        }
      }
    }

    setBusy(false);
    setEdit(null);
    router.refresh();
  }

  // "Gỡ liên kết" (yêu cầu người dùng 2026-08-02, bước 1/6 của đề xuất nhất
  // quán liên kết — xem lib/mirrorLinkStatus.ts) — chỉ set mirror_of_id =
  // null, KHÔNG xóa/đổi dữ liệu nào. counterpartName chỉ để hiện rõ trong
  // confirm(), không truyền được thì vẫn gỡ được, chỉ hỏi chung chung hơn.
  async function unlinkMirror(circuitId: string, counterpartName: string | null) {
    const ok = confirm(
      `Gỡ liên kết với${counterpartName ? ` "${counterpartName}"` : " luồng đối phương"}? Dữ liệu 2 bên vẫn giữ nguyên, chỉ không còn được coi là cùng 1 luồng để đối chiếu/tự đồng bộ nữa.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await unlinkCircuitMirror(supabase, circuitId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? translatePgError(e.message) : String(e));
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setNameTicks({ own: false, next: false, counterpart: false });
    setCreating(true);
    setError(null);
  }

  function cancelCreate() {
    setCreating(false);
    setError(null);
  }

  // Ghép "tên (port/trib)" cho 1 trong 3 mục có thể tick — Đối phương giữ
  // nguyên KHÔNG thêm "(...)" vì bản thân ô đó thường đã có sẵn tọa độ trong
  // text tự do rồi (yêu cầu người dùng 2026-07-27).
  function nameTickPart(
    key: "own" | "next" | "counterpart",
    ownDeviceName: string | null,
    ownTrib: string,
    nextDeviceName: string,
    nextTrib: string,
    counterpartText: string
  ): string {
    if (key === "own") {
      const trib = ownTrib.trim();
      return trib ? `${ownDeviceName ?? ""} (${trib})` : ownDeviceName ?? "";
    }
    if (key === "next") {
      const trib = nextTrib.trim();
      return trib ? `${nextDeviceName.trim()} (${trib})` : nextDeviceName.trim();
    }
    return counterpartText.trim();
  }

  // Thứ tự cố định own -> next -> counterpart, đúng 3 ví dụ người dùng đưa
  // (own+next, next+counterpart, own+counterpart) — chỉ áp dụng khi ĐÚNG 2
  // mục đang tick, trả về null nếu khác 2 (chưa đủ dữ liệu để tự đặt tên).
  function computeAutoName(
    ticks: { own: boolean; next: boolean; counterpart: boolean },
    interfaceType: string,
    ownDeviceName: string | null,
    ownTrib: string,
    nextDeviceName: string,
    nextTrib: string,
    counterpartText: string
  ): string | null {
    const order: ("own" | "next" | "counterpart")[] = ["own", "next", "counterpart"];
    const active = order.filter((k) => ticks[k]);
    if (active.length !== 2) return null;
    const [first, second] = active;
    const prefix = interfaceType.trim() ? `${interfaceType.trim()} ` : "";
    return `${prefix}${nameTickPart(first, ownDeviceName, ownTrib, nextDeviceName, nextTrib, counterpartText)} - ${nameTickPart(
      second,
      ownDeviceName,
      ownTrib,
      nextDeviceName,
      nextTrib,
      counterpartText
    )}`;
  }

  // Bấm tick — tối đa 2 mục cùng lúc (yêu cầu người dùng 2026-07-27): bấm mục
  // thứ 3 khi đã có 2 mục -> chặn + báo, giữ nguyên trạng thái tick cũ. Tick
  // vừa đổi xong mà ĐỦ 2 mục thì tính tên ngay bằng dữ liệu hiện có (không
  // cần đợi người dùng gõ thêm gì mới thấy tên xuất hiện).
  //
  // Dùng CHUNG cho cả form Thêm mới lẫn form Sửa (yêu cầu người dùng
  // 2026-08-02: "hai form phải giống nhau về mặt nhập liệu chứ; những gì có ở
  // bên thêm mới thì bên sửa cũng phải có" — trước đó tick này chỉ có ở Thêm
  // mới) — an toàn dùng chung 1 state `nameTicks` vì 2 khung KHÓA LẪN NHAU
  // (đang Sửa thì không Thêm được và ngược lại, xem `edit`/`creating`), không
  // bao giờ cả 2 cùng mở nên không lo tick của khung này lẫn sang khung kia.
  function toggleNameTick(key: "own" | "next" | "counterpart") {
    setNameTicks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const activeCount = Object.values(next).filter(Boolean).length;
      if (activeCount > 2) {
        alert("Chỉ được tick tối đa 2 mục để tự đặt tên luồng — bỏ tick 1 mục trước đã.");
        return prev;
      }
      if (edit) {
        const auto = computeAutoName(
          next,
          edit.interfaceType,
          edit.deviceName,
          edit.tribText,
          edit.positionNextDevice,
          edit.positionNextTrib,
          edit.counterpartText
        );
        if (auto !== null) setEdit((prevEdit) => (prevEdit ? { ...prevEdit, name: auto } : prevEdit));
      } else {
        const auto = computeAutoName(
          next,
          createDraft.interfaceType,
          createDeviceName,
          createDraft.tribText,
          createDraft.positionNextDevice,
          createDraft.positionNextTrib,
          createDraft.counterpartText
        );
        if (auto !== null) setCreateDraft((prevDraft) => ({ ...prevDraft, name: auto }));
      }
      return next;
    });
  }

  // onChange DÙNG CHUNG cho các trường trong form Sửa — đối xứng với
  // handleCreateChange bên dưới (yêu cầu người dùng 2026-08-02, xem chú
  // thích ở toggleNameTick). Không có phần suy Lĩnh vực từ deviceId vì Sửa
  // không cho đổi thiết bị.
  function handleEditChange(patch: Partial<EditState>) {
    if (!edit) return;
    const merged = { ...edit, ...patch };
    const activeCount = Object.values(nameTicks).filter(Boolean).length;
    if (activeCount === 2 && !("name" in patch)) {
      const auto = computeAutoName(
        nameTicks,
        merged.interfaceType,
        merged.deviceName,
        merged.tribText,
        merged.positionNextDevice,
        merged.positionNextTrib,
        merged.counterpartText
      );
      if (auto !== null) merged.name = auto;
    }
    setEdit(merged);
  }

  // onChange DÙNG CHUNG cho các trường trong form Thêm mới — nếu đang tick
  // ĐÚNG 2 mục, mỗi lần 1 trong các trường liên quan đổi (Giao tiếp/Trib/Vị
  // trí ODF tiếp theo/Đối phương) thì tính lại tên luôn theo dữ liệu MỚI NHẤT
  // (yêu cầu "tên luồng tự xuất hiện"). Nếu chính người dùng đang gõ tay vào
  // ô Tên luồng (patch có "name") thì KHÔNG ghi đè — tôn trọng "có thể edit
  // theo ý thích".
  function handleCreateChange(patch: Partial<CreateDraft>) {
    const merged = { ...createDraft, ...patch };
    // Chọn thẳng Thiết bị (không cần chọn Lĩnh vực trước) — thiết bị đã được
    // chuẩn hóa category sẵn trong `devices`, nên suy ngược Lĩnh vực từ thiết
    // bị vừa chọn luôn, khỏi bắt người dùng chọn tay 2 lần (yêu cầu người
    // dùng 2026-07-27).
    if ("deviceId" in patch && patch.deviceId) {
      const picked = devices.find((d) => d.id === patch.deviceId);
      if (picked) merged.category = deviceCategoryLabel(picked.category);
    }
    const activeCount = Object.values(nameTicks).filter(Boolean).length;
    if (activeCount === 2 && !("name" in patch)) {
      // Đổi Thiết bị (deviceId) thì createDeviceName (useMemo) CHƯA kịp cập
      // nhật theo giá trị mới ở đúng lượt gọi này — tra thẳng tên mới từ
      // devices thay vì dùng createDeviceName (đang là tên CŨ).
      const deviceNameForCalc = "deviceId" in patch ? devices.find((d) => d.id === patch.deviceId)?.name ?? null : createDeviceName;
      const auto = computeAutoName(
        nameTicks,
        merged.interfaceType,
        deviceNameForCalc,
        merged.tribText,
        merged.positionNextDevice,
        merged.positionNextTrib,
        merged.counterpartText
      );
      if (auto !== null) merged.name = auto;
    }
    setCreateDraft(merged);
  }

  // Thiết bị đích của form "Thêm luồng mới" — chọn Lĩnh vực trước để thu hẹp
  // danh sách Thiết bị, giống đúng nếp "1. Lĩnh vực / 2. Thiết bị" đã dùng ở
  // khung lọc phía trên, tránh phải lướt cả trăm thiết bị dồn 1 chỗ.
  const createDeviceOptions = useMemo(() => {
    return devices
      .filter((d) => !createDraft.category || deviceCategoryLabel(d.category) === createDraft.category)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [devices, createDraft.category]);

  // Danh sách cho SearchableSelect (yêu cầu người dùng 2026-07-27: <select>
  // gốc bắt cuộn hết cả đống thiết bị mới thấy, cần ô lọc gõ tìm nhanh khi mở
  // dropdown) — nhóm theo Lĩnh vực để dễ nhìn khi "Lĩnh vực" đang để "Tất cả".
  const createDeviceItems = useMemo(
    () => createDeviceOptions.map((d) => ({ value: d.id, label: d.name, group: deviceCategoryLabel(d.category) })),
    [createDeviceOptions]
  );

  const createDeviceName = devices.find((d) => d.id === createDraft.deviceId)?.name ?? null;

  async function submitCreate() {
    if (!createDraft.deviceId) {
      setError("Chọn thiết bị trước khi thêm luồng.");
      return;
    }
    const { isCableMode, error: positionNextError } = validatePositionNext(createDraft.positionNextOdf, createDraft.positionNextTrib);
    if (positionNextError) {
      setError(positionNextError);
      return;
    }
    // Bắt buộc đủ mọi ô số liệu, trừ Đối phương/Ghi chú (yêu cầu người dùng
    // 2026-07-27).
    const missingFields = findMissingRequiredFields(createDraft, isCableMode);
    if (missingFields.length > 0) {
      setError(`Vui lòng nhập đủ: ${missingFields.join(", ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    setLibraryGrowWarning(null);

    // ĐẢO THỨ TỰ — xem giải thích đầy đủ ở saveEdit(): xác nhận/tạo thiết bị
    // Ô2 phải xong TRƯỚC khi insert circuit; từ chối -> hủy toàn bộ việc lưu.
    let resolvedNextDevice: { deviceId: string; deviceName: string } | null = null;
    if (!isCableMode) {
      const resolution = await resolveOrCreateNextDevice(createDraft.positionNextDevice);
      if (resolution.status === "declined") {
        setBusy(false);
        setError(
          'Chưa lưu luồng: cần xác nhận thiết bị cho "Thiết bị (tiếp theo)" trước khi lưu — sửa lại tên cho khớp thiết bị đã có, hoặc xác nhận tạo thiết bị mới ở hộp thoại.'
        );
        return;
      }
      if (resolution.status === "error") {
        setBusy(false);
        setError(`Chưa lưu luồng: tạo thiết bị "${createDraft.positionNextDevice}" thất bại — ${translatePgError(resolution.message)}`);
        return;
      }
      resolvedNextDevice = resolution;
    }

    // .select("id").single() để lấy lại id vừa tạo — cần id này để đưa dòng
    // mới lên đầu bảng + tô sáng tạm thời (yêu cầu người dùng 2026-07-28: dễ
    // kiểm tra ngay luồng vừa thêm thay vì phải tự tìm nó rơi ở đâu đó theo
    // sắp xếp/lọc hiện tại).
    const { data: inserted, error: err } = await supabase
      .from("circuits")
      .insert({
        name: createDraft.name.trim() || "(chưa đặt tên)",
        trib_text: createDraft.tribText.trim() || null,
        device_position_own: createDraft.positionOwn.trim() || null,
        device_position_next:
          combinePositionNext(
            createDraft.positionNextOdf,
            resolvedNextDevice?.deviceName ?? createDraft.positionNextDevice,
            createDraft.positionNextTrib
          ) || null,
        interface_type: createDraft.interfaceType.trim() || null,
        counterpart_text: createDraft.counterpartText.trim() || null,
        notes: createDraft.notes.trim() || null,
        device_id: createDraft.deviceId,
      })
      .select("id")
      .single();
    if (err) {
      setBusy(false);
      setError(translatePgError(err.message));
      return;
    }
    const conflictOwn = await maybeGrowLibrary(createDeviceName, createDraft.tribText, createDraft.positionOwn);
    if (conflictOwn) setLibraryGrowWarning(conflictOwn);
    await maybeCreateCounterpartDevice(createDraft.counterpartText);
    // Xem giải thích đầy đủ ở saveEdit() — CHỈ dòng ghi thư viện Ô2 mới cần
    // loại trừ Chế độ Cáp quang, autoMirrorAfterSave phải chạy LUÔN CẢ 2 chế
    // độ (bug cũ: nhốt chung khiến Chế độ Cáp quang không bao giờ tự tạo
    // mirror trung kế).
    if (!isCableMode && resolvedNextDevice) {
      const conflictNext = await maybeGrowLibrary(resolvedNextDevice.deviceName, createDraft.positionNextTrib, createDraft.positionNextOdf);
      if (conflictNext) setLibraryGrowWarning(conflictNext);
    }
    await autoMirrorAfterSave(inserted.id, createDraft.name.trim() || "(chưa đặt tên)");
    setBusy(false);
    setCreating(false);
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setNameTicks({ own: false, next: false, counterpart: false });
    // Không cần tự ghim/tô sáng thủ công nữa (2026-07-31) — router.refresh()
    // nạp lại circuits với updated_at mới của dòng vừa tạo, updatedTodayIds/
    // filtered (useMemo) tự đẩy nó lên đầu bảng + tô nền, giữ vậy tới hết
    // ngày hôm nay, không cần setTimeout tắt sau vài giây như trước.
    router.refresh();
  }

  // Khối field DÙNG CHUNG giữa khung "Thêm luồng mới" và "Sửa luồng thiết
  // bị" (yêu cầu người dùng 2026-07-27: 2 khung phải giống hệt nhau, bản chất
  // cùng 1 bộ trường) — riêng phần Lĩnh vực/Thiết bị KHÔNG nằm trong đây vì
  // 2 bên khác nhau (Thêm: chọn được; Sửa: chỉ hiện tên tĩnh, xem chỗ gọi).
  function renderCircuitFormFields(
    values: SharedCircuitFields,
    onChange: (patch: Partial<SharedCircuitFields>) => void,
    deviceNameForLookup: string | null,
    tribDatalistId: string,
    tribNextDatalistId: string,
    enableNameTicks: boolean
  ) {
    const { trunkMatch, isCableMode, error: positionNextError, warning: positionNextWarning } = validatePositionNext(
      values.positionNextOdf,
      values.positionNextTrib
    );
    return (
      <>
        <label className="text-xs text-slate-500">
          Tên luồng <span className="text-red-500">*</span>
          {/* textarea (không phải input) để kéo to/nhỏ được như ô Ghi chú —
              tên luồng thực tế có thể rất dài (yêu cầu người dùng 2026-07-27:
              ô nhỏ quá, phải cuộn ngang mới xem/sửa hết được). rows=1 để mặc
              định thấp gần bằng ô input bên cạnh, kéo lớn khi cần. */}
          <textarea
            className="input mt-1 resize-y"
            rows={1}
            placeholder="VD: 100GE ADN1.P2 (1/0/3) - 2T9.P1(4/0/3)"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            autoFocus
          />
        </label>
        <label className="text-xs text-slate-500">
          Trib <span className="text-red-500">*</span>
          <input
            className="input mt-1"
            list={tribDatalistId}
            placeholder="VD: S1-1, 1/0/27"
            value={values.tribText}
            onChange={(e) => {
              const v = e.target.value;
              const match = findLibraryMatchByTrib(deviceNameForLookup, v);
              onChange({ tribText: v, positionOwn: match?.odfPosition ?? values.positionOwn });
            }}
          />
        </label>
        <label className="text-xs text-slate-500">
          Vị trí ODF (thiết bị) <span className="text-red-500">*</span>
          <input
            className="input mt-1"
            list="dc-odf-position-options"
            placeholder="VD: ODF 5/7 (37,38)"
            value={values.positionOwn}
            onChange={(e) => {
              const v = e.target.value;
              const match = findLibraryMatchByOdf(deviceNameForLookup, v);
              onChange({ positionOwn: v, tribText: match?.devicePosition ?? values.tribText });
            }}
            onBlur={() => {
              // Cùng cơ chế chuẩn hóa như Ô1 "Vị trí ODF (tiếp theo)" (thêm
              // 2026-07-27 khi đã có rack ODF/DDF nội bộ thật) — ô này không
              // có Ô2/Ô3 đi kèm nên chỉ cần chuẩn hóa chữ, không có chế độ gì
              // để phân biệt.
              const match = matchTrunkPosition(values.positionOwn, trunkPorts);
              const canonical = formatCanonicalOdfPosition(match);
              if (canonical && canonical !== values.positionOwn) {
                onChange({ positionOwn: canonical });
              }
            }}
          />
        </label>
        <div className="text-xs text-slate-500">
          Vị trí ODF (tiếp theo) <span className="text-red-500">*</span>
          {/* 3 ô xếp chồng (yêu cầu người dùng 2026-07-27, tinh chỉnh lại sau
              đó): Ô1 tọa độ ODF, Ô2 thiết bị local ADN1 HOẶC cáp quang trung
              kế, Ô3 Trib/Sợi — TỰ NHẬN DIỆN chế độ qua matchTrunkPosition(Ô1)
              (không còn chọn tay): khớp được 1 rack TRUNG KẾ thật -> chắc
              chắn đấu thẳng ra trung kế, tự điền Ô2 (tên tuyến cáp, KHÓA
              không cho sửa tay để đảm bảo toàn vẹn dữ liệu) + suy 2 chiều
              Port(Ô1)<->Sợi(Ô3). Khớp rack ODF/DDF NỘI BỘ thật (domain=
              'device', thêm 2026-07-27 — xem
              scripts/import-internal-odf-racks.ts) thì VẪN ở chế độ Thiết bị
              như không khớp gì (không phải đấu ra trạm khác) — chỉ khác là Ô1
              vẫn được chuẩn hóa/validate vì đã có port thật để đối chiếu, xem
              isCableMode trong validatePositionNext(). Lưu gộp lại 1 chuỗi
              qua combinePositionNext(), hiển thị bảng tổng hợp vẫn 1 cột như
              cũ. */}
          <input
            className="input mt-1"
            list="dc-odf-position-options"
            placeholder="VD: ODF 3/14 (27,28)"
            value={values.positionNextOdf}
            onChange={(e) => {
              const v = e.target.value;
              const match = matchTrunkPosition(v, trunkPorts);
              // Chỉ chuyển "chế độ Cáp quang" khi khớp rack TRUNG KẾ thật —
              // khớp rack ODF/DDF nội bộ (domain='device') vẫn ở chế độ Thiết
              // bị như không khớp gì (xem validatePositionNext.isCableMode).
              const isCableMatch = match.matched && match.rackDomain === "trunk";
              if (isCableMatch) {
                const cleanPorts = !match.invalidPortNumbers || match.invalidPortNumbers.length === 0;
                const fiberText =
                  cleanPorts && match.resolvedPorts && match.resolvedPorts.length > 0
                    ? match.resolvedPorts.map((p) => p.fiberNumber ?? p.portNumber).join(",")
                    : values.positionNextTrib;
                onChange({ positionNextOdf: v, positionNextDevice: match.cableRouteName ?? "", positionNextTrib: fiberText });
              } else {
                // Không khớp rack trung kế nào (hoặc khớp ODF/DDF nội bộ) ->
                // chế độ Thiết bị (Ô2 quay lại free-text, dùng
                // findLibraryMatchByOdf như trước).
                const libMatch = findLibraryMatchByOdf(values.positionNextDevice || null, v);
                onChange({ positionNextOdf: v, positionNextTrib: libMatch?.devicePosition ?? values.positionNextTrib });
              }
            }}
            onBlur={() => {
              // Chờ gõ xong hẳn (buông focus) mới viết lại đúng chuẩn — gõ
              // dở nửa chừng mà đã bị sửa lại thì rất khó chịu.
              const canonical = formatCanonicalOdfPosition(trunkMatch);
              if (canonical && canonical !== values.positionNextOdf) {
                onChange({ positionNextOdf: canonical });
              }
            }}
          />
          {isCableMode ? (
            <>
              <div className="mt-1 text-[11px] text-slate-400">
                Cáp quang (tiếp theo) <span className="text-red-500">*</span>
              </div>
              {/* Read-only (yêu cầu người dùng: khóa không cho sửa tay để đảm
                  bảo toàn vẹn dữ liệu — lấy thẳng từ racks.cable_route_name). */}
              <div className="input mt-1 flex items-center bg-slate-100 text-slate-500">{trunkMatch.cableRouteName ?? "—"}</div>
              <button
                type="button"
                className="mt-1 self-start text-xs text-primary-600 hover:underline"
                onClick={() => setQuickViewTrunkMatch(trunkMatch)}
              >
                Xem nhanh port đích →
              </button>
              <div className="mt-1 text-[11px] text-slate-400">
                Sợi quang (tiếp theo) <span className="text-red-500">*</span>
              </div>
              {/* Read-only (yêu cầu người dùng 2026-08-02: "Có ODF x/y (a,b)
                  thuộc trung kế là biết port mấy, sợi quang mấy luôn rồi cần
                  gì gõ tay nữa" — trước đây vẫn là ô nhập tay, cho gõ NGƯỢC từ
                  Sợi ra Port, dù đã tự điền sẵn khi gõ Ô1. Sợi quang suy 1-1
                  từ port thật của tuyến cáp (trunkMatch.resolvedPorts), không
                  cần/không nên cho gõ tay lệch khỏi port đã chọn ở Ô1 — cùng
                  tinh thần khóa như "Cáp quang" ở trên. */}
              <div className="input mt-1 flex items-center bg-slate-100 text-slate-500">
                {trunkMatch.resolvedPorts && trunkMatch.resolvedPorts.length > 0
                  ? trunkMatch.resolvedPorts.map((p) => p.fiberNumber ?? p.portNumber).join(",")
                  : "—"}
              </div>
            </>
          ) : (
            <>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-400">
                {/* Tick "dùng để tự đặt tên luồng" — CHỈ khi enableNameTicks
                    (form Thêm mới) VÀ đang ở chế độ Thiết bị (yêu cầu người
                    dùng 2026-07-27: không có tick cho Cáp quang/Sợi quang). */}
                {enableNameTicks && (
                  <input
                    type="checkbox"
                    checked={nameTicks.next}
                    onChange={() => toggleNameTick("next")}
                    title="Dùng thiết bị (tiếp theo) này để tự đặt tên luồng (tối đa 2 mục)"
                  />
                )}
                Thiết bị (tiếp theo) <span className="text-red-500">*</span>
              </div>
              <input
                className="input mt-1"
                list="dc-local-device-options"
                placeholder="VD: PE2"
                value={values.positionNextDevice}
                onChange={(e) => onChange({ positionNextDevice: e.target.value })}
              />
              <div className="mt-1 text-[11px] text-slate-400">
                Trib (tiếp theo) <span className="text-red-500">*</span>
              </div>
              <input
                className="input mt-1"
                list={tribNextDatalistId}
                placeholder="VD: S1-1, 1/0/27"
                value={values.positionNextTrib}
                onChange={(e) => {
                  const v = e.target.value;
                  const match = findLibraryMatchByTrib(values.positionNextDevice || null, v);
                  onChange({ positionNextTrib: v, positionNextOdf: match?.odfPosition ?? values.positionNextOdf });
                }}
              />
            </>
          )}
          {positionNextError && <p className="mt-1 text-[11px] font-medium text-red-600">{positionNextError}</p>}
          {!positionNextError && positionNextWarning && <p className="mt-1 text-[11px] font-medium text-amber-600">{positionNextWarning}</p>}
        </div>
        <label className="text-xs text-slate-500">
          Giao tiếp <span className="text-red-500">*</span>
          <input
            className="input mt-1"
            list="dc-interface-options"
            placeholder="VD: 100GE, 10GE"
            value={values.interfaceType}
            onChange={(e) => onChange({ interfaceType: e.target.value })}
          />
        </label>
        {/* div (KHÔNG phải label) — cùng lý do/cùng bug đã sửa ở khối "Thiết
            bị" phía trên (yêu cầu người dùng 2026-07-28): bấm quanh ô Đối
            phương (không trúng đúng textarea) từng bị tick nhầm vì <label>
            bọc cả checkbox lẫn textarea bên dưới. */}
        <div className="text-xs text-slate-500">
          <span className="inline-flex items-center gap-1">
            {enableNameTicks && (
              <input
                type="checkbox"
                checked={nameTicks.counterpart}
                onChange={() => toggleNameTick("counterpart")}
                title="Dùng Đối phương để tự đặt tên luồng (tối đa 2 mục)"
              />
            )}
            Đối phương
          </span>
          {/* Cùng lý do textarea như Tên luồng — tên thiết bị đối phương kèm
              tọa độ cũng thường dài. */}
          <textarea
            className="input mt-1 resize-y"
            rows={1}
            placeholder="VD: ADN1.PSS24X#3 BB1 (2-3-21)"
            value={values.counterpartText}
            onChange={(e) => onChange({ counterpartText: e.target.value })}
          />
        </div>
        <label className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
          Ghi chú
          <textarea
            className="input mt-1 resize-y"
            rows={2}
            placeholder="Ghi chú thêm (nếu có)..."
            value={values.notes}
            onChange={(e) => onChange({ notes: e.target.value })}
          />
        </label>
      </>
    );
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}

      {libraryGrowWarning && (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Đã lưu luồng, nhưng thư viện "Vị trí thiết bị" đang có 1 dòng KHÁC cho {libraryGrowWarning.deviceName} (
          {libraryGrowWarning.trib}): thư viện ghi "{libraryGrowWarning.existingOdf ?? "(trống)"}", luồng vừa lưu ghi "
          {libraryGrowWarning.newOdf}". Không tự ghi đè — xử lý ở{" "}
          <Link href="/data-quality" className="underline hover:text-amber-900">
            trang Chất lượng dữ liệu
          </Link>
          .
          <button type="button" className="ml-2 underline hover:text-amber-900" onClick={() => setLibraryGrowWarning(null)}>
            Đóng
          </button>
        </div>
      )}

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
      <datalist id="dc-local-device-options">
        {localDeviceNameOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dc-trib-options-next-edit">
        {tribOptionsForDevice(edit?.positionNextDevice || null).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <datalist id="dc-trib-options-next-create">
        {tribOptionsForDevice(createDraft.positionNextDevice || null).map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      <div className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-primary-800">Thêm luồng thiết bị mới</p>
          {/* Khóa nút Thêm khi đang Sửa 1 luồng khác (yêu cầu người dùng
              2026-07-27): phải Lưu hoặc Hủy phần Sửa xong mới được Thêm mới,
              không cho vừa Sửa vừa Thêm cùng lúc — tránh mất dở dữ liệu đang
              sửa. */}
          <RoleGate allow={["operator", "admin"]}>
            <button
              type="button"
              className="btn-secondary px-2 py-1 text-xs"
              onClick={() => (creating ? cancelCreate() : openCreate())}
              disabled={!creating && edit !== null}
              title={!creating && edit !== null ? "Đang sửa 1 luồng khác — Lưu hoặc Hủy trước khi thêm mới" : undefined}
            >
              {creating ? "Hủy" : "+ Thêm luồng mới"}
            </button>
          </RoleGate>
        </div>
        {creating && (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="text-xs text-slate-500">
                Lĩnh vực
                {/* w-auto (yêu cầu người dùng 2026-07-27): ô này trước đây
                    kéo full-width dù nội dung chỉ vài chữ — thu lại theo đúng
                    độ dài lĩnh vực dài nhất, padding 2 bên đã có sẵn từ
                    .input (px-2.5). Cùng cách "input w-auto" đã dùng ở ô "Số
                    dòng/trang" phía dưới. */}
                <select
                  className="input mt-1 w-auto"
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
              {/* div (KHÔNG phải label) — yêu cầu người dùng 2026-07-28: bấm
                  bất kỳ đâu trong khung "Thêm luồng mới" (kể cả padding
                  quanh SearchableSelect, không trúng đúng ô chọn) lại bị tick
                  nhầm ô "Thiết bị". Nguyên nhân: <label> bọc CẢ checkbox lẫn
                  SearchableSelect bên dưới nó — trình duyệt coi checkbox là
                  control liên kết với label, nên bấm bất kỳ chỗ nào trong
                  label (ngoài chính SearchableSelect) đều toggle checkbox đó.
                  Đổi sang <div> (không có hành vi ngầm này) — cùng cách
                  "Thiết bị (tiếp theo)" bên dưới đã làm đúng từ đầu. */}
              <div className="text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={nameTicks.own}
                    onChange={() => toggleNameTick("own")}
                    title="Dùng thiết bị này để tự đặt tên luồng (tối đa 2 mục)"
                  />
                  Thiết bị <span className="text-red-500">*</span>
                </span>
                <SearchableSelect
                  items={createDeviceItems}
                  value={createDraft.deviceId}
                  onChange={(v) => handleCreateChange({ deviceId: v })}
                  placeholder="-- Chọn thiết bị --"
                />
              </div>
              {renderCircuitFormFields(
                createDraft,
                handleCreateChange,
                createDeviceName,
                "dc-trib-options-create",
                "dc-trib-options-next-create",
                true
              )}
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

      {/* Khung Sửa — yêu cầu người dùng 2026-07-27: bấm "Sửa" ở 1 dòng không
          còn mở form ngay trong dòng đó (bảng cũ) nữa, mà mở khung RIÊNG,
          giống hệt khung "Thêm luồng mới" ở trên (cùng bộ trường), nằm ngay
          dưới khung Thêm. Chỉ khác chỗ Thiết bị: hiện tên tĩnh (không đổi
          thiết bị của luồng đã có ở đây — đổi ở trang Danh mục thiết bị). */}
      {edit && (
        <div id={EDIT_BOX_ID} className="mb-4 rounded-lg border border-primary-200 bg-primary-50/40 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-primary-800">Sửa luồng thiết bị</p>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="text-xs text-slate-500">
              <span className="inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={nameTicks.own}
                  onChange={() => toggleNameTick("own")}
                  title="Dùng thiết bị này để tự đặt tên luồng (tối đa 2 mục)"
                />
                Thiết bị
              </span>
              <div className="input mt-1 flex items-center bg-slate-100 text-slate-500">{edit.deviceName ?? "(chưa xác định)"}</div>
              <div className="mt-1 text-[11px] text-slate-400">(sửa tên thiết bị ở Danh mục thiết bị)</div>
            </div>
            {renderCircuitFormFields(
              edit,
              handleEditChange,
              edit.deviceName,
              "dc-trib-options-edit",
              "dc-trib-options-next-edit",
              true
            )}
          </div>
          {(() => {
            // Nút "Kiểm tra đồng bộ với hồ sơ ODF trung kế" (yêu cầu người
            // dùng 2026-08-02, "kiểm tra 01 luồng" ngay tại chỗ đang sửa) —
            // chỉ hiện khi tìm được đúng 1 cặp tương ứng trong
            // circuitPairDetails (xem lib/circuitPairSync.ts), y hệt cơ chế
            // bên PortTable.tsx EditRow.
            const pairDetail = circuitPairDetails?.find((d) => d.deviceCircuitId === edit.id) ?? null;
            // "Gỡ liên kết" dựa trên mirrorLinkStatuses (KHÔNG chỉ pairDetail)
            // vì cũng phải hiện được cho mirror thiết bị-thiết bị, loại
            // pairDetail (device-trunk, xem lib/circuitPairSync.ts) không phủ
            // tới (yêu cầu người dùng 2026-08-02).
            const isLinked = mirrorLinkStatuses?.[edit.id] === "linked";
            if (!pairDetail && !isLinked) return null;
            return (
              <div className="mt-3">
                {pairDetail && (
                  <button
                    type="button"
                    className="text-xs text-primary-600 hover:underline"
                    onClick={() => setShowSyncCheck((v) => !v)}
                  >
                    {showSyncCheck ? "▲ Ẩn" : "🔎 Kiểm tra đồng bộ với hồ sơ ODF trung kế"}
                  </button>
                )}
                {showSyncCheck && pairDetail && (
                  <div className="mt-1">
                    <CircuitPairSyncPanel detail={pairDetail} onApplied={() => setShowSyncCheck(false)} />
                  </div>
                )}
                {isLinked && (
                  <div className={pairDetail ? "mt-2" : undefined}>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-red-600 hover:underline"
                      disabled={busy}
                      onClick={() => unlinkMirror(edit.id, pairDetail?.trunkName ?? null)}
                      title="Tách liên kết mirror_of_id — không xóa dữ liệu bên nào, chỉ không còn tự đồng bộ nữa. Dùng khi cần đổi luồng này sang 1 đấu nối khác."
                    >
                      🔓 Gỡ liên kết
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={saveEdit} disabled={busy}>
              Lưu
            </button>
            <button className="btn-secondary" onClick={cancelEdit} disabled={busy}>
              Hủy
            </button>
          </div>
        </div>
      )}

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

      <div className="flex flex-wrap items-center gap-3 mb-2">
        <p className="text-sm text-slate-500">
          {filtered.length}/{circuits.length} luồng · đã chọn {selected.size}
        </p>
        {Object.values(filters).some((v) => v) && (
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() =>
              setFilters({
                name: "",
                linkStatus: "",
                trib: "",
                device: "",
                positionOwn: "",
                positionNext: "",
                interface: "",
                counterpart: "",
                notes: "",
              })
            }
          >
            Xóa bộ lọc
          </button>
        )}
        {updatedTodayIds.size > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={onlyUpdatedToday}
              onChange={(e) => setOnlyUpdatedToday(e.target.checked)}
            />
            Chỉ hiện luồng sửa hôm nay ({updatedTodayIds.size})
          </label>
        )}
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={selectAllVisible}>
          Chọn tất cả đang hiện
        </button>
        <button type="button" className="text-xs text-primary-600 hover:underline" onClick={clearVisible}>
          Bỏ chọn đang hiện
        </button>
        {selected.size > 0 && (
          <>
            <button type="button" className="text-xs text-slate-500 hover:underline" onClick={clearAllSelected}>
              Bỏ chọn tất cả ({selected.size})
            </button>
            <RoleGate allow={["operator", "admin"]}>
              <button
                type="button"
                className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={deleteSelectedCircuits}
                disabled={busy}
              >
                {busy ? "Đang xóa..." : `Xóa ${selected.size} luồng đã chọn`}
              </button>
            </RoleGate>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => setHistoryOpen(true)}>
            Lịch sử tra cứu
          </button>
          <ExportExcelButton columns={exportColumns} rows={filtered} sheetName="Hồ sơ đấu nối" fileNamePrefix="Ho_so_dau_noi" />
          <ColumnPicker items={COLUMN_ITEMS} visible={visible} onToggle={toggleColumn} />
        </div>
      </div>

      <CircuitReportPanel items={reportItems} />
      <ReportHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />

      {/* max-h + overflow-auto (thay vì chỉ overflow-x-auto) là bắt buộc để
          sticky hoạt động: overflow-x khác "visible" mà overflow-y vẫn
          "visible" thì trình duyệt tự đổi overflow-y thành "auto" ngầm —
          nhưng khung này lúc đó không có chiều cao giới hạn nên KHÔNG BAO GIỜ
          thật sự cuộn ở chính nó (trang cuộn thay), khiến sticky vô tác dụng.
          Giới hạn chiều cao để khung THẬT SỰ tự cuộn, khi đó tiêu đề bảng mới
          dính lại đúng như mong đợi. */}
      <EmptyUntilFiltered
        active={scopeChosen}
        onShowAll={() => setViewAll(true)}
        prompt="Chọn lĩnh vực hoặc thiết bị ở trên để xem, hoặc"
      >
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 40 }} />
            <col style={{ width: colWidths.name }} />
            {visible.linkStatus && <col style={{ width: 110 }} />}
            {visible.trib && <col style={{ width: 110 }} />}
            {showDeviceColumn && <col style={{ width: colWidths.device }} />}
            {visible.positionOwn && <col style={{ width: colWidths.positionOwn }} />}
            {visible.positionNext && <col style={{ width: colWidths.positionNext }} />}
            {visible.interface && <col style={{ width: 90 }} />}
            {visible.counterpart && <col style={{ width: colWidths.counterpart }} />}
            {visible.notes && <col style={{ width: colWidths.notes }} />}
            <col style={{ width: 130 }} />
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 text-left align-top font-semibold">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearVisible())}
                  title="Chọn/bỏ chọn tất cả đang hiện"
                />
              </th>
              <DataTh
                label="Tên luồng"
                sortKey="name"
                activeSortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                filterValue={filters.name}
                onFilterChange={(v) => setFilter("name", v)}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
              />
              {visible.linkStatus && (
                <DataTh
                  label="Trạng thái"
                  sortKey="linkStatus"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.linkStatus}
                  onFilterChange={(v) => setFilter("linkStatus", v)}
                  filterOptions={MIRROR_LINK_FILTER_OPTIONS}
                />
              )}
              {visible.trib && (
                <DataTh
                  label="Trib"
                  sortKey="trib"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.trib}
                  onFilterChange={(v) => setFilter("trib", v)}
                />
              )}
              {showDeviceColumn && (
                <DataTh
                  label="Thiết bị"
                  sortKey="device"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.device}
                  onFilterChange={(v) => setFilter("device", v)}
                  width={colWidths.device}
                  onResize={(w) => resizeCol("device", w)}
                />
              )}
              {visible.positionOwn && (
                <DataTh
                  label="Vị trí ODF (thiết bị)"
                  sortKey="positionOwn"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.positionOwn}
                  onFilterChange={(v) => setFilter("positionOwn", v)}
                  width={colWidths.positionOwn}
                  onResize={(w) => resizeCol("positionOwn", w)}
                />
              )}
              {visible.positionNext && (
                <DataTh
                  label="Vị trí ODF (tiếp theo)"
                  sortKey="positionNext"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.positionNext}
                  onFilterChange={(v) => setFilter("positionNext", v)}
                  width={colWidths.positionNext}
                  onResize={(w) => resizeCol("positionNext", w)}
                />
              )}
              {visible.interface && (
                <DataTh
                  label="Giao tiếp"
                  sortKey="interface"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.interface}
                  onFilterChange={(v) => setFilter("interface", v)}
                />
              )}
              {visible.counterpart && (
                <DataTh
                  label="Đối phương"
                  sortKey="counterpart"
                  activeSortKey={sortKey}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  filterValue={filters.counterpart}
                  onFilterChange={(v) => setFilter("counterpart", v)}
                  width={colWidths.counterpart}
                  onResize={(w) => resizeCol("counterpart", w)}
                />
              )}
              {visible.notes && (
                <DataTh
                  label="Ghi chú"
                  filterValue={filters.notes}
                  onFilterChange={(v) => setFilter("notes", v)}
                  width={colWidths.notes}
                  onResize={(w) => resizeCol("notes", w)}
                />
              )}
              <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 text-left align-top font-semibold">Thao tác</th>
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
                  // scroll-mt-24: bù chiều cao tiêu đề cột STICKY khi
                  // scrollIntoView() nhảy tới dòng này — thiếu dòng này thì
                  // dòng gần đầu danh sách (không đủ dòng phía trên để
                  // scrollIntoView căn giữa) bị cuộn lên ngay dưới tiêu đề,
                  // nhưng tiêu đề sticky lại đè lên che mất (cùng loại lỗi
                  // vừa gặp lại bên PortTable.tsx 2026-07-28, xem
                  // architecture.md).
                  className={`scroll-mt-24 border-t border-slate-100 align-top ${
                    highlightId === c.id
                      ? "bg-amber-100"
                      : editing
                        ? "bg-primary-50/60"
                        : inConflict
                          ? "bg-red-50 hover:bg-red-100"
                          : updatedTodayIds.has(c.id)
                            ? "bg-yellow-50 hover:bg-yellow-100"
                            : "hover:bg-primary-50/50"
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-3 py-2 text-slate-700 break-words">
                    {displayName(c) || "—"}
                    <div className="text-xs text-slate-400">Cập nhật lần cuối: {formatLastUpdated(c.updatedAt)}</div>
                  </td>
                  {visible.linkStatus && (
                    <td className="px-3 py-2 text-xs">
                      <MirrorLinkStatusIcon status={mirrorLinkStatuses?.[c.id]} circuitId={c.id} />
                    </td>
                  )}
                  {visible.trib && <td className="px-3 py-2 text-slate-600 break-words">{c.tribText ?? "—"}</td>}
                  {showDeviceColumn && (
                    <td className="px-3 py-2 text-slate-600 break-words">
                      {c.deviceName ?? "(chưa xác định)"}
                      {!c.deviceId && (
                        <span className="ml-1 text-xs text-amber-600" title="Chưa chuẩn hóa — xem trang Danh mục thiết bị">
                          (chưa chuẩn hóa)
                        </span>
                      )}
                    </td>
                  )}
                  {visible.positionOwn && (
                    <td className={`px-3 py-2 break-words ${ownConflict ? "font-semibold text-red-700" : "text-slate-600"}`}>
                      {c.devicePositionOwn ?? "—"}
                      {ownConflict && (
                        <div className="text-xs font-normal text-red-600" title={othersForPosition(c.id, c.devicePositionOwn).join(", ")}>
                          Trùng với: {othersForPosition(c.id, c.devicePositionOwn).join(", ")}
                        </div>
                      )}
                    </td>
                  )}
                  {visible.positionNext && <td className="px-3 py-2 text-slate-600 break-words">{positionNextDisplayById.get(c.id) ?? "—"}</td>}
                  {visible.interface && <td className="px-3 py-2 text-slate-600 break-words">{c.interfaceType ?? "—"}</td>}
                  {visible.counterpart && <td className="px-3 py-2 text-slate-600 break-words">{c.counterpartText ?? "—"}</td>}
                  {visible.notes && (
                    <td className="px-3 py-2 text-slate-500 max-w-xs">
                      <div className="whitespace-pre-line line-clamp-3" title={c.notes ?? ""}>
                        {c.notes ?? "—"}
                      </div>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      {/* Khóa Sửa khi đang Thêm mới HOẶC đang sửa 1 dòng KHÁC
                          (yêu cầu người dùng 2026-07-27) — dòng đang được sửa
                          thì hiện chữ báo trạng thái thay vì nút, vì form sửa
                          nằm ở khung riêng phía trên, bấm lại "Sửa" ở đây
                          không có ý nghĩa gì thêm. */}
                      <RoleGate allow={["operator", "admin"]}>
                        {editing ? (
                          <span className="text-xs italic text-slate-400">Đang sửa ở trên</span>
                        ) : (
                          <button
                            className="text-primary-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                            onClick={() => openEdit(c)}
                            disabled={busy || creating || edit !== null}
                            title={creating ? "Đang thêm luồng mới — Lưu hoặc Hủy trước khi sửa" : edit !== null ? "Đang sửa 1 luồng khác — Lưu hoặc Hủy trước" : "Sửa"}
                            aria-label="Sửa"
                          >
                            <IconEdit />
                          </button>
                        )}
                      </RoleGate>
                      <RoleGate allow={["operator", "admin"]}>
                        <button
                          className="text-red-600 hover:underline"
                          onClick={() => deleteCircuit(c)}
                          disabled={busy}
                          title="Xóa"
                          aria-label="Xóa"
                        >
                          <IconTrash />
                        </button>
                      </RoleGate>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy luồng nào khớp bộ lọc.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </EmptyUntilFiltered>

      <SlideOverPanel
        open={quickViewTrunkMatch !== null}
        onClose={() => setQuickViewTrunkMatch(null)}
        title={`${quickViewTrunkMatch?.rackCode ?? ""} — xem nhanh`}
      >
        <div className="space-y-3">
          {quickViewTrunkPorts.map((p) => (
            <div key={p.portId} className="rounded border border-slate-200 p-3 text-sm">
              <p className="font-medium text-slate-700">
                Port {p.portNumber}
                {p.fiberNumber != null && p.fiberNumber !== p.portNumber ? ` (sợi ${p.fiberNumber})` : ""}
              </p>
              {p.circuit ? (
                <>
                  <p className="mt-1 text-slate-600">Luồng: {p.circuit.name}</p>
                  {p.circuit.interfaceType && <p className="text-slate-500">Giao tiếp: {p.circuit.interfaceType}</p>}
                </>
              ) : (
                <p className="mt-1 text-slate-400">— Trống —</p>
              )}
            </div>
          ))}
          {quickViewTrunkPorts.length === 0 && <p className="text-sm text-slate-400">Không tìm thấy port thật khớp.</p>}
          {quickViewTrunkPorts[0] && (
            <Link
              href={`/odf-trunk/${quickViewTrunkPorts[0].rackId}#port-${quickViewTrunkPorts[0].portId}`}
              className="text-sm text-primary-600 hover:underline"
            >
              Mở đầy đủ rack {quickViewTrunkMatch?.rackCode} →
            </Link>
          )}
        </div>
      </SlideOverPanel>
    </div>
  );
}
