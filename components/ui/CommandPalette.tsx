"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { fetchAllTrunkPorts, type TrunkPortRow } from "@/lib/trunkPorts";
import { fetchDevices, deviceCategoryLabel, type DeviceRow } from "@/lib/devices";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";
import { derivePortStatus, type DerivedPortStatus } from "@/lib/portStatus";
import { matchesFilter } from "@/lib/tableFilter";
import { normalizeVN } from "@/lib/text";
import { compareRackCode } from "@/lib/rackCode";
import { supabase } from "@/lib/supabase";

// Nút "🔍" ở Sidebar.tsx bắn sự kiện này để mở palette — dùng CustomEvent
// thay vì lift state lên app/layout.tsx, vì layout.tsx là Server Component
// (không giữ được state); biến nó thành "use client" chỉ để truyền 1 hàm mở
// palette giữa 2 Client Component anh em (Sidebar/CommandPalette) là đổi cấu
// trúc lớn hơn mức cần thiết cho việc này.
export const COMMAND_PALETTE_OPEN_EVENT = "hskt:open-command-palette";

const MAX_RESULTS = 30;

type ResultKind = "circuit" | "rack" | "port" | "device" | "device-circuit";

interface PaletteResult {
  kind: ResultKind;
  key: string;
  title: string;
  subtitle: string;
  status?: DerivedPortStatus;
  score: number;
  href: string;
}

interface RackGroup {
  rackId: string;
  rackCode: string;
  cableRouteName: string | null;
}
interface CircuitGroup {
  circuitId: string;
  name: string;
  counterpartText: string | null;
  rackId: string;
  rackCode: string;
  firstPortId: string;
  portNumbers: number[];
  fiberNumbers: number[];
  status: DerivedPortStatus;
}
interface EmptyPortGroup {
  portId: string;
  rackId: string;
  rackCode: string;
  portNumber: number;
  fiberNumber: number | null;
}

const KIND_LABEL: Record<ResultKind, string> = {
  circuit: "Luồng",
  rack: "Rack",
  port: "Port",
  device: "Thiết bị",
  "device-circuit": "Luồng thiết bị",
};

const STATUS_BADGE: Record<DerivedPortStatus, { label: string; className: string }> = {
  empty: { label: "Trống", className: "bg-slate-100 text-slate-500" },
  in_use: { label: "Đang dùng", className: "bg-primary-100 text-primary-700" },
  standby: { label: "Dự phòng", className: "bg-amber-100 text-amber-700" },
};

