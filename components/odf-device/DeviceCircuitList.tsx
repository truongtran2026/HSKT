"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort, type SortDir } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import {
  isPlaceholderCircuitName,
  looksLikeRealPositionText,
  normalizeDeviceNameKey,
  normalizeDevicePositionKey,
} from "@/lib/deviceNotes";
import { deviceCategoryLabel, getAdn1StationId, UNCATEGORIZED_LABEL } from "@/lib/devices";
import { formatLastUpdated } from "@/lib/format";
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
import FilterInput from "@/components/ui/FilterInput";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import SearchableSelect from "@/components/ui/SearchableSelect";
import ColumnResizeHandle from "@/components/ui/ColumnResizeHandle";
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
// width/onResize để trống (undefined) thì cột không kéo dãn được, giữ đúng
// hành vi cũ (yêu cầu người dùng 2026-07-27: "các bảng dữ liệu đều" phải kéo
// dãn được — thêm tùy chọn ở ĐÂY thay vì dùng ResizableTh dùng chung vì header
// này gộp chung sắp xếp + lọc trong 1 <th>, cấu trúc khác ResizableTh).
function SortFilterTh<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  filterValue,
  onFilterChange,
  width,
  onResize,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: SortDir;
  onSort: (key: K) => void;
  filterValue: string;
  onFilterChange: (v: string) => void;
  width?: number;
  onResize?: (width: number) => void;
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
      {width !== undefined && onResize && <ColumnResizeHandle width={width} onResize={onResize} />}
    </th>
  );
}

