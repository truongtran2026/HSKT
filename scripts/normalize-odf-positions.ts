// Chuẩn hóa lại các ô "Vị trí ODF" đã LƯU TỪ TRƯỚC theo đúng form "ODF x/y
// (a,b)" — phát hiện thực tế 2026-07-28: circuit test
// "ADN1.ASBR#2-MX2020 (7/0/3)" vẫn lưu "ODF3/6/(39,40)" / "ODF 11/5/(13,14)"
// dù rack "ODF 3/6"/"ODF 11/5" đã có thật trong hệ thống từ 2026-07-27 (xem
// scripts/import-internal-odf-racks.ts) — vì việc tự chuẩn hóa CHỈ chạy khi
// người dùng gõ+rời khỏi ô (onBlur), KHÔNG tự chạy lại cho dữ liệu cũ chỉ
// xem/không sửa. Script này rà 1 LẦN toàn bộ dữ liệu cũ để bắt kịp.
//
// Quét lại 3 nơi lưu "Vị trí ODF" dạng text tự do:
//   - circuits.device_position_own       (luôn CHỈ là tọa độ ODF trơn)
//   - circuits.device_position_next      (có thể ghép "ODF... - Thiết bị
//     (trib)" — dùng splitOdfDeviceStructure tách đúng phần ODF trước khi
//     chuẩn hóa, giữ nguyên phần thiết bị/trib nếu có, rồi ghép lại bằng
//     combinePositionNext — không đụng gì tới thiết bị/trib đã lưu)
//   - device_position_map.odf_position   (thư viện tra cứu)
//
// Dùng ĐÚNG thuật toán matchTrunkPosition/formatCanonicalOdfPosition đang
// chạy live ở onBlur (copy nguyên văn tại đây — lib/trunkPorts.ts import
// "@/lib/supabase" đọc process.env NGAY lúc import module, không dùng được
// trong script chạy qua tsx vì .env.local chỉ nạp được SAU khi import đã
// chạy xong, xem lib/supabase.ts). Sửa thuật toán ở bản gốc thì nhớ sửa lại
// y hệt ở đây. Nhờ dùng chung thuật toán, script CHỈ sửa đúng những gì UI sẽ
// tự sửa nếu người dùng gõ lại + rời ô hôm nay — không có rủi ro sai khác.
//
// Chạy:
//   npm run normalize-odf-positions              -> DRY RUN, chỉ đếm + in.
//   npm run normalize-odf-positions -- --commit   -> ghi thật.

import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { splitOdfDeviceStructure, combinePositionNext } from "../lib/parsers/transit-text";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

interface PortRow {
  portNumber: number;
  rackCode: string;
}

interface TrunkPositionMatch {
  matched: boolean;
  rackCode?: string;
  resolvedPorts?: { portNumber: number }[];
  invalidPortNumbers?: number[];
}

// --- Copy nguyên văn matchTrunkPosition + formatCanonicalOdfPosition từ
// lib/trunkPorts.ts (lược bớt các field script này không cần như fiberNumber/
// cableRouteName/circuit — không ảnh hưởng logic khớp/chuẩn hóa). ---
function matchTrunkPosition(text: string, ports: PortRow[]): TrunkPositionMatch {
  const normalized = text.replace(/\s+/g, "").toUpperCase();
  if (!normalized) return { matched: false };
  const rackCodes = [...new Set(ports.map((p) => p.rackCode))].sort((a, b) => b.length - a.length);
  for (const rackCode of rackCodes) {
    const normalizedCode = rackCode.replace(/\s+/g, "").toUpperCase();
    if (!normalized.startsWith(normalizedCode)) continue;
    const remainder = normalized.slice(normalizedCode.length);
    // Giữ Y HỆT bản gốc lib/trunkPorts.ts (chặn khớp sai kiểu "ODF1/16" bị
    // "ODF1/1" nuốt nhầm số "6" — xem comment đầy đủ ở bản gốc).
    if (/\d$/.test(normalizedCode) && /^\d/.test(remainder)) continue;
    const requestedPortNumbers = [...remainder.matchAll(/\d+/g)].map((m) => parseInt(m[0], 10));
    const portsInRack = ports.filter((p) => p.rackCode === rackCode);
    if (requestedPortNumbers.length === 0) return { matched: true, rackCode };
    const resolvedPorts: { portNumber: number }[] = [];
    const invalidPortNumbers: number[] = [];
    for (const n of requestedPortNumbers) {
      const found = portsInRack.find((p) => p.portNumber === n);
      if (found) resolvedPorts.push({ portNumber: n });
      else invalidPortNumbers.push(n);
    }
    return { matched: true, rackCode, resolvedPorts, invalidPortNumbers };
  }
  return { matched: false };
}

function formatCanonicalOdfPosition(m: TrunkPositionMatch): string | null {
  if (!m.matched || !m.rackCode) return null;
  if (m.invalidPortNumbers && m.invalidPortNumbers.length > 0) return null;
  const ports = m.resolvedPorts ?? [];
  if (ports.length === 0) return null;
  const portText =
    ports.length === 1 ? String(ports[0].portNumber) : ports.map((p) => String(p.portNumber).padStart(2, "0")).join(",");
  const spacedRackCode = m.rackCode.replace(/^ODF(?!\s)/, "ODF ");
  return `${spacedRackCode} (${portText})`;
}

