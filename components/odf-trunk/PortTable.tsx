"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { compareValues } from "@/lib/sort";
import { useSort, type SortDir } from "@/lib/useSort";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeDeviceNameKey } from "@/lib/deviceNotes";
import { resolveDeviceByExactOrAlias, findLooseDeviceCandidate, saveDeviceAlias, type DeviceAliasRow } from "@/lib/deviceAliases";
import { growDevicePositionMapByTrib } from "@/lib/devicePositionMap";
import { splitOdfDeviceStructure, parseTransitText, isManagedStationCode } from "@/lib/parsers/transit-text";
import { matchTrunkPosition, formatCanonicalOdfPosition, matchBareTrunkLink, type TrunkPortRow } from "@/lib/trunkPorts";
import {
  autoCreateTrunkMirrorForCircuit,
  autoCreateTrunkTrunkMirrorForCircuit,
  replaceOccupantAndCreateTrunkTrunkMirror,
} from "@/lib/mirrorTrunkCircuits";
import { distinctPositionsForDevice, type DevicePositionMapRow } from "@/lib/devicePositionMap";
import { useColumnWidths } from "@/lib/useColumnWidths";
import type { CircuitOptions } from "@/lib/circuitOptions";
import { deviceCategoryLabel, type DeviceRow } from "@/lib/devices";
import { formatLastUpdated } from "@/lib/format";
import ColumnResizeHandle from "@/components/ui/ColumnResizeHandle";
import FilterInput from "@/components/ui/FilterInput";
import SlideOverPanel from "@/components/ui/SlideOverPanel";
import MirrorLinkBadge from "@/components/ui/MirrorLinkBadge";
import { unlinkCircuitMirror, type MirrorLinkStatus } from "@/lib/mirrorLinkStatus";
import { applySyncFromTrunk, hasPositionChanged, hasTribChanged, type CircuitPairDetail } from "@/lib/circuitPairSync";
import CircuitPairSyncPanel from "@/components/data-quality/CircuitPairSyncPanel";

export interface PortView {
  id: string;
  portNumber: number;
  fiberNumber: number | null;
  status: string;
  linkRole: "tx" | "rx" | "single" | null;
  transitText: string | null;
  transitLinkId: string | null;
  circuit: {
    id: string;
    name: string;
    interfaceType: string | null;
    counterpartText: string | null;
    responsePlanText: string | null;
    executionStationText: string | null;
    notes: string | null;
    circuitRole: string;
    mirrorOfId: string | null;
  } | null;
}

interface Group {
  ports: PortView[]; // 1 hoặc 2 port, đã sắp theo port_number
}

// Gộp hiển thị 2 port liên tiếp cùng circuit_id (rowspan) — CHỈ khi liền kề
// đúng 1 số port. Không liền kề hoặc chỉ 1 sợi -> mỗi port 1 dòng riêng, luôn
// hiện đầy đủ tên luồng (nguyên tắc bắt buộc, xem CLAUDE.md).
function buildGroups(ports: PortView[]): Group[] {
  const groups: Group[] = [];
  let i = 0;
  while (i < ports.length) {
    const cur = ports[i];
    const next = ports[i + 1];
    if (next && cur.circuit && next.circuit && cur.circuit.id === next.circuit.id && next.portNumber - cur.portNumber === 1) {
      groups.push({ ports: [cur, next] });
      i += 2;
    } else {
      groups.push({ ports: [cur] });
      i += 1;
    }
  }
  return groups;
}

// Toàn bộ port (trong rack) đang thuộc về 1 luồng — DÙNG CHO SỬA/XÓA/COPY/DI
// CHUYỂN, khác với buildGroups() (chỉ dùng để quyết định HIỂN THỊ rowspan).
// Bắt buộc tách riêng 2 khái niệm này: 1 luồng ghép 2 port KHÔNG liền kề vẫn
// phải sửa/xóa được như 1 thể thống nhất, dù buildGroups() luôn tách chúng
// thành 2 dòng riêng để hiển thị đúng (CLAUDE.md #2 — không liền kề thì luôn
// hiện đầy đủ tên luồng từng dòng).
function linkedPortsFor(allPorts: PortView[], circuitId: string): PortView[] {
  return allPorts.filter((p) => p.circuit?.id === circuitId).sort((a, b) => a.portNumber - b.portNumber);
}

// Hiện tên tuyến cáp trung kế NGAY trong bảng danh sách (không cần bấm Sửa
// mới thấy — yêu cầu người dùng 2026-07-29, cùng nguyên tắc đã áp dụng cho
// cột "Vị trí ODF (tiếp theo)" bên DeviceCircuitList.tsx) — CHỈ áp dụng khi
// "Chuyển tiếp" là 1 tọa độ ODF TRƠN trỏ THẲNG sang 1 rack trung kế khác,
// không qua thiết bị nào (vd "ODF 2/11 (15,16)" — không có " - <thiết bị>
// (<port>)" nên splitOdfDeviceStructure() không khớp được cấu trúc 2). Dòng
// đã có cấu trúc 2 sẵn (đã có tên thiết bị) thì giữ nguyên, không tính lại.
// Rào an toàn resolvedPorts<=2 giờ nằm trong matchBareTrunkLink() (lib/
// trunkPorts.ts) — dùng chung với lib/transitLinks.ts để không lặp lại logic
// này ở 2 nơi (xem comment đầy đủ tại định nghĩa hàm đó).
function transitDisplay(raw: string | null, trunkPorts: TrunkPortRow[]): string {
  if (!raw) return "";
  if (splitOdfDeviceStructure(raw).matched) return raw;
  const match = matchBareTrunkLink(raw, trunkPorts);
  if (match && match.rackDomain === "trunk" && match.cableRouteName) {
    return `${raw} - ${match.cableRouteName}`;
  }
  return raw;
}

// Sắp xếp áp dụng ở CẤP NHÓM (sau khi đã gộp Tx/Rx theo port vật lý liền kề)
// — không sắp xếp mảng ports thô, để không phá vỡ quy tắc gộp rowspan (luôn
// dựa theo port_number liền kề, xem buildGroups ở trên và CLAUDE.md #1/#2).
type SortKey = "port" | "fiber" | "name" | "interface" | "counterpart" | "responsePlan" | "station" | "notes";

function groupValue(g: Group, key: SortKey): string | number | null {
  const first = g.ports[0];
  const c = first.circuit;
  switch (key) {
    case "port":
      return first.portNumber;
    case "fiber":
      return first.fiberNumber;
    case "name":
      return c?.name ?? null;
    case "interface":
      return c?.interfaceType ?? null;
    case "counterpart":
      return c?.counterpartText ?? null;
    case "responsePlan":
      return c?.responsePlanText ?? null;
    case "station":
      return c?.executionStationText ?? null;
    case "notes":
      return c?.notes ?? null;
  }
}

// Lọc theo cột dùng thêm "transit" (Chuyển tiếp) — không đưa vào SortKey vì
// 2 port của 1 nhóm có thể có nội dung khác nhau, không có 1 giá trị đại
// diện rõ ràng để SẮP XẾP, nhưng LỌC thì gộp (nối) nội dung cả 2 port lại
// vẫn hợp lý (khớp nếu 1 trong 2 port chứa từ khóa).
type FilterKey = SortKey | "transit";

function filterValue(g: Group, key: FilterKey): string | number | null {
  if (key === "transit") return g.ports.map((p) => p.transitText ?? "").join(" ");
  return groupValue(g, key);
}

const FILTER_KEYS: FilterKey[] = ["port", "fiber", "name", "interface", "transit", "counterpart", "responsePlan", "station", "notes"];

interface ClipboardData {
  sourcePortIds: string[];
  label: string;
  name: string;
  interfaceType: string;
  counterpartText: string;
  responsePlanText: string;
  executionStationText: string;
  notes: string;
}

interface EditState {
  portIds: string[]; // Port ĐANG gắn với luồng này trước khi lưu (1 hoặc 2) — [] coi như chưa có gì với luồng mới tạo trên portIds[0]
  circuitId: string | null; // null = đang tạo luồng mới
  name: string;
  interfaceType: string;
  transitText: string; // dùng CHUNG cho cả 2 port khi ghép (xem saveEdit)
  counterpartText: string;
  responsePlanText: string;
  executionStationText: string;
  notes: string;
  mergeEnabled: boolean; // đang ghép port chính với 1 port khác (liền kề hoặc không)
  secondPortNumber: string; // số port ghép cùng, dạng text để gõ tự do
  secondPortId: string | null; // port thực tương ứng, null nếu chưa hợp lệ
  secondPortError: string | null;
}

// Tìm port theo SỐ port gõ tay (không nhất thiết liền kề) trong cùng rack —
// phục vụ yêu cầu "ghép 2 port không liền kề": gõ số port khác vào là tự
// đồng bộ, không bắt buộc phải là port kế tiếp nữa.
function resolveSecondPort(
  portsList: PortView[],
  numberText: string,
  primaryPortId: string,
  currentCircuitId: string | null
): { id: string | null; error: string | null } {
  const trimmed = numberText.trim();
  if (!trimmed) return { id: null, error: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { id: null, error: "Số port không hợp lệ." };
  const found = portsList.find((p) => p.portNumber === n);
  if (!found) return { id: null, error: `Không tìm thấy port ${n} trong rack này.` };
  if (found.id === primaryPortId) return { id: null, error: "Không thể ghép với chính port đang thao tác." };
  // Port đã thuộc CHÍNH luồng đang sửa (vd đang ghép sẵn, gõ lại đúng số cũ)
  // -> vẫn hợp lệ, không phải "đang có luồng khác".
  if (found.circuit && found.circuit.id !== currentCircuitId) {
    return { id: null, error: `Port ${n} đang có luồng khác, không ghép được.` };
  }
  return { id: found.id, error: null };
}

// Ghép/bỏ ghép 1 tên trạm vào chuỗi "Trạm thực hiện" (nối bằng ", ") — cho
// phép chọn NHIỀU trạm cùng lúc bằng cách bấm nhiều chip, vẫn gõ tay tự do
// được nếu trạm chưa có trong danh sách gợi ý.
function toggleStationToken(text: string, token: string): string {
  const tokens = text
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const exists = tokens.some((t) => t.toLowerCase() === token.toLowerCase());
  const next = exists ? tokens.filter((t) => t.toLowerCase() !== token.toLowerCase()) : [...tokens, token];
  return next.join(", ");
}

// Giai đoạn 4 (architecture.md mục 4.2): di chuyển 1 luồng từ port/rack nguồn
// sang port/rack đích — thao tác riêng, không phải xóa-rồi-nhập-tay lại. Đích
// cũng chọn được 2 port (liền kề hoặc không), giống cơ chế "Port ghép cùng"
// ở form Sửa — mọi trường/cột khác của luồng giữ nguyên, chỉ port thay đổi.
interface MoveState {
  sourcePortIds: string[];
  circuitId: string;
  circuitName: string;
  racks: { id: string; code: string; cable_route_name: string | null }[];
  targetRackId: string | null;
  targetPorts: { id: string; port_number: number; status: string }[];
  targetPortsLoading: boolean;
  targetPortId: string | null;
  mergeEnabled: boolean;
  secondTargetPortNumber: string;
  secondTargetPortId: string | null;
  secondTargetPortError: string | null;
}

// Giống resolveSecondPort nhưng tra trên danh sách port RACK ĐÍCH đã tải
// riêng (chỉ có id/port_number/status, không có "circuit" đầy đủ).
function resolveMoveTargetPort(
  targetPorts: MoveState["targetPorts"],
  numberText: string,
  primaryPortId: string | null
): { id: string | null; error: string | null } {
  const trimmed = numberText.trim();
  if (!trimmed) return { id: null, error: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { id: null, error: "Số port không hợp lệ." };
  const found = targetPorts.find((p) => p.port_number === n);
  if (!found) return { id: null, error: `Không tìm thấy port ${n} ở rack đích.` };
  if (found.id === primaryPortId) return { id: null, error: "Không thể ghép với chính port đích đang chọn." };
  if (found.status !== "unused") return { id: null, error: `Port ${n} đang có luồng khác, không ghép được.` };
  return { id: found.id, error: null };
}

// Độ rộng cột co dãn được (px) — nhớ lại lựa chọn của người dùng giữa các
// lần vào trang (áp dụng chung cho mọi rack, không riêng từng rack).
type ResizableCol = "name" | "transit" | "responsePlan";
const DEFAULT_COL_WIDTHS: Record<ResizableCol, number> = { name: 240, transit: 200, responsePlan: 220 };

// Tiêu đề cột GỘP nhãn+sắp xếp+lọc vào ĐÚNG 1 <th> sticky — yêu cầu người
// dùng 2026-07-28: rack dài tới cả trăm port, cuộn xuống phải giữ được tiêu
// đề cột. Bắt buộc gộp 1 hàng duy nhất (không tách hàng lọc riêng bên dưới
// như trước): 2 hàng sticky riêng từng gây lỗi chữ đè nhau khi cuộn ở
// DeviceCircuitList.tsx (hàng dưới phải tự tính "top" theo chiều cao hàng
// trên, dễ lệch nếu nội dung xuống dòng) — đã fix ở đó bằng đúng cách gộp 1
// hàng này, áp dụng lại y hệt ở đây thay vì SortableTh/ResizableTh cũ.
function Th<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  width,
  onResize,
  filterValue,
  onFilterChange,
}: {
  label: string;
  sortKey?: K;
  activeKey?: K;
  dir?: SortDir;
  onSort?: (key: K) => void;
  width?: number;
  onResize?: (width: number) => void;
  filterValue: string;
  onFilterChange: (v: string) => void;
}) {
  const sortable = sortKey !== undefined && !!onSort;
  const active = sortable && activeKey === sortKey;
  return (
    <th className="sticky top-0 z-10 relative bg-primary-50 px-3 py-2 text-left align-top">
      <div
        className={`mb-1 flex items-center gap-1 font-semibold ${sortable ? "cursor-pointer select-none hover:text-primary-900" : ""}`}
        onClick={sortable ? () => onSort!(sortKey!) : undefined}
        title={sortable ? "Bấm để sắp xếp" : undefined}
      >
        {label}
        {sortable && (
          <span className={`text-xs ${active ? "text-primary-700" : "text-primary-300"}`}>
            {active ? (dir === "asc" ? "▲" : "▼") : "⇅"}
          </span>
        )}
      </div>
      <FilterInput value={filterValue} onChange={onFilterChange} />
      {width !== undefined && onResize && <ColumnResizeHandle width={width} onResize={onResize} />}
    </th>
  );
}