// Cột có lọc nhưng KHÔNG sắp xếp được (vd Ghi chú — text dài, sắp xếp không
// có nhiều ý nghĩa).
function FilterOnlyTh({
  label,
  filterValue,
  onFilterChange,
  width,
  onResize,
}: {
  label: string;
  filterValue: string;
  onFilterChange: (v: string) => void;
  width?: number;
  onResize?: (width: number) => void;
}) {
  return (
    <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 align-top">
      <div className="mb-1 font-semibold">{label}</div>
      <FilterInput value={filterValue} onChange={onFilterChange} />
      {width !== undefined && onResize && <ColumnResizeHandle width={width} onResize={onResize} />}
    </th>
  );
}

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
function splitPositionNextForEdit(raw: string): { odf: string; device: string; trib: string } {
  const split = splitOdfDeviceStructure(raw);
  if (split.matched && split.deviceName && split.port) {
    return { odf: split.odfPart ?? "", device: split.deviceName, trib: split.port };
  }
  return { odf: raw.trim(), device: "", trib: "" };
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

export default function DeviceCircuitList({
  circuits,
  devices,
  devicePositionMap,
  trunkPorts,
}: {
  circuits: DeviceCircuitRow[];
  devices: DeviceRow[];
  devicePositionMap: DevicePositionMapRow[];
  trunkPorts: TrunkPortRow[];
}) {
  const router = useRouter();
  const [categoryFilter, setCategoryFilter] = useState<string[] | null>(null); // null = tất cả lĩnh vực
  const [deviceNames, setDeviceNames] = useState<string[] | null>(null); // null = tất cả thiết bị (trong phạm vi lĩnh vực)
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("name");
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>(
    "odf-device-circuits-col-widths",
    DEFAULT_COL_WIDTHS
  );
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
  // Phân biệt highlightId đến từ "vừa thêm mới" (đẩy lên đầu bảng) với
  // highlightId đến từ link "#dc-<id>" ngoài trang (chỉ tô sáng, giữ nguyên
  // vị trí theo sắp xếp) — xem filtered (useMemo) và submitCreate() bên dưới.
  const justCreatedIdRef = useRef<string | null>(null);
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

  // Nếu đã gõ 1 "Vị trí ODF (thiết bị)" MỚI (chưa có trong thư viện của đúng
  // thiết bị đó) thì lưu thêm vào device_position_map — đúng yêu cầu "làm
  // thư viện" dần theo thời gian, không cần màn hình riêng để nhập trước.
  //
  // Đồng bộ khi ĐÃ có sẵn (thiết bị, ODF) này (yêu cầu người dùng 2026-07-27):
  // trước đây chỉ kiểm tra tồn tại theo cặp (thiết bị, ODF) rồi bỏ qua hoàn
  // toàn nếu đã có — nên khi người dùng gõ ODF trước (tự điền Trib theo thư
  // viện), rồi ĐỔI TAY sang 1 Trib khác cho đúng thực tế, giá trị mới không
  // bao giờ được ghi lại vào thư viện (thư viện giữ mãi Trib cũ/sai). Giờ nếu
  // Trib vừa lưu KHÁC Trib đã có trong thư viện, cập nhật lại cho khớp.
  async function maybeGrowLibrary(deviceName: string | null, tribText: string, positionOwn: string) {
    const odf = positionOwn.trim();
    if (!deviceName || !odf) return;
    const nameKey = normalizeDeviceNameKey(deviceName);
    const odfKey = normalizeDevicePositionKey(odf);
    const existingEntry = devicePositionMap.find(
      (m) => normalizeDeviceNameKey(m.deviceName) === nameKey && normalizeDevicePositionKey(m.odfPosition ?? "") === odfKey
    );
    if (!existingEntry) {
      await supabase.from("device_position_map").insert({
        device_name: deviceName,
        device_position: tribText.trim() || null,
        odf_position: odf,
      });
      return;
    }
    const newTribKey = normalizeDevicePositionKey(tribText);
    const existingTribKey = normalizeDevicePositionKey(existingEntry.devicePosition ?? "");
    if (newTribKey && newTribKey !== existingTribKey) {
      await supabase.from("device_position_map").update({ device_position: tribText.trim() }).eq("id", existingEntry.id);
    }
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

  // Ô "Thiết bị (tiếp theo)" (Ô2 của Vị trí ODF tiếp theo, thêm 2026-07-27) —
  // tên thiết bị LOCAL (ADN1), KHÔNG có tiền tố trạm như ô Đối phương, nên
  // không cần parseTransitText ở đây — chỉ kiểm tra thẳng tên đã có trong
  // devices chưa. Chỉ được gọi khi KHÔNG ở chế độ Cáp quang (xem
  // saveEdit/submitCreate gọi qua validatePositionNext().isCableMode) — tức
  // là gọi cả khi Ô1 không khớp gì LẪN khi khớp ODF/DDF nội bộ (domain=
  // 'device'), chỉ trừ khi khớp đúng rack trung kế thật.
  async function maybeCreateNextDevice(deviceName: string) {
    const trimmed = deviceName.trim();
    if (!trimmed) return;
    const key = normalizeDeviceNameKey(trimmed);
    if (!key || existingDeviceKeys.has(key)) return;
    const fullName = /^adn1\./i.test(trimmed) ? trimmed : `ADN1.${trimmed}`;
    if (!confirm(`Chưa có thiết bị "${fullName}" trong hệ thống (nhận diện từ ô Thiết bị (tiếp theo)).\n\nTạo mới thiết bị này?`)) return;
    try {
      const stationId = await getAdn1StationId();
      const { error: err } = await supabase.from("devices").insert({
        station_id: stationId,
        name: fullName,
        coordinate_text: null,
        full_label: fullName,
        source: "auto",
      });
      if (err) throw err;
    } catch (e) {
      setError(`Luồng đã lưu, nhưng tạo thiết bị "${fullName}" thất bại: ${e instanceof Error ? e.message : String(e)}`);
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
    const sortedArr = sortDir === "desc" ? arr.reverse() : arr;

    // Luồng vừa thêm mới (highlightId, xem submitCreate) luôn lên ĐẦU bảng,
    // bất kể đang sắp xếp/lọc theo cột nào (yêu cầu người dùng 2026-07-28) —
    // chỉ áp dụng đúng lượt vừa thêm, KHÔNG áp dụng cho highlightId đến từ
    // link "#dc-<id>" ngoài trang (đã đứng đúng vị trí theo sắp xếp, không
    // cần đẩy lên đầu, chỉ cần tô sáng).
    if (highlightId && justCreatedIdRef.current === highlightId) {
      const idx = sortedArr.findIndex((c) => c.id === highlightId);
      if (idx > 0) {
        const [item] = sortedArr.splice(idx, 1);
        sortedArr.unshift(item);
      }
    }
    return sortedArr;
  }, [circuits, categoryFilter, categoryByDeviceName, deviceNames, filters, sortKey, sortDir, highlightId]);

  // Chỉ ẩn cột "Thiết bị" khi đã lọc còn ĐÚNG 1 thiết bị cụ thể (dòng nào
  // cũng giống nhau) — còn lại (tất cả, hoặc chọn nhiều thiết bị cùng lúc)
  // vẫn cần cột này để phân biệt các dòng.
  const showDeviceColumn = deviceNames === null || deviceNames.length !== 1;
  const columnCount = (showDeviceColumn ? 9 : 8) + 1; // +1 cho cột tick chọn

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
    // Chế độ Ô2 (Thiết bị/Cáp quang) KHÔNG cần suy luận/lưu riêng nữa — luôn
    // tính lại từ positionNextOdf qua matchTrunkPosition() mỗi lần render
    // (xem renderCircuitFormFields), đảm bảo nhất quán tuyệt đối với Ô1.
    const nextSplit = splitPositionNextForEdit(c.devicePositionNext ?? "");
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
  // tick thay vì đúng 1 dòng.
  async function deleteSelectedCircuits() {
    if (selected.size === 0) return;
    if (!confirm(`Xóa vĩnh viễn ${selected.size} luồng đã chọn? Không thể hoàn tác.`)) return;
    setBusy(true);
    setError(null);
    const ids = [...selected];
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const batch = ids.slice(i, i + chunkSize);
      const { error: err } = await supabase.from("circuits").delete().in("id", batch);
      if (err) {
        setBusy(false);
        setError(err.message);
        return;
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
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from("circuits")
      .update({
        name: edit.name.trim() || "(chưa đặt tên)",
        trib_text: edit.tribText.trim() || null,
        device_position_own: edit.positionOwn.trim() || null,
        device_position_next: combinePositionNext(edit.positionNextOdf, edit.positionNextDevice, edit.positionNextTrib) || null,
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
    // Chế độ Cáp quang (isCableMode) thì Ô2 ghi tên tuyến cáp, không phải
    // thiết bị — không có gì để tạo devices/ghi thư viện device_position_map.
    if (!isCableMode) {
      await maybeGrowLibrary(edit.positionNextDevice || null, edit.positionNextTrib, edit.positionNextOdf);
      await maybeCreateNextDevice(edit.positionNextDevice);
    }
    setBusy(false);
    setEdit(null);
    router.refresh();
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
  // vừa đổi xong mà ĐỦ 2 mục thì tính tên ngay bằng dữ liệu hiện có trong
  // createDraft (không cần đợi người dùng gõ thêm gì mới thấy tên xuất hiện).
  function toggleNameTick(key: "own" | "next" | "counterpart") {
    setNameTicks((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      const activeCount = Object.values(next).filter(Boolean).length;
      if (activeCount > 2) {
        alert("Chỉ được tick tối đa 2 mục để tự đặt tên luồng — bỏ tick 1 mục trước đã.");
        return prev;
      }
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
      return next;
    });
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
          combinePositionNext(createDraft.positionNextOdf, createDraft.positionNextDevice, createDraft.positionNextTrib) || null,
        interface_type: createDraft.interfaceType.trim() || null,
        counterpart_text: createDraft.counterpartText.trim() || null,
        notes: createDraft.notes.trim() || null,
        device_id: createDraft.deviceId,
      })
      .select("id")
      .single();
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    await maybeGrowLibrary(createDeviceName, createDraft.tribText, createDraft.positionOwn);
    await maybeCreateCounterpartDevice(createDraft.counterpartText);
    if (!isCableMode) {
      await maybeGrowLibrary(createDraft.positionNextDevice || null, createDraft.positionNextTrib, createDraft.positionNextOdf);
      await maybeCreateNextDevice(createDraft.positionNextDevice);
    }
    setBusy(false);
    setCreating(false);
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setNameTicks({ own: false, next: false, counterpart: false });
    // Tái dùng CHÍNH CƠ CHẾ highlightId đã có sẵn cho "nhảy tới từ link ngoài"
    // (xem useEffect applyHash phía trên) — cùng màu amber-100, cùng thời gian
    // tự tắt 5s, và filtered (useMemo bên dưới) sẽ tự đẩy đúng id này lên đầu
    // danh sách bất kể đang sắp xếp/lọc theo cột nào.
    justCreatedIdRef.current = inserted.id;
    setHighlightId(inserted.id);
    setTimeout(() => {
      setHighlightId(null);
      justCreatedIdRef.current = null;
    }, 5000);
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
              <div className="mt-1 text-[11px] text-slate-400">
                Sợi quang (tiếp theo) <span className="text-red-500">*</span>
              </div>
              <input
                className="input mt-1"
                placeholder="VD: 1,2"
                value={values.positionNextTrib}
                onChange={(e) => {
                  const v = e.target.value;
                  const fiberNumbers = trunkMatch.rackCode ? parseNumberList(v) : null;
                  const foundPorts = fiberNumbers && trunkMatch.rackCode ? findPortsByFiberNumbers(trunkMatch.rackCode, fiberNumbers, trunkPorts) : null;
                  if (foundPorts) {
                    onChange({ positionNextTrib: v, positionNextOdf: `${trunkMatch.rackCode} (${foundPorts.map((p) => p.portNumber).join(",")})` });
                  } else {
                    onChange({ positionNextTrib: v });
                  }
                }}
              />
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
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => (creating ? cancelCreate() : openCreate())}
            disabled={!creating && edit !== null}
            title={!creating && edit !== null ? "Đang sửa 1 luồng khác — Lưu hoặc Hủy trước khi thêm mới" : undefined}
          >
            {creating ? "Hủy" : "+ Thêm luồng mới"}
          </button>
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
            <label className="text-xs text-slate-500">
              Thiết bị
              <div className="input mt-1 flex items-center bg-slate-100 text-slate-500">{edit.deviceName ?? "(chưa xác định)"}</div>
              <div className="mt-1 text-[11px] text-slate-400">(sửa tên thiết bị ở Danh mục thiết bị)</div>
            </label>
            {renderCircuitFormFields(
              edit,
              (patch) => setEdit({ ...edit, ...patch }),
              edit.deviceName,
              "dc-trib-options-edit",
              "dc-trib-options-next-edit",
              false
            )}
          </div>
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
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              onClick={deleteSelectedCircuits}
              disabled={busy}
            >
              {busy ? "Đang xóa..." : `Xóa ${selected.size} luồng đã chọn`}
            </button>
          </>
        )}
      </div>

      {/* max-h + overflow-auto (thay vì chỉ overflow-x-auto) là bắt buộc để
          sticky hoạt động: overflow-x khác "visible" mà overflow-y vẫn
          "visible" thì trình duyệt tự đổi overflow-y thành "auto" ngầm —
          nhưng khung này lúc đó không có chiều cao giới hạn nên KHÔNG BAO GIỜ
          thật sự cuộn ở chính nó (trang cuộn thay), khiến sticky vô tác dụng.
          Giới hạn chiều cao để khung THẬT SỰ tự cuộn, khi đó tiêu đề bảng mới
          dính lại đúng như mong đợi. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: 32 }} />
            <col style={{ width: colWidths.name }} />
            <col style={{ width: 110 }} />
            {showDeviceColumn && <col style={{ width: colWidths.device }} />}
            <col style={{ width: colWidths.positionOwn }} />
            <col style={{ width: colWidths.positionNext }} />
            <col style={{ width: 90 }} />
            <col style={{ width: colWidths.counterpart }} />
            <col style={{ width: colWidths.notes }} />
            <col style={{ width: 130 }} />
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <th className="sticky top-0 z-10 bg-primary-50 px-2 py-2 align-top">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                  onChange={(e) => (e.target.checked ? selectAllVisible() : clearVisible())}
                  title="Chọn/bỏ chọn tất cả đang hiện"
                />
              </th>
              <SortFilterTh
                label="Tên luồng"
                sortKey="name"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.name}
                onFilterChange={(v) => setFilter("name", v)}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
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
                  width={colWidths.device}
                  onResize={(w) => resizeCol("device", w)}
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
                width={colWidths.positionOwn}
                onResize={(w) => resizeCol("positionOwn", w)}
              />
              <SortFilterTh
                label="Vị trí ODF (tiếp theo)"
                sortKey="positionNext"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                filterValue={filters.positionNext}
                onFilterChange={(v) => setFilter("positionNext", v)}
                width={colWidths.positionNext}
                onResize={(w) => resizeCol("positionNext", w)}
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
                width={colWidths.counterpart}
                onResize={(w) => resizeCol("counterpart", w)}
              />
              <FilterOnlyTh
                label="Ghi chú"
                filterValue={filters.notes}
                onFilterChange={(v) => setFilter("notes", v)}
                width={colWidths.notes}
                onResize={(w) => resizeCol("notes", w)}
              />
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
                          : "hover:bg-primary-50/50"
                  }`}
                >
                  <td className="px-2 py-2 align-top">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-4 py-2 text-slate-700 break-words">
                    {displayName(c) || "—"}
                    <div className="text-xs text-slate-400">Cập nhật lần cuối: {formatLastUpdated(c.updatedAt)}</div>
                  </td>
                  <td className="px-4 py-2 text-slate-600 break-words">{c.tribText ?? "—"}</td>
                  {showDeviceColumn && (
                    <td className="px-4 py-2 text-slate-600 break-words">
                      {c.deviceName ?? "(chưa xác định)"}
                      {!c.deviceId && (
                        <span className="ml-1 text-xs text-amber-600" title="Chưa chuẩn hóa — xem trang Danh mục thiết bị">
                          (chưa chuẩn hóa)
                        </span>
                      )}
                    </td>
                  )}
                  <td className={`px-4 py-2 break-words ${ownConflict ? "font-semibold text-red-700" : "text-slate-600"}`}>
                    {c.devicePositionOwn ?? "—"}
                    {ownConflict && (
                      <div className="text-xs font-normal text-red-600" title={othersForPosition(c.id, c.devicePositionOwn).join(", ")}>
                        Trùng với: {othersForPosition(c.id, c.devicePositionOwn).join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-slate-600 break-words">{positionNextDisplayById.get(c.id) ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 break-words">{c.interfaceType ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-600 break-words">{c.counterpartText ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-500 max-w-xs">
                    <div className="whitespace-pre-line line-clamp-3" title={c.notes ?? ""}>
                      {c.notes ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-2">
                      {/* Khóa Sửa khi đang Thêm mới HOẶC đang sửa 1 dòng KHÁC
                          (yêu cầu người dùng 2026-07-27) — dòng đang được sửa
                          thì hiện chữ báo trạng thái thay vì nút, vì form sửa
                          nằm ở khung riêng phía trên, bấm lại "Sửa" ở đây
                          không có ý nghĩa gì thêm. */}
                      {editing ? (
                        <span className="text-xs italic text-slate-400">Đang sửa ở trên</span>
                      ) : (
                        <button
                          className="text-primary-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300 disabled:no-underline"
                          onClick={() => openEdit(c)}
                          disabled={busy || creating || edit !== null}
                          title={creating ? "Đang thêm luồng mới — Lưu hoặc Hủy trước khi sửa" : edit !== null ? "Đang sửa 1 luồng khác — Lưu hoặc Hủy trước" : undefined}
                        >
                          Sửa
                        </button>
                      )}
                      <button className="text-red-600 hover:underline" onClick={() => deleteCircuit(c)} disabled={busy}>
                        Xóa
                      </button>
                    </div>
                  </td>
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