// Chuẩn hóa 1 ô ODF trơn (device_position_own, odf_position). null nếu
// không đổi gì (không khớp rack, hoặc khớp nhưng đã đúng chuẩn sẵn).
function normalizePlainOdf(raw: string | null, ports: PortRow[]): string | null {
  if (!raw) return null;
  const canonical = formatCanonicalOdfPosition(matchTrunkPosition(raw, ports));
  return canonical && canonical !== raw ? canonical : null;
}

// Chuẩn hóa device_position_next — có thể là "ODF... - Thiết bị (trib)" ghép
// (splitOdfDeviceStructure tách ra) hoặc chỉ ODF trơn như trên.
function normalizePositionNext(raw: string | null, ports: PortRow[]): string | null {
  if (!raw) return null;
  const split = splitOdfDeviceStructure(raw);
  if (split.matched && split.deviceName && split.port) {
    const canonicalOdf = formatCanonicalOdfPosition(matchTrunkPosition(split.odfPart ?? "", ports));
    if (!canonicalOdf) return null;
    const rebuilt = combinePositionNext(canonicalOdf, split.deviceName, split.port);
    return rebuilt !== raw ? rebuilt : null;
  }
  return normalizePlainOdf(raw, ports);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  async function fetchAllPaginated<T>(table: string, select: string): Promise<T[]> {
    const pageSize = 1000;
    const all: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from(table).select(select).range(from, from + pageSize - 1).order("id");
      if (error) throw error;
      const page = (data ?? []) as T[];
      all.push(...page);
      if (page.length < pageSize) break;
    }
    return all;
  }

  const rawPorts = await fetchAllPaginated<{ port_number: number; racks: { code: string } | { code: string }[] | null }>(
    "ports",
    "port_number, racks!inner ( code )"
  );
  const ports: PortRow[] = rawPorts.map((p) => {
    const rack = Array.isArray(p.racks) ? p.racks[0] : p.racks;
    return { portNumber: p.port_number, rackCode: rack!.code };
  });
  console.log(`[normalize-odf-positions] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log(`[normalize-odf-positions] Tổng port dùng để đối chiếu: ${ports.length}`);

  // --- circuits.device_position_own / device_position_next ---
  const circuits = await fetchAllPaginated<{ id: string; device_position_own: string | null; device_position_next: string | null }>(
    "circuits",
    "id, device_position_own, device_position_next"
  );
  const circuitUpdates: { id: string; own?: string; next?: string; beforeOwn?: string; beforeNext?: string }[] = [];
  for (const c of circuits) {
    const newOwn = normalizePlainOdf(c.device_position_own, ports);
    const newNext = normalizePositionNext(c.device_position_next, ports);
    if (newOwn || newNext) {
      circuitUpdates.push({
        id: c.id,
        own: newOwn ?? undefined,
        next: newNext ?? undefined,
        beforeOwn: newOwn ? c.device_position_own! : undefined,
        beforeNext: newNext ? c.device_position_next! : undefined,
      });
    }
  }

  console.log(`\n[normalize-odf-positions] circuits cần sửa: ${circuitUpdates.length}/${circuits.length}`);
  for (const u of circuitUpdates) {
    if (u.own) console.log(`  - own:  "${u.beforeOwn}" -> "${u.own}"`);
    if (u.next) console.log(`  - next: "${u.beforeNext}" -> "${u.next}"`);
  }

  // --- device_position_map.odf_position ---
  const dpmRows = await fetchAllPaginated<{ id: string; odf_position: string | null }>("device_position_map", "id, odf_position");
  const dpmUpdates: { id: string; odfPosition: string; before: string }[] = [];
  for (const r of dpmRows) {
    const canonical = normalizePlainOdf(r.odf_position, ports);
    if (canonical) dpmUpdates.push({ id: r.id, odfPosition: canonical, before: r.odf_position! });
  }

  console.log(`\n[normalize-odf-positions] device_position_map cần sửa: ${dpmUpdates.length}/${dpmRows.length}`);
  for (const u of dpmUpdates) console.log(`  - "${u.before}" -> "${u.odfPosition}"`);

  if (!COMMIT) {
    console.log(`\n[normalize-odf-positions] DRY RUN — chưa ghi gì. Chạy: npm run normalize-odf-positions -- --commit`);
    return;
  }

  for (const u of circuitUpdates) {
    const payload: Record<string, string> = {};
    if (u.own) payload.device_position_own = u.own;
    if (u.next) payload.device_position_next = u.next;
    const { error } = await db.from("circuits").update(payload).eq("id", u.id);
    if (error) throw error;
  }
  for (const u of dpmUpdates) {
    const { error } = await db.from("device_position_map").update({ odf_position: u.odfPosition }).eq("id", u.id);
    if (error) throw error;
  }
  console.log(`\n[normalize-odf-positions] Đã sửa ${circuitUpdates.length} circuits + ${dpmUpdates.length} device_position_map.`);
}

main().catch((err) => {
  console.error("[normalize-odf-positions] Lỗi:", err);
  process.exit(1);
});