export default function PortTable({
  rackId,
  initialPorts,
  options,
  devices,
  deviceAliases,
  devicePositionMap,
  stationId,
  trunkPorts,
  mirrorLinkStatuses,
  circuitPairDetails,
}: {
  rackId: string;
  initialPorts: PortView[];
  options: CircuitOptions;
  devices: DeviceRow[];
  deviceAliases: DeviceAliasRow[];
  devicePositionMap: DevicePositionMapRow[];
  stationId: string;
  trunkPorts: TrunkPortRow[];
  mirrorLinkStatuses?: Record<string, MirrorLinkStatus>;
  circuitPairDetails?: CircuitPairDetail[];
}) {
  const router = useRouter();
  // KHÔNG dùng useState(initialPorts) — router.refresh() (gọi sau mỗi lần
  // Lưu/Xóa) cố ý GIỮ NGUYÊN state cũ của Client Component (hành vi chính
  // thức của Next.js, không phải bug của Next), nên nếu chụp initialPorts
  // vào useState 1 lần lúc mount thì dữ liệu hiển thị sẽ mãi mãi cũ dù server
  // đã có dữ liệu mới — phải F5 cứng (mất hết state React) mới thấy đúng.
  // Không có setter nào dùng tới "ports" (chỉ đọc), nên gán thẳng biến
  // thường là đủ và luôn tự động lấy props mới nhất mỗi lần render lại.
  const ports = initialPorts;
  // Map id -> chữ hiện ở cột "Chuyển tiếp" (xem transitDisplay() ở trên) —
  // tính 1 lần cho cả rack (tối đa 48 port) thay vì gọi matchTrunkPosition()
  // lại mỗi lần render từng dòng.
  const transitDisplayByPortId = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of ports) map.set(p.id, transitDisplay(p.transitText, trunkPorts));
    return map;
  }, [ports, trunkPorts]);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [move, setMove] = useState<MoveState | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  // "saving" chỉ phủ đúng lúc đang ghi Supabase; "isRefreshing" phủ thêm lúc
  // router.refresh() đang tải lại dữ liệu (mất ~2-3s vì phải tải lại port cả
  // trạm — xem architecture.md mục 21). Gộp 2 cái thành "busy" DÙNG CHUNG cho
  // mọi nút bấm như trước (không đổi tên ở nơi dùng) — người dùng phát hiện
  // 2026-07-28: bấm Lưu xong bảng chưa cập nhật ngay mà không có dấu hiệu gì
  // đang chờ, tưởng lưu thất bại rồi tự bấm F5 cứng. Giữ busy=true xuyên suốt
  // + đổi nhãn nút thành "Đang cập nhật..." để người dùng biết vẫn đang chạy.
  const [saving, setSaving] = useState(false);
  const [isRefreshing, startRefreshTransition] = useTransition();
  const busy = saving || isRefreshing;
  const pendingAfterRefreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isRefreshing) {
      pendingAfterRefreshRef.current();
      pendingAfterRefreshRef.current = () => {};
    }
    // Chỉ cần chạy lại khi isRefreshing đổi giá trị — effect này chỉ đóng vai
    // trò "báo khi refresh xong", không phụ thuộc gì khác.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRefreshing]);
  // Gọi THAY router.refresh() trực tiếp ở mọi nơi trong file: giữ busy=true
  // (qua isRefreshing) và hoãn việc đóng form Sửa/Chuyển tuyến (afterRefresh)
  // tới khi dữ liệu mới THẬT SỰ đã áp dụng xong, thay vì đóng form ngay rồi
  // hiện dữ liệu cũ trong lúc chờ.
  function refreshAndThen(afterRefresh: () => void = () => {}) {
    pendingAfterRefreshRef.current = afterRefresh;
    startRefreshTransition(() => {
      router.refresh();
    });
  }
  const [error, setError] = useState<string | null>(null);
  // Nhảy tới + tô sáng tạm 1 port cụ thể qua hash "#port-<id>" (yêu cầu người
  // dùng 2026-07-28: link từ khung cảnh báo "Chuyển tiếp chưa đúng chuẩn
  // form" ở trang danh sách rack) — cùng cơ chế rowAnchor/highlightId đã có ở
  // DeviceCircuitList.tsx, áp dụng cho ĐÚNG 1 port (không phải cả nhóm/luồng).
  const [highlightPortId, setHighlightPortId] = useState<string | null>(null);
  useEffect(() => {
    function applyHash() {
      const hash = window.location.hash;
      if (!hash.startsWith("#port-")) return;
      const id = hash.slice("#port-".length);
      setHighlightPortId(id);
      requestAnimationFrame(() => {
        document.getElementById(`port-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      setTimeout(() => setHighlightPortId(null), 5000);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  const { widths: colWidths, resize: resizeCol } = useColumnWidths<ResizableCol>("odf-trunk-col-widths", DEFAULT_COL_WIDTHS);
  const { sortKey, sortDir, toggleSort } = useSort<SortKey>("port");
  const [filters, setFilters] = useState<Record<FilterKey, string>>({
    port: "",
    fiber: "",
    name: "",
    interface: "",
    transit: "",
    counterpart: "",
    responsePlan: "",
    station: "",
    notes: "",
  });

  function setFilter(key: FilterKey, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  const groups = buildGroups(ports);
  const filteredGroups = useMemo(
    () => groups.filter((g) => FILTER_KEYS.every((k) => matchesFilter(filterValue(g, k), filters[k]))),
    [groups, filters]
  );
  const sortedGroups = useMemo(() => {
    const arr = [...filteredGroups].sort((a, b) => compareValues(groupValue(a, sortKey), groupValue(b, sortKey)));
    return sortDir === "desc" ? arr.reverse() : arr;
  }, [filteredGroups, sortKey, sortDir]);

  // Toàn bộ port đang "dính" vào phiên sửa/tạo hiện tại — gồm portIds gốc +
  // port thứ 2 đang chọn ghép (kể cả khi port đó nằm ở 1 group HIỂN THỊ khác
  // vì không liền kề). Dùng để quyết định group nào cần "biết" về phiên sửa
  // này, dù group đó không phải nơi hiện form.
  const sessionPortIds = edit
    ? [...edit.portIds, ...(edit.mergeEnabled && edit.secondPortId && !edit.portIds.includes(edit.secondPortId) ? [edit.secondPortId] : [])]
    : [];

  // Group này có LIÊN QUAN tới phiên sửa/tạo đang mở không (để ẩn nút thao
  // tác thường đi, tránh bấm chồng chéo trong lúc đang ghép port khác rack).
  function editInvolvesGroup(group: Group): boolean {
    return group.ports.some((p) => sessionPortIds.includes(p.id));
  }

  // Group này có phải nơi HIỆN FORM sửa không (luôn là group chứa port
  // chính — portIds[0]) — group liên quan còn lại chỉ hiện ghi chú tham chiếu.
  function isEditingGroup(group: Group): boolean {
    if (!edit) return false;
    return group.ports.some((p) => p.id === edit.portIds[0]);
  }

  function openEditExisting(group: Group) {
    setMove(null);
    const circuit = group.ports[0].circuit!;
    // Port ĐANG BẤM "Sửa" luôn là port CỐ ĐỊNH (portIds[0]) — port còn lại
    // (nếu có, kể cả khi không liền kề) là port có thể đổi sang số khác qua
    // "Port ghép cùng". Trước đây lấy port SỐ NHỎ HƠN làm cố định bất kể bấm
    // từ đâu, gây hiểu nhầm "đẩy nhầm chiều" khi sửa từ port số lớn.
    const clickedPort = group.ports[0];
    const linkedPorts = linkedPortsFor(ports, circuit.id);
    const otherPort = linkedPorts.find((p) => p.id !== clickedPort.id) ?? null;
    const isPair = linkedPorts.length === 2;
    setEdit({
      portIds: otherPort ? [clickedPort.id, otherPort.id] : [clickedPort.id],
      circuitId: circuit.id,
      name: circuit.name,
      interfaceType: circuit.interfaceType ?? "",
      transitText: clickedPort.transitText ?? "",
      counterpartText: circuit.counterpartText ?? "",
      responsePlanText: circuit.responsePlanText ?? "",
      executionStationText: circuit.executionStationText ?? "",
      notes: circuit.notes ?? "",
      mergeEnabled: isPair,
      secondPortNumber: otherPort ? String(otherPort.portNumber) : "",
      secondPortId: otherPort ? otherPort.id : null,
      secondPortError: null,
    });
    setError(null);
  }

  function openCreateNew(port: PortView, prefill?: ClipboardData) {
    setMove(null);
    const idx = ports.findIndex((p) => p.id === port.id);
    const next = ports[idx + 1];
    const adjacentEligible = port.portNumber % 2 === 1 && !!next && !next.circuit && next.portNumber - port.portNumber === 1;
    setEdit({
      portIds: [port.id],
      circuitId: null,
      name: prefill?.name ?? "",
      interfaceType: prefill?.interfaceType ?? "",
      transitText: port.transitText ?? "",
      counterpartText: prefill?.counterpartText ?? "",
      responsePlanText: prefill?.responsePlanText ?? "",
      executionStationText: prefill?.executionStationText ?? "",
      notes: prefill?.notes ?? "",
      mergeEnabled: adjacentEligible,
      secondPortNumber: adjacentEligible ? String(next!.portNumber) : "",
      secondPortId: adjacentEligible ? next!.id : null,
      secondPortError: null,
    });
    setError(null);
  }

  function cancelEdit() {
    setEdit(null);
    setError(null);
  }

  // Bấm tick "Ghép port" -> bật kèm gợi ý mặc định (port liền kề nếu còn
  // trống); bỏ tick -> chỉ tắt cờ, giữ nguyên số đã gõ để lỡ tick lại không
  // mất công gõ lại.
  function toggleMerge(checked: boolean) {
    if (!edit) return;
    if (!checked) {
      setEdit({ ...edit, mergeEnabled: false });
      return;
    }
    let numberText = edit.secondPortNumber;
    if (!numberText) {
      const idx = ports.findIndex((p) => p.id === edit.portIds[0]);
      const cur = ports[idx];
      const next = ports[idx + 1];
      const adjacentEligible = !!cur && cur.portNumber % 2 === 1 && !!next && !next.circuit && next.portNumber - cur.portNumber === 1;
      if (adjacentEligible) numberText = String(next!.portNumber);
    }
    const { id, error: err } = resolveSecondPort(ports, numberText, edit.portIds[0], edit.circuitId);
    setEdit({ ...edit, mergeEnabled: true, secondPortNumber: numberText, secondPortId: id, secondPortError: err });
  }

  function changeSecondPortNumber(text: string) {
    if (!edit) return;
    const { id, error: err } = resolveSecondPort(ports, text, edit.portIds[0], edit.circuitId);
    setEdit({ ...edit, secondPortNumber: text, secondPortId: id, secondPortError: err });
  }

  // "Chuyển tiếp" đôi khi ghi rõ "<tọa độ ODF> - <thiết bị>(<port>)" (yêu cầu
  // người dùng 2026-07-27 — "cấu trúc 2", vd "ODF7/4/17,18 - ADN1.PE2
  // (et-13/0/0)"). Sau khi lưu raw_text như cũ, tách thêm thiết bị+port ra để
  // (a) hỏi tạo devices mới nếu ADN1 + chưa có (giống
  // maybeCreateCounterpartDevice ở DeviceCircuitList.tsx), (b) làm giàu thư
  // viện "Vị trí thiết bị" theo device+port đã biết chắc (xem
  // growDevicePositionMapByTrib). Không chặn việc lưu Chuyển tiếp dù bước này
  // thất bại hay bị từ chối — chỉ là bước phụ sau khi đã lưu xong.
  async function maybeStandardizeTransitDevice(transitText: string) {
    const split = splitOdfDeviceStructure(transitText);
    if (!split.matched || !split.odfPart || !split.devicePortText) return;
    const parsed = parseTransitText(split.devicePortText);
    if (!parsed.matched || !parsed.stationCode || !parsed.deviceName || !parsed.coordinateText) return;
    if (!isManagedStationCode(parsed.stationCode)) return;

    const deviceName = parsed.deviceName.trim();
    const port = parsed.coordinateText.trim();
    const odf = split.odfPart.trim();
    if (!deviceName || !port) return;

    const existing = resolveDeviceByExactOrAlias(deviceName, devices, deviceAliases);
    let canonicalName = existing?.name ?? null;

    try {
      if (!existing) {
        // Không khớp chính xác/alias đã biết — thử gợi ý "so khớp lỏng" (yêu
        // cầu người dùng 2026-08-01, xem architecture.md mục 43: bắt được vd
        // "MPE#4" trùng thiết bị đã có "MPE04") TRƯỚC khi hỏi tạo mới, để
        // không tạo trùng thiết bị chỉ vì gõ khác dấu/số 0 đầu.
        const looseCandidate = findLooseDeviceCandidate(deviceName, devices);
        if (looseCandidate) {
          const useExisting = confirm(
            `"${deviceName}" (nhận diện từ ô Chuyển tiếp) chưa khớp chính xác thiết bị nào, nhưng có thể là thiết bị đã có "${looseCandidate.name}".\n\n` +
              `OK = dùng thiết bị đã có (ghi nhớ cách gõ này cho lần sau, không hỏi lại)\nCancel = tạo thiết bị MỚI tên "ADN1.${deviceName}"`
          );
          if (useExisting) {
            canonicalName = looseCandidate.name;
            await saveDeviceAlias(looseCandidate.id, deviceName);
          }
        }
        if (!canonicalName) {
          canonicalName = `ADN1.${deviceName}`;
          if (!confirm(`Chưa có thiết bị "${canonicalName}" trong hệ thống (nhận diện từ ô Chuyển tiếp).\n\nTạo mới thiết bị này?`)) {
            return;
          }
          const { error: insErr } = await supabase.from("devices").insert({ station_id: stationId, name: canonicalName, source: "auto" });
          if (insErr) throw insErr;
        }
      }
      if (!canonicalName) return; // không thể xảy ra (mọi nhánh trên đều gán), chỉ để TypeScript hẹp kiểu an toàn
      await growDevicePositionMapByTrib(canonicalName, port, odf);
    } catch (e) {
      setError(
        `Đã lưu "Chuyển tiếp", nhưng chuẩn hóa thiết bị/thư viện thất bại: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  async function saveEdit() {
    if (!edit) return;
    if (edit.mergeEnabled && edit.secondPortNumber.trim() && !edit.secondPortId) {
      setError(edit.secondPortError ?? "Port ghép cùng không hợp lệ.");
      return;
    }
    // Chặn lưu TOÀN BỘ khi luồng ĐÃ liên kết và "Chuyển tiếp" vừa đổi Vị trí
    // ODF/Trib sang SỐ LIỆU THẬT khác (yêu cầu người dùng 2026-08-02, bước
    // 2/6 đề xuất "Nhất quán liên kết..." — trước đây, mục 49, ca này vẫn cho
    // lưu rồi hỏi confirm() có đẩy sang thiết bị không: chính lỗ hổng gây ra
    // ca AĐN1.P2(2/1/2) ở đầu phiên — im lặng tin bên vừa sửa là đúng mà
    // không ai xác nhận. CHỈ ĐỔI CÁCH GHI (số liệu vẫn khớp, qua
    // hasPositionChanged/hasTribChanged đã tự tách đúng "số" khỏi "chữ")
    // KHÔNG bị chặn — vẫn lưu bình thường, xem tự đồng bộ TÊN ở cuối hàm.
    if (edit.circuitId) {
      const linkedPair = circuitPairDetails?.find((d) => d.trunkCircuitId === edit.circuitId && d.isLinked);
      if (linkedPair) {
        const newSplit = splitOdfDeviceStructure(edit.transitText.trim());
        const newOdfPart = newSplit.matched ? newSplit.odfPart ?? null : null;
        const newTrib = newSplit.matched ? newSplit.port ?? null : null;
        if (hasPositionChanged(linkedPair.deviceOwnPosition, newOdfPart) || hasTribChanged(linkedPair.deviceTrib, newTrib)) {
          setError(
            `Luồng này đang liên kết với luồng thiết bị "${linkedPair.deviceName}". Không lưu được vì Vị trí ODF/Trib trong Chuyển tiếp vừa đổi sang số liệu khác — dùng "Kiểm tra đồng bộ với hồ sơ đấu nối" để chọn đúng bên, hoặc "Gỡ liên kết" trước nếu đây thực sự là 1 đấu nối khác.`
          );
          return;
        }
      }
    }
    setSaving(true);
    setError(null);
    try {
      const isNew = edit.circuitId === null;
      const primaryPortId = edit.portIds[0];
      const originalPortIds = isNew ? [] : edit.portIds;
      const activePortIds = edit.mergeEnabled && edit.secondPortId ? [primaryPortId, edit.secondPortId] : [primaryPortId];

      // Port trống, chưa từng có luồng, và người dùng CHỈ điền "Chuyển tiếp"
      // (không có tên luồng hay trường nào khác của luồng) -> KHÔNG tạo
      // circuit rỗng/"(chưa đặt tên)" chỉ vì 1 ghi chú vị trí đấu nối — chỉ
      // ghi/xóa "Chuyển tiếp" trực tiếp trên port, port vẫn ở trạng thái
      // trống. Đây là cách sửa/xóa "Chuyển tiếp" cho 1 port trống mà không
      // bắt buộc phải đặt tên luồng.
      const hasCircuitData = !!(
        edit.name.trim() ||
        edit.interfaceType.trim() ||
        edit.counterpartText.trim() ||
        edit.responsePlanText.trim() ||
        edit.executionStationText.trim() ||
        edit.notes.trim()
      );
      if (isNew && !hasCircuitData) {
        const transitOnly = edit.transitText.trim();
        for (const portId of activePortIds) {
          const port = ports.find((p) => p.id === portId);
          if (port?.transitLinkId) {
            if (transitOnly === "") {
              const { error: delErr } = await supabase.from("transit_links").delete().eq("id", port.transitLinkId);
              if (delErr) throw delErr;
            } else {
              const { error: updErr } = await supabase.from("transit_links").update({ raw_text: transitOnly }).eq("id", port.transitLinkId);
              if (updErr) throw updErr;
            }
          } else if (transitOnly !== "") {
            const { error: insErr } = await supabase
              .from("transit_links")
              .insert({ source_port_id: portId, target_type: "text_only", raw_text: transitOnly });
            if (insErr) throw insErr;
          }
        }
        if (transitOnly !== "") await maybeStandardizeTransitDevice(transitOnly);
        refreshAndThen(() => setEdit(null));
        return;
      }

      const circuitFields = {
        name: edit.name.trim() || "(chưa đặt tên)",
        interface_type: edit.interfaceType.trim() || null,
        counterpart_text: edit.counterpartText.trim() || null,
        response_plan_text: edit.responsePlanText.trim() || null,
        execution_station_text: edit.executionStationText.trim() || null,
        notes: edit.notes.trim() || null,
      };

      let circuitId = edit.circuitId;
      if (circuitId) {
        const { error: err } = await supabase.from("circuits").update(circuitFields).eq("id", circuitId);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase.from("circuits").insert(circuitFields).select("id").single();
        if (err) throw err;
        circuitId = data.id as string;
      }

      const removedPortIds = originalPortIds.filter((id) => !activePortIds.includes(id));
      const addedPortIds = activePortIds.filter((id) => !originalPortIds.includes(id));

      // Port bị bỏ khỏi cặp (tách luồng, vd nhả tick vì tick nhầm trước đó):
      // gỡ liên kết + XÓA LUÔN "Chuyển tiếp" của port đó (dữ liệu cũ không
      // còn hợp lệ nữa), trả port về trống — port đang giữ luồng (primary)
      // không đổi gì.
      if (removedPortIds.length > 0) {
        const { error: unlinkErr } = await supabase
          .from("port_circuit_links")
          .delete()
          .eq("circuit_id", circuitId)
          .in("port_id", removedPortIds);
        if (unlinkErr) throw unlinkErr;
        const { error: statusErr } = await supabase.from("ports").update({ status: "unused" }).in("id", removedPortIds);
        if (statusErr) throw statusErr;
        for (const portId of removedPortIds) {
          const port = ports.find((p) => p.id === portId);
          if (port?.transitLinkId) {
            const { error: delErr } = await supabase.from("transit_links").delete().eq("id", port.transitLinkId);
            if (delErr) throw delErr;
          }
        }
      }

      // Nâng từ 1 port (single) lên cặp: đổi lại link_role port chính từ
      // "single" -> "tx" cho đúng nghĩa.
      if (!isNew && activePortIds.length === 2 && originalPortIds.length === 1) {
        const { error: roleErr } = await supabase
          .from("port_circuit_links")
          .update({ link_role: "tx" })
          .eq("circuit_id", circuitId)
          .eq("port_id", primaryPortId);
        if (roleErr) throw roleErr;
      }
      // Ngược lại: từ cặp về 1 port (tách luồng) -> đổi lại "single".
      if (!isNew && activePortIds.length === 1 && originalPortIds.length === 2) {
        const { error: roleErr } = await supabase
          .from("port_circuit_links")
          .update({ link_role: "single" })
          .eq("circuit_id", circuitId)
          .eq("port_id", primaryPortId);
        if (roleErr) throw roleErr;
      }

      if (addedPortIds.length > 0) {
        const linkRows: { port_id: string; circuit_id: string; link_role: "tx" | "rx" | "single" }[] = addedPortIds.map((portId) => ({
          port_id: portId,
          circuit_id: circuitId!,
          link_role: portId === primaryPortId ? (activePortIds.length === 2 ? "tx" : "single") : "rx",
        }));
        const { error: linkErr } = await supabase.from("port_circuit_links").insert(linkRows);
        if (linkErr) throw linkErr;
        const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", addedPortIds);
        if (statusErr) throw statusErr;
      }

      // "Chuyển tiếp" dùng CHUNG 1 giá trị cho cả 2 port khi đang ghép — ghi
      // giống nhau cho mọi port đang active để bảng hiển thị gộp đúng.
      const transitText = edit.transitText.trim();
      for (const portId of activePortIds) {
        const port = ports.find((p) => p.id === portId);
        if (port?.transitLinkId) {
          if (transitText === "") {
            const { error: delErr } = await supabase.from("transit_links").delete().eq("id", port.transitLinkId);
            if (delErr) throw delErr;
          } else {
            const { error: updErr } = await supabase.from("transit_links").update({ raw_text: transitText }).eq("id", port.transitLinkId);
            if (updErr) throw updErr;
          }
        } else if (transitText !== "") {
          const { error: insErr } = await supabase
            .from("transit_links")
            .insert({ source_port_id: portId, target_type: "text_only", raw_text: transitText });
          if (insErr) throw insErr;
        }
      }
      if (transitText !== "") await maybeStandardizeTransitDevice(transitText);

      // Tự tạo mirror trung kế-trung kế nếu "Chuyển tiếp" vừa lưu trỏ sang 1
      // port trung kế THẬT khác đang trống (yêu cầu người dùng 2026-07-31,
      // sửa CÙNG LÚC với mục 38/39 thay vì đợi có ca báo riêng — cùng 1 lỗ
      // hổng: cơ chế này trước giờ chỉ chạy qua script dọn dữ liệu, chưa gắn
      // UI). Không chặn việc lưu dù bước này lỗi — chỉ báo cho người dùng.
      try {
        const trunkResult = await autoCreateTrunkTrunkMirrorForCircuit(circuitId);
        if (trunkResult.status === "occupied") {
          // Bước 3/6 (yêu cầu người dùng 2026-08-02) — bên vừa lưu là chuẩn:
          // tên khớp hệt -> tự liên kết ngay; khác tên -> xác nhận xóa bên
          // đang chiếm rồi tạo lại đúng theo bên vừa lưu. Đối xứng
          // autoMirrorAfterSave (DeviceCircuitList.tsx).
          if (trunkResult.occupantCircuitName.trim() === circuitFields.name.trim()) {
            const { error: linkErr } = await supabase
              .from("circuits")
              .update({ mirror_of_id: circuitId })
              .eq("id", trunkResult.occupantCircuitId);
            if (linkErr) setError(`Đã lưu "Chuyển tiếp", nhưng tự liên kết với luồng trung kế trùng tên thất bại: ${linkErr.message}`);
          } else {
            const ok = confirm(
              `Port ${trunkResult.rackCode} (${trunkResult.portNumbers.join(",")}) đang có luồng trung kế khác: "${
                trunkResult.occupantCircuitName
              }" — không trùng tên với luồng vừa lưu ("${circuitFields.name}").\n\nXÓA luồng trung kế đó và TẠO LẠI đúng theo luồng vừa lưu?`
            );
            if (ok) {
              try {
                const retry = await replaceOccupantAndCreateTrunkTrunkMirror(trunkResult.occupantCircuitId, circuitId);
                if (retry.status === "error") setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${retry.message}`);
              } catch (e) {
                setError(`Đã xóa luồng cũ, nhưng tạo lại thất bại: ${e instanceof Error ? e.message : String(e)}`);
              }
            }
          }
        } else if (trunkResult.status === "error") {
          setError(`Đã lưu "Chuyển tiếp", nhưng tự tạo mirror bên port đích thất bại: ${trunkResult.message}`);
        }
      } catch (e) {
        setError(`Đã lưu "Chuyển tiếp", nhưng tự tạo mirror bên port đích thất bại: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Tự đồng bộ TÊN sang luồng thiết bị ĐÃ liên kết — KHÔNG hỏi confirm()
      // nữa (yêu cầu người dùng 2026-08-02, bước 2/6: "chỉ đổi cách ghi/tên
      // thì tự đồng bộ luôn"). Vị trí ODF/Trib đổi SỐ THẬT đã bị CHẶN LƯU ở
      // đầu hàm, nên tới đây chỉ còn khả năng đổi TÊN (hoặc đổi cách ghi vị
      // trí/Trib mà số liệu vẫn khớp) là an toàn để tự đẩy sang, không cần
      // hỏi lại.
      const pairDetail = circuitPairDetails?.find((d) => d.trunkCircuitId === circuitId && d.isLinked);
      if (pairDetail) {
        const newTrunkName = circuitFields.name;
        if (newTrunkName.trim() !== pairDetail.deviceName.trim()) {
          const transitSplitNow = splitOdfDeviceStructure(transitText);
          try {
            await applySyncFromTrunk({
              ...pairDetail,
              trunkName: newTrunkName,
              trunkTransitOdfPart: transitSplitNow.matched ? transitSplitNow.odfPart ?? null : pairDetail.trunkTransitOdfPart,
              trunkTransitTrib: transitSplitNow.matched ? transitSplitNow.port ?? null : pairDetail.trunkTransitTrib,
              trunkTransitDevicePortText: transitSplitNow.matched
                ? transitSplitNow.devicePortText ?? null
                : pairDetail.trunkTransitDevicePortText,
            });
          } catch (e) {
            setError(`Đã lưu luồng, nhưng đồng bộ tên sang thiết bị thất bại: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      refreshAndThen(() => setEdit(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  // "Gỡ liên kết" (yêu cầu người dùng 2026-08-02, bước 1/6 của đề xuất nhất
  // quán liên kết) — chỉ set mirror_of_id = null, KHÔNG xóa/đổi dữ liệu nào
  // (xem lib/mirrorLinkStatus.ts). counterpartName chỉ để hiện rõ trong
  // confirm() (không truyền được thì vẫn gỡ được, chỉ hỏi chung chung hơn).
  async function unlinkMirror(circuitId: string, counterpartName: string | null) {
    const ok = confirm(
      `Gỡ liên kết với${counterpartName ? ` "${counterpartName}"` : " luồng đối phương"}? Dữ liệu 2 bên vẫn giữ nguyên, chỉ không còn được coi là cùng 1 luồng để đối chiếu/tự đồng bộ nữa.`
    );
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await unlinkCircuitMirror(circuitId);
      refreshAndThen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteGroup(group: Group) {
    const circuit = group.ports[0].circuit;
    if (!circuit) return;
    const linkedPorts = linkedPortsFor(ports, circuit.id);
    // "Chuyển tiếp" (transit_links, khóa theo source_port_id) là dữ liệu
    // RIÊNG của từng port, không tự động mất khi xóa circuit/port_circuit_links
    // (2 bảng khác nhau) — phải xóa TAY (người dùng phát hiện 2026-07-28: xóa
    // luồng xong port về trống nhưng "Chuyển tiếp" cũ vẫn còn, sai vì port đó
    // giờ không còn luồng nào để "chuyển tiếp" đi đâu nữa). Cùng cách
    // saveEdit() đã làm khi tách 1 port ra khỏi cặp (removedPortIds).
    const transitLinkIds = linkedPorts.map((p) => p.transitLinkId).filter((id): id is string => !!id);
    const transitNote = transitLinkIds.length > 0 ? " và dữ liệu Chuyển tiếp của các port đó" : "";
    if (
      !confirm(
        `Xóa luồng "${circuit.name}"? Sẽ giải phóng port ${linkedPorts.map((p) => p.portNumber).join(", ")} về trạng thái trống${transitNote}.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const portIds = linkedPorts.map((p) => p.id);
      const { error: linkErr } = await supabase.from("port_circuit_links").delete().eq("circuit_id", circuit.id);
      if (linkErr) throw linkErr;
      const { error: circuitErr } = await supabase.from("circuits").delete().eq("id", circuit.id);
      if (circuitErr) throw circuitErr;
      const { error: statusErr } = await supabase.from("ports").update({ status: "unused" }).in("id", portIds);
      if (statusErr) throw statusErr;
      if (transitLinkIds.length > 0) {
        const { error: transitErr } = await supabase.from("transit_links").delete().in("id", transitLinkIds);
        if (transitErr) throw transitErr;
      }
      // Xóa 1 luồng trung kế ĐANG LÀ mirror của 1 luồng thiết bị (mirrorOfId
      // có sẵn) giải phóng port nhưng luồng thiết bị vẫn còn nguyên dữ liệu
      // trỏ tới đúng vị trí đó — người dùng phát hiện 2026-08-02 (chủ động
      // xóa để thử, "chưa thấy gì": "rõ ràng sync được thì có thông tin và
      // trạng thái đã liên kết"): trước đây không có gì tự phục hồi, phải tự
      // vào lưu lại luồng thiết bị mới kích hoạt lại được tự-tạo-mirror. Giờ
      // gọi thẳng lại `autoCreateTrunkMirrorForCircuit` cho ĐÚNG luồng thiết
      // bị gốc ngay sau khi xóa — port vừa trống nên sẽ tự tạo lại thành công
      // (trừ khi dữ liệu thiết bị đã đổi sang trỏ nơi khác từ trước, khi đó
      // trả "no-gap", vô hại).
      if (circuit.mirrorOfId) {
        try {
          const recreated = await autoCreateTrunkMirrorForCircuit(circuit.mirrorOfId);
          if (recreated.status === "error") {
            setError(`Đã xóa luồng, nhưng tự tạo lại mirror cho luồng thiết bị gốc thất bại: ${recreated.message}`);
          } else if (recreated.status === "occupied") {
            setError(
              `Đã xóa luồng, nhưng vị trí ${recreated.rackCode} (${recreated.portNumbers.join(
                ","
              )}) lại đang có luồng khác ("${recreated.occupantCircuitName}") — vào lại luồng thiết bị gốc và Lưu để xử lý tiếp.`
            );
          }
        } catch (e) {
          setError(`Đã xóa luồng, nhưng tự tạo lại mirror cho luồng thiết bị gốc thất bại: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      refreshAndThen();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  function copyGroup(group: Group) {
    const c = group.ports[0].circuit;
    if (!c) return;
    const linkedPorts = linkedPortsFor(ports, c.id);
    const portNumbers = linkedPorts.map((p) => p.portNumber).join("-");
    setClipboard({
      sourcePortIds: linkedPorts.map((p) => p.id),
      label: `Port ${portNumbers}: ${c.name}`,
      name: c.name,
      interfaceType: c.interfaceType ?? "",
      counterpartText: c.counterpartText ?? "",
      responsePlanText: c.responsePlanText ?? "",
      executionStationText: c.executionStationText ?? "",
      notes: c.notes ?? "",
    });
  }

  // Giống isEditingGroup: group "chính" hiện form là group chứa port đầu
  // tiên trong sourcePortIds — group liên quan còn lại (không liền kề) chỉ
  // hiện ghi chú tham chiếu (xem moveInvolvesGroup).
  function isMovingGroup(group: Group): boolean {
    if (!move) return false;
    return group.ports.some((p) => p.id === move.sourcePortIds[0]);
  }

  function moveInvolvesGroup(group: Group): boolean {
    if (!move) return false;
    return group.ports.some((p) => move.sourcePortIds.includes(p.id));
  }

  async function openMove(group: Group) {
    const circuit = group.ports[0].circuit!;
    const linkedPorts = linkedPortsFor(ports, circuit.id);
    setEdit(null);
    setError(null);
    setMove({
      sourcePortIds: linkedPorts.map((p) => p.id),
      circuitId: circuit.id,
      circuitName: circuit.name,
      racks: [],
      targetRackId: null,
      targetPorts: [],
      targetPortsLoading: false,
      targetPortId: null,
      mergeEnabled: false,
      secondTargetPortNumber: "",
      secondTargetPortId: null,
      secondTargetPortError: null,
    });
    const { data, error: err } = await supabase
      .from("racks")
      .select("id, code, cable_route_name")
      .eq("domain", "trunk")
      .order("code", { ascending: true });
    if (err) {
      setError(err.message);
      return;
    }
    setMove((m) => (m ? { ...m, racks: (data ?? []) as MoveState["racks"] } : m));
  }

  async function selectTargetRack(targetRackId: string) {
    setMove((m) =>
      m
        ? {
            ...m,
            targetRackId,
            targetPorts: [],
            targetPortId: null,
            mergeEnabled: false,
            secondTargetPortNumber: "",
            secondTargetPortId: null,
            secondTargetPortError: null,
            targetPortsLoading: true,
          }
        : m
    );
    if (!targetRackId) return;
    const { data, error: err } = await supabase
      .from("ports")
      .select("id, port_number, status")
      .eq("rack_id", targetRackId)
      .order("port_number", { ascending: true });
    if (err) {
      setError(err.message);
      setMove((m) => (m ? { ...m, targetPortsLoading: false } : m));
      return;
    }
    setMove((m) => (m ? { ...m, targetPorts: (data ?? []) as MoveState["targetPorts"], targetPortsLoading: false } : m));
  }

  function selectTargetPort(targetPortId: string) {
    setMove((m) =>
      m ? { ...m, targetPortId: targetPortId || null, mergeEnabled: false, secondTargetPortNumber: "", secondTargetPortId: null, secondTargetPortError: null } : m
    );
  }

  function toggleMoveMerge(checked: boolean) {
    setMove((m) => {
      if (!m) return m;
      if (!checked) return { ...m, mergeEnabled: false };
      const { id, error: err } = resolveMoveTargetPort(m.targetPorts, m.secondTargetPortNumber, m.targetPortId);
      return { ...m, mergeEnabled: true, secondTargetPortId: id, secondTargetPortError: err };
    });
  }

  function changeMoveSecondPortNumber(text: string) {
    setMove((m) => {
      if (!m) return m;
      const { id, error: err } = resolveMoveTargetPort(m.targetPorts, text, m.targetPortId);
      return { ...m, secondTargetPortNumber: text, secondTargetPortId: id, secondTargetPortError: err };
    });
  }

  function cancelMove() {
    setMove(null);
    setError(null);
  }

  async function confirmMove() {
    if (!move || !move.targetPortId) return;
    if (move.mergeEnabled && move.secondTargetPortNumber.trim() && !move.secondTargetPortId) {
      setError(move.secondTargetPortError ?? "Port đích ghép cùng không hợp lệ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const destPortIds =
        move.mergeEnabled && move.secondTargetPortId ? [move.targetPortId, move.secondTargetPortId] : [move.targetPortId];

      const linkRows: { port_id: string; circuit_id: string; link_role: "tx" | "rx" | "single" }[] =
        destPortIds.length === 2
          ? [
              { port_id: destPortIds[0], circuit_id: move.circuitId, link_role: "tx" },
              { port_id: destPortIds[1], circuit_id: move.circuitId, link_role: "rx" },
            ]
          : [{ port_id: destPortIds[0], circuit_id: move.circuitId, link_role: "single" }];
      const { error: linkErr } = await supabase.from("port_circuit_links").insert(linkRows);
      if (linkErr) throw linkErr;
      const { error: statusErr } = await supabase.from("ports").update({ status: "in_use" }).in("id", destPortIds);
      if (statusErr) throw statusErr;

      // Theo đúng architecture.md mục 4.2: luôn hỏi xác nhận trước khi xóa
      // dữ liệu port nguồn. Không đồng ý -> cho phép luồng gán tạm cả 2 nơi
      // (đang chuyển đổi ứng cứu).
      const removeSource = confirm(
        `Đã gán luồng "${move.circuitName}" sang port mới. Xóa dữ liệu ở port nguồn (port ${move.sourcePortIds.length === 2 ? "cũ (2 sợi)" : "cũ"}) luôn không?\n\nChọn Hủy nếu muốn giữ tạm ở cả 2 nơi trong lúc chuyển đổi ứng cứu.`
      );
      if (removeSource) {
        const { error: delErr } = await supabase
          .from("port_circuit_links")
          .delete()
          .eq("circuit_id", move.circuitId)
          .in("port_id", move.sourcePortIds);
        if (delErr) throw delErr;
        const { error: srcStatusErr } = await supabase.from("ports").update({ status: "unused" }).in("id", move.sourcePortIds);
        if (srcStatusErr) throw srcStatusErr;
        // Cùng lý do đã sửa ở deleteGroup(): "Chuyển tiếp" của port NGUỒN
        // cũng phải xóa theo khi port đó thật sự được giải phóng, không tự
        // mất theo circuit/port_circuit_links.
        const sourceTransitLinkIds = move.sourcePortIds
          .map((id) => ports.find((p) => p.id === id)?.transitLinkId)
          .filter((id): id is string => !!id);
        if (sourceTransitLinkIds.length > 0) {
          const { error: transitErr } = await supabase.from("transit_links").delete().in("id", sourceTransitLinkIds);
          if (transitErr) throw transitErr;
        }
      }

      refreshAndThen(() => setMove(null));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {error && <div className="mb-3 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">Lỗi: {error}</div>}
      {clipboard && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <span>
            📋 Đang copy: <strong>{clipboard.label}</strong> — bấm &quot;Dán&quot; ở 1 port trống để dùng lại dữ liệu này.
          </span>
          <button className="text-amber-700 hover:underline" onClick={() => setClipboard(null)}>
            Hủy copy
          </button>
        </div>
      )}
      {Object.values(filters).some((v) => v) && (
        <div className="mb-2">
          <button
            type="button"
            className="text-xs text-primary-600 hover:underline"
            onClick={() =>
              setFilters({
                port: "",
                fiber: "",
                name: "",
                interface: "",
                transit: "",
                counterpart: "",
                responsePlan: "",
                station: "",
                notes: "",
              })
            }
          >
            Xóa bộ lọc
          </button>
        </div>
      )}
      {/* max-h + overflow-auto (không chỉ overflow-x-auto) là bắt buộc để
          sticky hoạt động — cùng lý do đã ghi ở DeviceCircuitList.tsx: nếu
          không giới hạn chiều cao, khung này không bao giờ tự cuộn (trang
          cuộn thay), khiến sticky vô tác dụng. */}
      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: 56 }} />
            <col style={{ width: 56 }} />
            <col style={{ width: colWidths.name }} />
            <col style={{ width: 90 }} />
            <col style={{ width: colWidths.transit }} />
            <col style={{ width: 170 }} />
            <col style={{ width: colWidths.responsePlan }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 200 }} />
          </colgroup>
          <thead className="text-primary-800">
            <tr>
              <Th label="Port" sortKey="port" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.port} onFilterChange={(v) => setFilter("port", v)} />
              <Th label="Sợi" sortKey="fiber" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.fiber} onFilterChange={(v) => setFilter("fiber", v)} />
              <Th
                label="Tên luồng"
                sortKey="name"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                width={colWidths.name}
                onResize={(w) => resizeCol("name", w)}
                filterValue={filters.name}
                onFilterChange={(v) => setFilter("name", v)}
              />
              <Th label="Giao tiếp" sortKey="interface" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.interface} onFilterChange={(v) => setFilter("interface", v)} />
              <Th
                label="Chuyển tiếp"
                width={colWidths.transit}
                onResize={(w) => resizeCol("transit", w)}
                filterValue={filters.transit}
                onFilterChange={(v) => setFilter("transit", v)}
              />
              <Th label="Đối phương" sortKey="counterpart" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.counterpart} onFilterChange={(v) => setFilter("counterpart", v)} />
              <Th
                label="PA ứng cứu"
                sortKey="responsePlan"
                activeKey={sortKey}
                dir={sortDir}
                onSort={toggleSort}
                width={colWidths.responsePlan}
                onResize={(w) => resizeCol("responsePlan", w)}
                filterValue={filters.responsePlan}
                onFilterChange={(v) => setFilter("responsePlan", v)}
              />
              <Th label="Trạm thực hiện" sortKey="station" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.station} onFilterChange={(v) => setFilter("station", v)} />
              <Th label="Ghi chú" sortKey="notes" activeKey={sortKey} dir={sortDir} onSort={toggleSort} filterValue={filters.notes} onFilterChange={(v) => setFilter("notes", v)} />
              <th className="sticky top-0 z-10 bg-primary-50 px-3 py-2 text-left align-top font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {sortedGroups.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-6 text-center text-slate-400">
                  Không tìm thấy port nào khớp bộ lọc.
                </td>
              </tr>
            )}
            {sortedGroups.map((group) => {
              const key = group.ports.map((p) => p.id).join("-");
              if (isEditingGroup(group) || (edit && edit.circuitId === null && edit.portIds[0] === group.ports[0].id)) {
                return (
                  <EditRow
                    key={key}
                    edit={edit!}
                    options={options}
                    trunkPorts={trunkPorts}
                    devices={devices}
                    deviceAliases={deviceAliases}
                    devicePositionMap={devicePositionMap}
                    circuitPairDetails={circuitPairDetails}
                    mirrorLinkStatuses={mirrorLinkStatuses}
                    onChange={setEdit}
                    onToggleMerge={toggleMerge}
                    onSecondPortNumberChange={changeSecondPortNumber}
                    onSave={saveEdit}
                    onCancel={cancelEdit}
                    onUnlink={unlinkMirror}
                    busy={busy}
                    colSpan={10}
                  />
                );
              }
              if (isMovingGroup(group)) {
                return (
                  <MoveRow
                    key={key}
                    move={move!}
                    onSelectRack={selectTargetRack}
                    onSelectPort={selectTargetPort}
                    onToggleMerge={toggleMoveMerge}
                    onSecondPortNumberChange={changeMoveSecondPortNumber}
                    onConfirm={confirmMove}
                    onCancel={cancelMove}
                    busy={busy}
                    colSpan={10}
                  />
                );
              }
              // Port kia của 1 cặp KHÔNG liền kề đang được sửa/di chuyển ở
              // 1 dòng khác (xem sessionPortIds/moveInvolvesGroup) — không
              // hiện nút thao tác ở đây để tránh bấm chồng chéo lên cùng 1
              // luồng từ 2 nơi khác nhau cùng lúc.
              if (editInvolvesGroup(group)) {
                const primaryPortNumber = ports.find((p) => p.id === edit!.portIds[0])?.portNumber;
                return group.ports.map((port) => (
                  <tr key={port.id} className="border-t border-slate-100 bg-primary-50/40 text-slate-400 italic">
                    <td className="px-3 py-2">{port.portNumber}</td>
                    <td className="px-3 py-2">{port.fiberNumber ?? "—"}</td>
                    <td className="px-3 py-2" colSpan={8}>
                      Đang được ghép/sửa cùng port {primaryPortNumber} ở dòng đang sửa.
                    </td>
                  </tr>
                ));
              }
              if (moveInvolvesGroup(group)) {
                const primaryPortNumber = ports.find((p) => p.id === move!.sourcePortIds[0])?.portNumber;
                return group.ports.map((port) => (
                  <tr key={port.id} className="border-t border-slate-100 bg-amber-50/40 text-slate-400 italic">
                    <td className="px-3 py-2">{port.portNumber}</td>
                    <td className="px-3 py-2">{port.fiberNumber ?? "—"}</td>
                    <td className="px-3 py-2" colSpan={8}>
                      Đang được chuyển tuyến cùng port {primaryPortNumber} ở dòng phía trên.
                    </td>
                  </tr>
                ));
              }
              const circuit = group.ports[0].circuit;
              // Cột "Chuyển tiếp" chỉ gộp (rowspan) khi CẢ 2 sợi của 1 cặp có
              // đúng cùng nội dung — khớp yêu cầu người dùng: sợi lẻ hoặc 2
              // sợi có nội dung khác nhau thì vẫn để riêng từng dòng.
              const transitMerged = group.ports.length === 2 && group.ports[0].transitText === group.ports[1].transitText;
              const isCopiedSource = !!clipboard && group.ports.some((p) => clipboard.sourcePortIds.includes(p.id));
              return group.ports.map((port, idx) => (
                <tr
                  key={port.id}
                  id={`port-${port.id}`}
                  // scroll-mt-24: bù chiều cao tiêu đề cột STICKY (~86px) khi
                  // scrollIntoView() nhảy tới port này (link từ khung cảnh
                  // báo "Chuyển tiếp chưa chuẩn form") — thiếu dòng này thì
                  // port ở gần đầu danh sách (không đủ dòng phía trên để
                  // scrollIntoView căn giữa) sẽ bị cuộn lên NGAY DƯỚI tiêu
                  // đề, nhưng tiêu đề sticky lại NẰM ĐÈ LÊN che mất, khiến
                  // dòng port ĐẦU TIÊN nhìn thấy được lại là port kế tiếp chứ
                  // không phải port vừa bấm (người dùng phát hiện 2026-07-28,
                  // đã từng gặp lỗi cùng loại bên DeviceCircuitList.tsx).
                  className={`scroll-mt-24 border-t border-slate-100 hover:bg-primary-50/30 ${isCopiedSource ? "bg-amber-50/70" : ""} ${highlightPortId === port.id ? "bg-amber-100" : ""}`}
                >
                  <td className="px-3 py-2 text-slate-700">{port.portNumber}</td>
                  <td className="px-3 py-2 text-slate-700">{port.fiberNumber ?? "—"}</td>
                  {idx === 0 && (
                    <td className="px-3 py-2 font-medium text-slate-800 break-words" rowSpan={group.ports.length}>
                      {circuit ? (
                        <>
                          {circuit.name}
                          <MirrorLinkBadge status={mirrorLinkStatuses?.[circuit.id]} />
                        </>
                      ) : (
                        <span className="text-slate-300">— trống —</span>
                      )}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2 text-slate-600" rowSpan={group.ports.length}>
                      {circuit?.interfaceType ?? ""}
                    </td>
                  )}
                  {transitMerged ? (
                    idx === 0 && (
                      <td className="px-3 py-2 text-slate-600 whitespace-pre-line break-words" rowSpan={2}>
                        {transitDisplayByPortId.get(group.ports[0].id) ?? ""}
                      </td>
                    )
                  ) : (
                    <td className="px-3 py-2 text-slate-600 whitespace-pre-line break-words">
                      {transitDisplayByPortId.get(port.id) ?? ""}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2 text-slate-600 whitespace-pre-line break-words" rowSpan={group.ports.length}>
                      {circuit?.counterpartText ?? ""}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2 text-slate-600 whitespace-pre-line break-words" rowSpan={group.ports.length}>
                      {circuit?.responsePlanText ?? ""}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2 text-slate-600" rowSpan={group.ports.length}>
                      {circuit?.executionStationText ?? ""}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2 text-slate-600 whitespace-pre-line break-words" rowSpan={group.ports.length}>
                      {circuit?.notes ?? ""}
                    </td>
                  )}
                  {idx === 0 && (
                    <td className="px-3 py-2" rowSpan={group.ports.length}>
                      <div className="flex flex-wrap gap-2">
                        {circuit ? (
                          <>
                            <button className="text-primary-600 hover:underline" onClick={() => openEditExisting(group)} disabled={busy}>
                              Sửa
                            </button>
                            <button className="text-red-600 hover:underline" onClick={() => deleteGroup(group)} disabled={busy}>
                              Xóa
                            </button>
                            <button className="text-slate-500 hover:underline" onClick={() => copyGroup(group)} disabled={busy}>
                              Copy
                            </button>
                            <button className="text-amber-600 hover:underline" onClick={() => openMove(group)} disabled={busy}>
                              Chuyển tuyến
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="text-primary-600 hover:underline" onClick={() => openCreateNew(port)} disabled={busy}>
                              {port.transitText ? "Sửa" : "Thêm luồng"}
                            </button>
                            {clipboard && (
                              <button className="text-slate-500 hover:underline" onClick={() => openCreateNew(port, clipboard)} disabled={busy}>
                                Dán
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRow({
  edit,
  options,
  trunkPorts,
  devices,
  deviceAliases,
  devicePositionMap,
  circuitPairDetails,
  mirrorLinkStatuses,
  onChange,
  onToggleMerge,
  onSecondPortNumberChange,
  onSave,
  onCancel,
  onUnlink,
  busy,
  colSpan,
}: {
  edit: EditState;
  options: CircuitOptions;
  trunkPorts: TrunkPortRow[];
  devices: DeviceRow[];
  deviceAliases: DeviceAliasRow[];
  devicePositionMap: DevicePositionMapRow[];
  circuitPairDetails?: CircuitPairDetail[];
  mirrorLinkStatuses?: Record<string, MirrorLinkStatus>;
  onChange: (e: EditState) => void;
  onToggleMerge: (checked: boolean) => void;
  onSecondPortNumberChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onUnlink: (circuitId: string, counterpartName: string | null) => void;
  busy: boolean;
  colSpan: number;
}) {
  // Nút "Kiểm tra đồng bộ với hồ sơ đấu nối" (yêu cầu người dùng 2026-08-02,
  // "kiểm tra 01 luồng" ngay tại chỗ đang sửa) — chỉ có ý nghĩa với luồng ĐÃ
  // lưu (edit.circuitId != null) và tìm được đúng 1 cặp thiết bị-trung kế
  // tương ứng trong circuitPairDetails (đã tính sẵn ở trang cha, xem
  // lib/circuitPairSync.ts) — không tìm được thì KHÔNG hiện nút (vd luồng
  // này không có đối phương thiết bị nào, như trung kế-trung kế thuần túy).
  const [showSyncCheck, setShowSyncCheck] = useState(false);
  const pairDetail = useMemo(
    () => circuitPairDetails?.find((d) => d.trunkCircuitId === edit.circuitId) ?? null,
    [circuitPairDetails, edit.circuitId]
  );

  // Cấu trúc 2 (yêu cầu người dùng 2026-07-27): nếu "Chuyển tiếp" khớp mẫu
  // "<ODF> - <thiết bị>(<port>)" lúc MỞ sửa, tách hiện 2 ô riêng cho dễ sửa.
  // Chỉ tính 1 LẦN lúc EditRow mount (mount lại mỗi khi đổi dòng đang sửa nhờ
  // key={ports...} ở nơi gọi <EditRow>) — không tính lại mỗi lần gõ, để 2 ô
  // không tự nhiên biến mất giữa chừng nếu gõ dở làm chuỗi tạm thời không
  // khớp mẫu nữa.
  const [transitSplit] = useState(() => splitOdfDeviceStructure(edit.transitText).matched);
  const [transitOdfPart, setTransitOdfPart] = useState(() => splitOdfDeviceStructure(edit.transitText).odfPart ?? "");
  // Ô "Thiết bị (port)" tách làm 2 ô riêng (yêu cầu người dùng 2026-07-29,
  // cùng tinh thần ô "Vị trí ODF" ở trên) — deviceName/port đã được
  // splitOdfDeviceStructure() tách SẴN thành 2 field riêng (không cần tự tách
  // lại), chỉ là trước đây UI ghép chúng về 1 ô input duy nhất.
  const [transitDeviceName, setTransitDeviceName] = useState(() => splitOdfDeviceStructure(edit.transitText).deviceName ?? "");
  const [transitDevicePort, setTransitDevicePort] = useState(() => splitOdfDeviceStructure(edit.transitText).port ?? "");

  function buildTransitText(odf: string, deviceName: string, devicePort: string) {
    return `${odf} - ${deviceName} (${devicePort})`;
  }

  // Gợi ý chuẩn hóa "Vị trí ODF" NGAY khi đang gõ (yêu cầu người dùng
  // 2026-07-28: bấm áp dụng cho nhanh, đỡ phải gõ lại) — cùng phép tính
  // matchTrunkPosition/formatCanonicalOdfPosition đã dùng ở onBlur bên dưới,
  // chỉ khác là hiện SẴN thành gợi ý bấm được thay vì phải rời khỏi ô mới
  // thấy. null nếu đã đúng chuẩn hoặc chưa khớp được rack/port thật nào (khi
  // đó không có gì chắc chắn để gợi ý).
  const odfSuggestion = useMemo(() => {
    const trimmed = transitOdfPart.trim();
    if (!trimmed) return null;
    const trunkMatch = matchTrunkPosition(trimmed, trunkPorts);
    const canonical = formatCanonicalOdfPosition(trunkMatch);
    return canonical && canonical !== trimmed ? canonical : null;
  }, [transitOdfPart, trunkPorts]);

  function applyOdfSuggestion() {
    if (!odfSuggestion) return;
    setTransitOdfPart(odfSuggestion);
    onChange({ ...edit, transitText: buildTransitText(odfSuggestion, transitDeviceName, transitDevicePort) });
  }

  // Gợi ý cho trường hợp CHƯA tách được cấu trúc 2 (transitSplit=false) —
  // người dùng phát hiện 2026-07-29: "Chuyển tiếp" đôi khi CHỈ là 1 tọa độ
  // ODF trơn trỏ THẲNG sang 1 rack trung kế khác, không qua thiết bị nào
  // (vd "ODF 2/11 (15,16)" — không có " - <thiết bị>(<port>)" nên
  // splitOdfDeviceStructure() không khớp được, rơi vào ô input trơn không
  // gợi ý gì, dù đây vẫn là 1 tọa độ ODF thật đối chiếu/chuẩn hóa được y hệt
  // cấu trúc 2). Thử chuẩn hóa trên TOÀN BỘ chuỗi hiện có — nếu là free text
  // thật (không match được rack/port nào) thì matchTrunkPosition tự trả
  // không khớp, không gợi ý gì, an toàn.
  // An toàn dữ liệu (phát hiện khi rà thật 2026-07-29 — QUAN TRỌNG, xem
  // architecture.md) — rào chặn "nuốt nhầm số từ đuôi free text lạ" giờ nằm
  // trong matchBareTrunkLink() (lib/trunkPorts.ts, dùng chung với
  // lib/transitLinks.ts) thay vì lặp lại ở đây.
  const bareMatch = useMemo(() => {
    if (transitSplit) return null; // nhánh cấu trúc 2 đã có gợi ý riêng ở trên
    return matchBareTrunkLink(edit.transitText, trunkPorts);
  }, [transitSplit, edit.transitText, trunkPorts]);

  const bareOdfSuggestion = useMemo(() => {
    if (!bareMatch) return null;
    const trimmed = edit.transitText.trim();
    const canonical = formatCanonicalOdfPosition(bareMatch);
    return canonical && canonical !== trimmed ? canonical : null;
  }, [bareMatch, edit.transitText]);

  function applyBareOdfSuggestion() {
    if (!bareOdfSuggestion) return;
    onChange({ ...edit, transitText: bareOdfSuggestion });
  }

  // Nhận diện "Chuyển tiếp" là 1 tọa độ ODF trơn trỏ THẲNG sang 1 rack TRUNG
  // KẾ khác, không qua thiết bị nào (người dùng phát hiện 2026-07-29, vd
  // "ODF 2/11 (15,16)") — cùng bareMatch (đã qua an toàn "<=2 port" ở trên)
  // nhưng chỉ đúng dạng này khi rackDomain==='trunk' VÀ có cable_route_name
  // để hiện (rack domain='device' không có ý nghĩa gì ở field đó). Hiện thêm
  // 1 ô CHỈ ĐỌC ngay dưới ô ODF — đúng ý người dùng: "ô còn lại... là tên ODF
  // Trung kế, bên thiết bị thì là tên thiết bị kèm port" — cùng tinh thần Ô2
  // "Cáp quang (tiếp theo)" đã làm ở DeviceCircuitList.tsx (isCableMode).
  const bareTrunkCableRouteName = bareMatch && bareMatch.rackDomain === "trunk" ? bareMatch.cableRouteName : null;

  // Slide-over "xem nhanh" (yêu cầu người dùng 2026-07-29, "Giai đoạn 2") —
  // xem port trung kế đích / thiết bị đối phương mà KHÔNG rời rack đang sửa.
  // Port đích lấy thẳng từ `trunkPorts` (đã tải sẵn TOÀN BỘ port + luồng
  // hiện tại của mọi rack cho trang này) — không cần fetch thêm gì.
  const [quickView, setQuickView] = useState<"trunk" | "device" | null>(null);
  const bareMatchedTrunkPorts = useMemo(() => {
    if (!bareMatch || bareMatch.rackDomain !== "trunk" || !bareMatch.resolvedPorts) return [];
    const portNumbers = new Set(bareMatch.resolvedPorts.map((p) => p.portNumber));
    return trunkPorts.filter((p) => p.rackCode === bareMatch.rackCode && portNumbers.has(p.portNumber));
  }, [bareMatch, trunkPorts]);

  // Ô "Thiết bị" (tách từ cấu trúc 2, yêu cầu người dùng 2026-07-29) — check
  // "đã có trong hồ sơ thiết bị (devices) chưa", CÙNG kiểu UX với ô Vị trí
  // ODF ở trên (so khớp với dữ liệu THẬT, gợi ý đúng tên chuẩn đang lưu nếu
  // khác biệt hoa/thường hoặc tiền tố trạm). normalizeDeviceNameKey() tự bỏ
  // tiền tố "ADN1."/dấu/khoảng trắng thừa nên so khớp được dù gõ khác kiểu
  // (xem lib/deviceNotes.ts).
  const deviceNameTrimmed = transitDeviceName.trim();
  // Cấp 1+2 (khớp chính xác sau chuẩn hóa, rồi tới alias đã xác nhận từ
  // trước — xem lib/deviceAliases.ts) — thay cho tìm trực tiếp qua
  // normalizeDeviceNameKey() như trước, để 1 alias đã lưu tự nhận ra ngay,
  // không hỏi lại nữa (yêu cầu người dùng 2026-08-01, architecture.md mục 43).
  const matchedDevice = useMemo(() => {
    return resolveDeviceByExactOrAlias(deviceNameTrimmed, devices, deviceAliases);
  }, [deviceNameTrimmed, devices, deviceAliases]);
  const deviceNameSuggestion = matchedDevice && matchedDevice.name !== deviceNameTrimmed ? matchedDevice.name : null;

  function applyDeviceNameSuggestion() {
    if (!deviceNameSuggestion) return;
    setTransitDeviceName(deviceNameSuggestion);
    onChange({ ...edit, transitText: buildTransitText(transitOdfPart, deviceNameSuggestion, transitDevicePort) });
  }

  // "Chưa có trong hồ sơ -> sẽ hỏi tạo mới khi Lưu" — CHỈ báo cho thiết bị
  // ADN1 (đúng CLAUDE.md #6 + cơ chế maybeStandardizeTransitDevice() có sẵn
  // ở component cha: chỉ ADN1 mới tự tạo devices, trạm khác luôn giữ text tự
  // do, không tạo gì). Tách mã trạm bằng đúng ký tự lớp mà TRANSIT_PATTERN
  // dùng (lib/parsers/transit-text.ts) — không cần cả "(port)" phía sau như
  // parseTransitText() để hỏi được ngay cả khi ô Port đang để trống.
  const deviceStationCode = deviceNameTrimmed.match(/^([^.\s(]+)\./)?.[1] ?? null;
  const isAdn1Device = deviceStationCode ? isManagedStationCode(deviceStationCode) : false;
  const showWillCreateDeviceHint = !!deviceNameTrimmed && !matchedDevice && isAdn1Device;

  // Cấp 3 — chưa khớp chính xác/alias, thử gợi ý "có thể trùng thiết bị đã
  // có" bằng so khớp lỏng (yêu cầu người dùng 2026-08-01, architecture.md mục
  // 43) — CHỈ hiện khi lẽ ra sẽ báo "chưa có" (showWillCreateDeviceHint), và
  // chỉ khi ra ĐÚNG 1 ứng viên (không tự đoán khi mơ hồ).
  const looseDeviceCandidate = useMemo(() => {
    if (!showWillCreateDeviceHint) return null;
    return findLooseDeviceCandidate(deviceNameTrimmed, devices);
  }, [showWillCreateDeviceHint, deviceNameTrimmed, devices]);

  async function applyLooseDeviceCandidate() {
    if (!looseDeviceCandidate) return;
    const typedName = deviceNameTrimmed;
    setTransitDeviceName(looseDeviceCandidate.name);
    onChange({ ...edit, transitText: buildTransitText(transitOdfPart, looseDeviceCandidate.name, transitDevicePort) });
    try {
      await saveDeviceAlias(looseDeviceCandidate.id, typedName);
    } catch {
      // Không chặn UI nếu lưu alias lỗi — tên thiết bị đã áp dụng đúng rồi,
      // chỉ là lần gõ SAU sẽ phải gợi ý lại (không mất dữ liệu luồng).
    }
  }

  // Ô "Port" (thiết bị) — KHÔNG tự đoán/chuẩn hóa định dạng (dữ liệu thật có
  // nhiều kiểu viết khác nhau cùng tồn tại cho 1 thiết bị: "1-23-10",
  // "1/23/10", "S23/10"...), chỉ liệt kê mẫu ĐÃ DÙNG THẬT cho đúng thiết bị
  // này (yêu cầu người dùng 2026-07-29) để người dùng tự chọn/soi theo, không
  // tự bịa 1 kiểu chuẩn hóa mới có thể sai với quy ước riêng của thiết bị đó.
  const devicePortSamples = useMemo(
    () => distinctPositionsForDevice(transitDeviceName, devicePositionMap),
    [transitDeviceName, devicePositionMap]
  );

  return (
    <tr className="border-t border-primary-200 bg-primary-50/60">
      <td colSpan={colSpan} className="px-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Tên luồng">
            {/* textarea (không phải input) để kéo to/nhỏ được như ô Ghi chú
                — tên luồng thực tế có thể rất dài (yêu cầu người dùng
                2026-07-27: ô nhỏ quá, phải cuộn ngang mới xem/sửa hết được). */}
            <textarea
              className="input resize-y"
              rows={1}
              placeholder="VD: 100GE ADN1.P2 (1/0/3) - 2T9.P1(4/0/3)"
              value={edit.name}
              onChange={(e) => onChange({ ...edit, name: e.target.value })}
              autoFocus
            />
          </Field>
          <Field label="Giao tiếp">
            <input
              className="input"
              list="port-table-interface-options"
              value={edit.interfaceType}
              onChange={(e) => onChange({ ...edit, interfaceType: e.target.value })}
              placeholder="Chọn hoặc gõ mới..."
            />
            <datalist id="port-table-interface-options">
              {options.interfaceTypes.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label="Chuyển tiếp">
            {transitSplit ? (
              // Cấu trúc 2 — 2 ô riêng (ODF + thiết bị/port) cho dễ sửa, ghép
              // lại thành 1 chuỗi transitText khi gõ (lưu/hiển thị không đổi).
              <div className="flex flex-col gap-1">
                <input
                  className="input"
                  placeholder="Vị trí ODF, vd: ODF7/4/17,18"
                  value={transitOdfPart}
                  onChange={(e) => {
                    setTransitOdfPart(e.target.value);
                    onChange({ ...edit, transitText: buildTransitText(e.target.value, transitDeviceName, transitDevicePort) });
                  }}
                  onBlur={() => {
                    // Chuẩn hóa lại "ODF x/y (a,b)" (yêu cầu người dùng
                    // 2026-07-27) — cùng cơ chế đã dùng cho ô "Vị trí ODF
                    // (tiếp theo)" bên luồng thiết bị, xem
                    // formatCanonicalOdfPosition() trong lib/trunkPorts.ts.
                    const trunkMatch = matchTrunkPosition(transitOdfPart, trunkPorts);
                    const canonical = formatCanonicalOdfPosition(trunkMatch);
                    if (canonical && canonical !== transitOdfPart) {
                      setTransitOdfPart(canonical);
                      onChange({ ...edit, transitText: buildTransitText(canonical, transitDeviceName, transitDevicePort) });
                    }
                  }}
                />
                {odfSuggestion && (
                  <button
                    type="button"
                    className="self-start rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                    onClick={applyOdfSuggestion}
                    title="Bấm để thay bằng đúng chuẩn form"
                  >
                    💡 Gợi ý: {odfSuggestion} — bấm để áp dụng
                  </button>
                )}
                {/* Ô Thiết bị + ô Port tách riêng (yêu cầu người dùng
                    2026-07-29) — trước đây gộp 1 ô "Thiết bị (port)". */}
                <input
                  className="input"
                  list="port-table-transit-device-options"
                  placeholder="Thiết bị, vd: ADN1.PE2"
                  value={transitDeviceName}
                  onChange={(e) => {
                    setTransitDeviceName(e.target.value);
                    onChange({ ...edit, transitText: buildTransitText(transitOdfPart, e.target.value, transitDevicePort) });
                  }}
                  onBlur={() => {
                    // Tự chuẩn hóa về đúng tên thật đang lưu trong devices
                    // (nếu khớp được — cùng cơ chế/mức an toàn với ô ODF ở
                    // trên, vì đều đối chiếu với dữ liệu THẬT trong DB).
                    if (deviceNameSuggestion) applyDeviceNameSuggestion();
                  }}
                />
                <datalist id="port-table-transit-device-options">
                  {devices.map((d) => (
                    <option key={d.id} value={d.name} />
                  ))}
                </datalist>
                {deviceNameSuggestion && (
                  <button
                    type="button"
                    className="self-start rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                    onClick={applyDeviceNameSuggestion}
                    title="Bấm để thay bằng đúng tên đang lưu trong hồ sơ thiết bị"
                  >
                    💡 Gợi ý: {deviceNameSuggestion} — bấm để áp dụng
                  </button>
                )}
                {showWillCreateDeviceHint && looseDeviceCandidate && (
                  <button
                    type="button"
                    className="self-start rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                    onClick={applyLooseDeviceCandidate}
                    title="Bấm nếu đúng là thiết bị này — ghi nhớ cách gõ để lần sau tự nhận ra, không hỏi lại"
                  >
                    💡 Có thể là thiết bị đã có: {looseDeviceCandidate.name} — bấm để dùng thiết bị này
                  </button>
                )}
                {showWillCreateDeviceHint && (
                  <p className="text-xs text-amber-600">
                    {looseDeviceCandidate
                      ? "Nếu không đúng thiết bị gợi ý trên, sẽ hỏi tạo mới khi bấm Lưu."
                      : "Chưa có trong hồ sơ thiết bị — sẽ hỏi tạo mới khi bấm Lưu."}
                  </p>
                )}
                {matchedDevice && (
                  <button
                    type="button"
                    className="self-start text-xs text-primary-600 hover:underline"
                    onClick={() => setQuickView("device")}
                  >
                    Xem nhanh thiết bị này →
                  </button>
                )}
                <input
                  className="input"
                  list="port-table-transit-device-port-options"
                  placeholder="Port của thiết bị, vd: et-13/0/0"
                  value={transitDevicePort}
                  onChange={(e) => {
                    setTransitDevicePort(e.target.value);
                    onChange({ ...edit, transitText: buildTransitText(transitOdfPart, transitDeviceName, e.target.value) });
                  }}
                />
                <datalist id="port-table-transit-device-port-options">
                  {devicePortSamples.map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
                {devicePortSamples.length > 0 && (
                  <p className="text-xs text-slate-400">
                    Mẫu port đã dùng cho thiết bị này: {devicePortSamples.slice(0, 6).join(", ")}
                    {devicePortSamples.length > 6 ? "..." : ""}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <input
                  className="input"
                  list="port-table-transit-options"
                  value={edit.transitText}
                  onChange={(e) => onChange({ ...edit, transitText: e.target.value })}
                  onBlur={() => {
                    // Cùng cơ chế chuẩn hóa lúc rời ô như nhánh cấu trúc 2 —
                    // dùng LẠI bareOdfSuggestion (đã qua an toàn "<=2 port" ở
                    // bareMatch phía trên) thay vì tự tính lại không kiểm —
                    // tính lại không kiểm sẽ tự động ÁP LUÔN gợi ý sai (nuốt
                    // nhầm số từ phần đuôi free text) ngay khi rời ô, còn
                    // nguy hiểm hơn nút gợi ý (phải bấm mới áp).
                    if (bareOdfSuggestion) {
                      onChange({ ...edit, transitText: bareOdfSuggestion });
                    }
                  }}
                  placeholder="Chọn hoặc gõ vị trí ODF mới..."
                />
                {bareOdfSuggestion && (
                  <button
                    type="button"
                    className="self-start rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-100"
                    onClick={applyBareOdfSuggestion}
                    title="Bấm để thay bằng đúng chuẩn form"
                  >
                    💡 Gợi ý: {bareOdfSuggestion} — bấm để áp dụng
                  </button>
                )}
                {bareTrunkCableRouteName && (
                  <>
                    <div className="mt-1 text-[11px] text-slate-400">
                      Tên ODF trung kế (tự nhận diện — nối thẳng, không qua thiết bị)
                    </div>
                    <div className="input flex items-center bg-slate-100 text-slate-500">{bareTrunkCableRouteName}</div>
                    <button
                      type="button"
                      className="self-start text-xs text-primary-600 hover:underline"
                      onClick={() => setQuickView("trunk")}
                    >
                      Xem nhanh port đích →
                    </button>
                  </>
                )}
              </div>
            )}
            <datalist id="port-table-transit-options">
              {options.transitTexts.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </Field>
          <Field label="Đối phương">
            <textarea
              className="input resize-y"
              rows={2}
              placeholder="VD: 2T9.PE1 (0/0/1)"
              value={edit.counterpartText}
              onChange={(e) => onChange({ ...edit, counterpartText: e.target.value })}
            />
          </Field>
          <Field label="Phương án ứng cứu">
            <textarea
              className="input"
              rows={2}
              value={edit.responsePlanText}
              onChange={(e) => onChange({ ...edit, responsePlanText: e.target.value })}
            />
          </Field>
          <Field label="Trạm thực hiện">
            <input
              className="input"
              value={edit.executionStationText}
              onChange={(e) => onChange({ ...edit, executionStationText: e.target.value })}
              placeholder="Gõ tự do hoặc bấm chọn bên dưới..."
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {options.executionStations.map((s) => {
                const selected = edit.executionStationText
                  .split(/[,;]/)
                  .map((t) => t.trim().toLowerCase())
                  .includes(s.toLowerCase());
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({ ...edit, executionStationText: toggleStationToken(edit.executionStationText, s) })}
                    className={`rounded px-2 py-0.5 text-xs border ${
                      selected ? "bg-primary-600 text-white border-primary-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Ghi chú">
            <textarea className="input" rows={2} value={edit.notes} onChange={(e) => onChange({ ...edit, notes: e.target.value })} />
          </Field>

          <div className="sm:col-span-2 rounded-md border border-slate-200 bg-white p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={edit.mergeEnabled} onChange={(e) => onToggleMerge(e.target.checked)} />
              Ghép với port khác (dùng 2 sợi Tx/Rx cho cùng 1 luồng — liền kề hoặc không liền kề đều được)
            </label>
            {edit.mergeEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-slate-500">Port ghép cùng:</span>
                <input
                  className="input w-24"
                  value={edit.secondPortNumber}
                  onChange={(e) => onSecondPortNumberChange(e.target.value)}
                  placeholder="Số port"
                />
                <span className="text-xs text-slate-400">(đổi số port ở đây rồi Lưu để tự chuyển dữ liệu sang port mới)</span>
                {edit.secondPortError && <span className="text-xs text-red-600">{edit.secondPortError}</span>}
              </div>
            )}
          </div>
        </div>

        {pairDetail && (
          <div className="mt-3">
            <button type="button" className="text-xs text-primary-600 hover:underline" onClick={() => setShowSyncCheck((v) => !v)}>
              {showSyncCheck ? "▲ Ẩn" : "🔎 Kiểm tra đồng bộ với hồ sơ đấu nối"}
            </button>
            {showSyncCheck && (
              <div className="mt-1">
                <CircuitPairSyncPanel detail={pairDetail} onApplied={() => setShowSyncCheck(false)} />
              </div>
            )}
          </div>
        )}
        {/* "Gỡ liên kết" (yêu cầu người dùng 2026-08-02) — dựa trên
            mirrorLinkStatuses (KHÔNG chỉ pairDetail) vì cũng phải hiện được
            cho mirror trung kế-trung kế, loại pairDetail (device-trunk) không
            phủ tới. */}
        {edit.circuitId && mirrorLinkStatuses?.[edit.circuitId] === "linked" && (
          <div className="mt-2">
            <button
              type="button"
              className="text-xs text-slate-500 hover:text-red-600 hover:underline"
              disabled={busy}
              onClick={() => onUnlink(edit.circuitId!, pairDetail?.deviceName ?? null)}
              title="Tách liên kết mirror_of_id — không xóa dữ liệu bên nào, chỉ không còn tự đồng bộ nữa. Dùng khi cần đổi luồng này sang 1 đấu nối khác."
            >
              🔓 Gỡ liên kết
            </button>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn-primary" onClick={onSave} disabled={busy}>
            {busy ? "Đang cập nhật..." : "Lưu"}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
        </div>
      </td>

      {/* Chỉ render khi thật sự có thể mở (yêu cầu người dùng 2026-07-29) —
          tránh mỗi dòng đang sửa đều âm thầm gắn thêm 2 <aside> vào DOM dù
          không liên quan gì (bareMatch/matchedDevice không khớp thì never
          mở được panel này), gây rối khi có nhiều dòng debug/test DOM. */}
      {bareTrunkCableRouteName && (
      <SlideOverPanel open={quickView === "trunk"} onClose={() => setQuickView(null)} title={`${bareMatch?.rackCode ?? ""} — xem nhanh`}>
        <div className="space-y-3">
          {bareMatchedTrunkPorts.map((p) => (
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
          {bareMatchedTrunkPorts.length === 0 && <p className="text-sm text-slate-400">Không tìm thấy port thật khớp.</p>}
          {bareMatchedTrunkPorts[0] && (
            <Link
              href={`/odf-trunk/${bareMatchedTrunkPorts[0].rackId}#port-${bareMatchedTrunkPorts[0].portId}`}
              className="text-sm text-primary-600 hover:underline"
            >
              Mở đầy đủ rack {bareMatch?.rackCode} →
            </Link>
          )}
        </div>
      </SlideOverPanel>
      )}

      {matchedDevice && (
      <SlideOverPanel open={quickView === "device"} onClose={() => setQuickView(null)} title={matchedDevice.name}>
        <div className="space-y-2 text-sm">
          <p>
            <span className="text-slate-500">Lĩnh vực:</span> {deviceCategoryLabel(matchedDevice.category)}
          </p>
          <p>
            <span className="text-slate-500">Nguồn:</span> {matchedDevice.source === "manual" ? "Nhập tay" : "Tự sinh"}
          </p>
          <p>
            <span className="text-slate-500">Cập nhật lần cuối:</span> {formatLastUpdated(matchedDevice.updatedAt)}
          </p>
          <Link href="/odf-device/sua-luong" className="text-primary-600 hover:underline">
            Mở &quot;Hồ sơ đấu nối&quot; →
          </Link>
        </div>
      </SlideOverPanel>
      )}
    </tr>
  );
}

function MoveRow({
  move,
  onSelectRack,
  onSelectPort,
  onToggleMerge,
  onSecondPortNumberChange,
  onConfirm,
  onCancel,
  busy,
  colSpan,
}: {
  move: MoveState;
  onSelectRack: (rackId: string) => void;
  onSelectPort: (portId: string) => void;
  onToggleMerge: (checked: boolean) => void;
  onSecondPortNumberChange: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
  colSpan: number;
}) {
  const unusedPorts = move.targetPorts.filter((p) => p.status === "unused");

  return (
    <tr className="border-t border-amber-300 bg-amber-50/60">
      <td colSpan={colSpan} className="px-4 py-4">
        <p className="text-sm text-slate-700 mb-3">
          Chuyển luồng <span className="font-medium">&quot;{move.circuitName}&quot;</span> sang port khác (các trường khác của luồng giữ
          nguyên, chỉ đổi port gắn):
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Rack đích">
            <select className="input" value={move.targetRackId ?? ""} onChange={(e) => onSelectRack(e.target.value)}>
              <option value="">— Chọn rack —</option>
              {move.racks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.cable_route_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Port đích (đang trống)">
            <select
              className="input"
              value={move.targetPortId ?? ""}
              disabled={!move.targetRackId || move.targetPortsLoading}
              onChange={(e) => onSelectPort(e.target.value)}
            >
              <option value="">{move.targetPortsLoading ? "Đang tải..." : unusedPorts.length === 0 ? "Rack này hết port trống" : "— Chọn port —"}</option>
              {unusedPorts.map((p) => (
                <option key={p.id} value={p.id}>
                  Port {p.port_number}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {move.targetPortId && (
          <div className="mt-3 rounded-md border border-amber-200 bg-white p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={move.mergeEnabled} onChange={(e) => onToggleMerge(e.target.checked)} />
              Ghép thêm 1 port đích nữa (dùng 2 sợi Tx/Rx — liền kề hoặc không liền kề đều được)
            </label>
            {move.mergeEnabled && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-sm text-slate-500">Port đích ghép cùng:</span>
                <input
                  className="input w-24"
                  value={move.secondTargetPortNumber}
                  onChange={(e) => onSecondPortNumberChange(e.target.value)}
                  placeholder="Số port"
                />
                {move.secondTargetPortError && <span className="text-xs text-red-600">{move.secondTargetPortError}</span>}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn-primary" onClick={onConfirm} disabled={busy || !move.targetPortId}>
            {busy ? "Đang cập nhật..." : "Xác nhận chuyển"}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>
            Hủy
          </button>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="block text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