// So khớp 1 giá trị với query, trả về "độ ưu tiên" (thấp hơn = khớp tốt hơn):
// 0 = trùng khớp chính xác (đã chuẩn hóa), 1 = bắt đầu bằng query, 2 = chỉ
// chứa query ở đâu đó. null = không khớp (dùng matchesFilter có sẵn để
// quyết định CÓ khớp hay không, tự thêm lớp xếp hạng bên trên).
function fieldScore(value: string | number | null | undefined, query: string): number | null {
  if (!matchesFilter(value ?? null, query)) return null;
  const v = normalizeVN(String(value ?? ""));
  const q = normalizeVN(query.trim());
  if (v === q) return 0;
  if (v.startsWith(q)) return 1;
  return 2;
}
function bestScore(values: (string | number | null | undefined)[], query: string): number | null {
  let best: number | null = null;
  for (const value of values) {
    const s = fieldScore(value, query);
    if (s !== null && (best === null || s < best)) best = s;
  }
  return best;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [ports, setPorts] = useState<TrunkPortRow[] | null>(null);
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [deviceCircuits, setDeviceCircuits] = useState<DeviceCircuitRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadedOnceRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Mở: Cmd/Ctrl+K (toàn app) hoặc nút "🔍" ở Sidebar (custom event). Đóng:
  // Esc — nghe cả ở đây (khi input đang có focus, trường hợp thường gặp
  // nhất) LẪN ở window (phòng khi focus lỡ rời khỏi input) để chắc ăn.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "Escape") setOpen(false);
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, onOpenEvent);
    };
  }, []);

  // Nạp dữ liệu LƯỜI — chỉ khi palette mở LẦN ĐẦU trong phiên (yêu cầu:
  // không fetch lúc tải trang), cache lại trong state cho các lần mở sau
  // (chấp nhận có thể cũ nếu vừa sửa dữ liệu ở tab/trang khác — v1 chưa làm
  // nút "làm mới", xem ghi chú ở JSX bên dưới).
  useEffect(() => {
    if (!open || loadedOnceRef.current) return;
    loadedOnceRef.current = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([fetchAllTrunkPorts(supabase), fetchDevices(supabase), fetchDeviceCircuits(supabase)])
      .then(([p, d, dc]) => {
        setPorts(p);
        setDevices(d);
        setDeviceCircuits(dc);
      })
      .catch((e) => {
        loadedOnceRef.current = false; // cho phép thử lại lần mở kế tiếp nếu lỗi (vd mất mạng lúc đó)
        setLoadError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setLoading(false));
  }, [open]);

  // Focus vào ô input mỗi lần mở; dọn lại query/lựa chọn khi đóng.
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    setQuery("");
    setActiveIndex(0);
  }, [open]);

  // Gom NGUYÊN 1 lần thành 3 tập gọn (rack / luồng / port trống) — chỉ tính
  // lại khi `ports` đổi (đúng 1 lần sau khi nạp xong), KHÔNG tính lại mỗi lần
  // gõ phím, để việc lọc theo query ở dưới luôn nhẹ dù `ports` có hàng nghìn
  // dòng thô.
  const grouped = useMemo(() => {
    if (!ports) return null;
    const racks = new Map<string, RackGroup>();
    const circuits = new Map<string, CircuitGroup>();
    const emptyPorts: EmptyPortGroup[] = [];

    for (const p of ports) {
      if (!racks.has(p.rackId)) racks.set(p.rackId, { rackId: p.rackId, rackCode: p.rackCode, cableRouteName: p.cableRouteName });

      if (p.circuit) {
        const existing = circuits.get(p.circuit.id);
        if (existing) {
          existing.portNumbers.push(p.portNumber);
          if (p.fiberNumber != null) existing.fiberNumbers.push(p.fiberNumber);
        } else {
          circuits.set(p.circuit.id, {
            circuitId: p.circuit.id,
            name: p.circuit.name,
            counterpartText: p.circuit.counterpartText,
            rackId: p.rackId,
            rackCode: p.rackCode,
            firstPortId: p.portId,
            portNumbers: [p.portNumber],
            fiberNumbers: p.fiberNumber != null ? [p.fiberNumber] : [],
            status: derivePortStatus(p.circuit),
          });
        }
      } else {
        emptyPorts.push({ portId: p.portId, rackId: p.rackId, rackCode: p.rackCode, portNumber: p.portNumber, fiberNumber: p.fiberNumber });
      }
    }

    return {
      racks: [...racks.values()].sort((a, b) => compareRackCode(a.rackCode, b.rackCode)),
      circuits: [...circuits.values()],
      emptyPorts,
    };
  }, [ports]);

  // Khớp + xếp hạng — tính lại mỗi lần gõ, nhưng chỉ lặp qua các tập ĐÃ GOM
  // GỌN ở trên (vài trăm rack/luồng), không lặp lại toàn bộ dữ liệu thô.
  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim();
    if (!q || !grouped) return [];
    const out: PaletteResult[] = [];

    for (const r of grouped.racks) {
      const score = bestScore([r.rackCode, r.cableRouteName], q);
      if (score === null) continue;
      out.push({
        kind: "rack",
        key: `rack-${r.rackId}`,
        title: r.rackCode,
        subtitle: r.cableRouteName ?? "ODF trung kế",
        score,
        href: `/odf-trunk/${r.rackId}`,
      });
    }

    for (const c of grouped.circuits) {
      const score = bestScore([c.name, c.counterpartText, c.rackCode, ...c.portNumbers, ...c.fiberNumbers], q);
      if (score === null) continue;
      out.push({
        kind: "circuit",
        key: `circuit-${c.circuitId}`,
        title: c.name,
        subtitle: `${c.rackCode} · port ${c.portNumbers.join(",")}${c.counterpartText ? " · " + c.counterpartText : ""}`,
        status: c.status,
        score,
        // Neo #port-<id> tái dùng đúng cơ chế cuộn-tới-port đã có sẵn ở
        // PortTable.tsx (applyHash effect đọc "#port-<id>").
        href: `/odf-trunk/${c.rackId}#port-${c.firstPortId}`,
      });
    }

    for (const p of grouped.emptyPorts) {
      const score = bestScore([p.rackCode, p.portNumber, p.fiberNumber], q);
      if (score === null) continue;
      out.push({
        kind: "port",
        key: `port-${p.portId}`,
        title: `${p.rackCode} · port ${p.portNumber}`,
        subtitle: "Port trống",
        status: "empty",
        score,
        href: `/odf-trunk/${p.rackId}#port-${p.portId}`,
      });
    }

    // Thiết bị: chưa có cơ chế neo-tới-đúng-dòng ở /devices (khảo sát
    // DeviceCategoryClient.tsx không có id/anchor theo dòng, khác
    // DeviceCircuitList.tsx đã có rowAnchor) — điều hướng tới đúng TRANG
    // "Danh mục thiết bị", chưa cuộn tới đúng dòng. Ghi chú lại để làm sau
    // nếu cần (ngoài phạm vi bản v1 này).
    for (const d of devices ?? []) {
      const score = bestScore([d.name], q);
      if (score === null) continue;
      out.push({
        kind: "device",
        key: `device-${d.id}`,
        title: d.name,
        subtitle: deviceCategoryLabel(d.category),
        score,
        href: "/devices",
      });
    }

    // Luồng thiết bị (Hồ sơ đấu nối) — thêm 2026-08-08, người dùng phát hiện
    // "Xem tất cả kết quả tìm kiếm" chỉ ra ODF trung kế, thiếu hẳn domain
    // này. Neo #dc-<id> tái dùng rowAnchor() đã có sẵn (DeviceCircuitList.tsx
    // đọc hash này để cuộn/tô sáng đúng dòng).
    for (const c of deviceCircuits ?? []) {
      const score = bestScore([c.name, c.deviceName, c.tribText, c.devicePositionOwn, c.devicePositionNext, c.counterpartText], q);
      if (score === null) continue;
      out.push({
        kind: "device-circuit",
        key: `device-circuit-${c.id}`,
        title: c.name,
        subtitle: [c.deviceName, c.devicePositionOwn, c.counterpartText].filter(Boolean).join(" · ") || "Hồ sơ đấu nối",
        score,
        href: `/odf-device/sua-luong#${rowAnchor(c.id)}`,
      });
    }

    out.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
    return out.slice(0, MAX_RESULTS);
  }, [query, grouped, devices, deviceCircuits]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length, query]);

  function select(r: PaletteResult) {
    router.push(r.href);
    setOpen(false);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[activeIndex];
      if (r) select(r);
    }
    // Escape đã xử lý ở listener window (phía trên) — không cần lặp lại đây.
  }

  // document chỉ tồn tại ở trình duyệt — tránh gọi createPortal lúc SSR/lần
  // render đầu trước khi hydrate (cùng lý do như SlideOverPanel.tsx).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] bg-slate-900/40" onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="fixed left-1/2 top-24 z-[60] w-full max-w-xl -translate-x-1/2 px-4">
        <div
          className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="Tìm kiếm nhanh"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <span className="text-slate-400" aria-hidden="true">
              🔍
            </span>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Gõ tên luồng / mã rack / port / thiết bị..."
              className="w-full border-none py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="command-palette-listbox"
              aria-activedescendant={results[activeIndex]?.key}
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-400">Esc</kbd>
          </div>

          <div id="command-palette-listbox" role="listbox" className="max-h-96 overflow-y-auto py-1">
            {loading && <p className="px-3 py-4 text-sm text-slate-400">Đang tải dữ liệu tra cứu…</p>}
            {!loading && loadError && <p className="px-3 py-4 text-sm text-red-500">Lỗi tải dữ liệu: {loadError}</p>}
            {!loading && !loadError && query.trim() === "" && (
              <p className="px-3 py-4 text-sm text-slate-400">Gõ tên luồng, mã rack, port hoặc tên thiết bị để tìm.</p>
            )}
            {!loading && !loadError && query.trim() !== "" && results.length === 0 && (
              <p className="px-3 py-4 text-sm text-slate-400">Không tìm thấy kết quả nào khớp &quot;{query}&quot;.</p>
            )}
            {results.map((r, i) => (
              <div
                key={r.key}
                id={r.key}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => select(r)}
                className={
                  "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm " +
                  (i === activeIndex ? "bg-primary-50" : "hover:bg-slate-50")
                }
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-800">{r.title}</span>
                  <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {r.status && (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[r.status].className}`}>
                      {STATUS_BADGE[r.status].label}
                    </span>
                  )}
                  <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500">{KIND_LABEL[r.kind]}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Thay chỗ mục "Tìm kiếm nhanh" vừa bỏ khỏi Sidebar (Đợt 4 audit
              mục 3.3, 2026-08-07) — trang /search vẫn còn, chỉ chuyển đường
              vào đây, kèm bộ lọc theo cột mà kết quả rút gọn ở trên không có. */}
          <div className="border-t border-slate-200 px-3 py-2">
            <Link
              href="/search"
              onClick={() => setOpen(false)}
              className="text-xs text-primary-600 hover:underline"
            >
              Xem tất cả kết quả tìm kiếm (bộ lọc đầy đủ) →
            </Link>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
