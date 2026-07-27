// Di chuyển dữ liệu "Đối phương" (circuits.counterpart_text) thực ra là
// thiết bị LOCAL ADN1 sang cấu trúc 3-ô mới "Vị trí ODF (tiếp theo)"
// (circuits.device_position_next) — yêu cầu người dùng 2026-07-27.
//
// Bối cảnh: khảo sát thật 1923 dòng "Đối phương" khác rỗng cho thấy 1153
// dòng (60%) thực ra ghi thiết bị THUỘC ADN1 (chủ yếu gõ "AĐN1." dấu Đ,
// xem lib/parsers/transit-text.ts), không phải đối phương ở trạm khác — ô
// Đối phương đúng ra CHỈ dành cho thiết bị ở site khác ADN1.
//
// QUAN TRỌNG — circuits.counterpart_text/device_position_next là cột DÙNG
// CHUNG cho cả luồng trung kế (PortTable.tsx) lẫn luồng thiết bị (xem
// lib/deviceCircuits.ts). Script CHỈ xét "luồng thiết bị" (chưa gán
// port_circuit_links nào — cùng tiêu chí fetchDeviceCircuits()), tuyệt đối
// không đụng luồng trung kế. Ban đầu khảo sát tưởng có thêm 426 dòng "chỉ có
// tọa độ ODF trơn, không thiết bị" cũng cần xử lý — nhưng sau khi lọc đúng
// phạm vi domain, cả 426 dòng đó đều là luồng TRUNG KẾ (không phải thiết bị),
// nên KHÔNG thuộc phạm vi script này (giữ code xử lý dạng này lại phòng khi
// sau này có dữ liệu thiết bị thật dạng đó, nhưng thực tế hiện = 0 dòng).
//
// QUAN TRỌNG — phát hiện khi khảo sát thật (2026-07-27): rất nhiều dòng (1080)
// vừa khớp "ADN1.thiết bị(trib)" ở Đối phương, VỪA đã có sẵn
// device_position_next khác rỗng — nhưng kiểm tra thật cho thấy device_
// position_next hiện có TRONG MỌI TRƯỜNG HỢP (1080/1080) chỉ là tọa độ ODF
// TRƠN (không có cấu trúc "ODF - thiết bị(port)"). Đây KHÔNG phải xung đột
// thật — đây là 2 NỬA BỔ SUNG cho nhau (tọa độ ODF ghi ở 1 cột Excel gốc,
// thiết bị+port ghi ở cột Đối phương khác) nên phải GHÉP LẠI thành 1 dòng đủ
// 3 phần, không phải bỏ qua.
//
// Với MỖI dòng khớp 1 trong 2 dạng trên, quy tắc Ô1 (Vị trí ODF) theo thứ tự
// ưu tiên:
//   (a) Dạng "ADN1.thiết bị(trib)":
//       - Nếu device_position_next ĐÃ có sẵn (luôn chỉ là ODF trơn, xem trên)
//         -> dùng THẲNG giá trị đó làm Ô1 (đáng tin hơn tra thư viện, vì là
//         dữ liệu ghi riêng cho đúng dòng này).
//       - Nếu device_position_next đang trống -> tra thư viện
//         device_position_map theo (thiết bị, trib) để suy ra Ô1 nếu ĐÃ CÓ;
//         chưa có thì để trống Ô1 — combinePositionNext() tự xử lý gộp đúng
//         (chỉ còn "thiết bị (trib)", không có "ODF -" phía trước).
//       - Trường hợp cực hiếm device_position_next ĐÃ có cấu trúc đủ 3 phần
//         từ trước (splitOdfDeviceStructure khớp) -> đây mới thật sự là xung
//         đột cần xem tay, không tự động ghép.
//   (b) Dạng chỉ có tọa độ ODF trơn, không thiết bị: nếu device_position_next
//       ĐANG TRỐNG thì chép nguyên văn vào Ô1, để trống Ô2/Ô3; nếu đã có sẵn
//       giá trị khác rỗng thì KHÔNG rõ cái nào đúng hơn (2 tọa độ ODF trơn,
//       không có gì để ghép bổ sung) -> để xem tay, không tự đoán.
// Ghi kết quả gộp vào device_position_next, ĐỒNG THỜI xóa counterpart_text
// (set null) để khỏi trùng lặp dữ liệu — đúng yêu cầu người dùng bước 3.
//
// KHÔNG xử lý (giữ nguyên "Đối phương", không đụng gì):
//   - "AĐN2.xxx" (7 dòng) — người dùng đang tự xem lại, chưa xác nhận đây là
//     lỗi gõ của ADN1 hay trạm/thực thể khác thật.
//   - Trạm/thực thể khác thật (2T9, VNPT Data, HHI, VMS, Phước Mỹ, Đài
//     Phát...).
//   - Text không khớp dạng nào ở trên (ghi chú tự do, tọa độ lỗi định dạng
//     ngoặc lồng nhau kiểu "AĐN1.MRSE3C (MSE1/24/2 (C))"...).
//   - 2 trường hợp xung đột thật ở trên (hiếm) — liệt kê riêng để người dùng
//     tự xem, KHÔNG tự động ghi đè.
//
// Thiết bị nhận diện được nhưng CHƯA có trong `devices` -> KHÔNG tự tạo
// (đúng quy ước script hàng loạt đã dùng ở standardize-transit-links.ts),
// chỉ liệt kê cuối script để tự duyệt tay.
//
// Chạy:
//   npm run migrate-counterpart-to-position-next              -> DRY RUN.
//   npm run migrate-counterpart-to-position-next -- --commit   -> ghi thật.

import * as fs from "node:fs";
import * as path from "node:path";
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "../lib/deviceNotes";
import { parseTransitText, isManagedStationCode, combinePositionNext, splitOdfDeviceStructure } from "../lib/parsers/transit-text";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

interface RawCircuitRow {
  id: string;
  counterpart_text: string | null;
  device_position_next: string | null;
  port_circuit_links: { id: string }[] | null;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local.");
  const db = createClient(supabaseUrl, key);

  const pageSize = 1000;

  // QUAN TRỌNG: circuits.counterpart_text/device_position_next là cột DÙNG
  // CHUNG cho cả luồng trung kế (PortTable.tsx — "Đối phương" ở đó có ý nghĩa
  // khác, KHÔNG được đụng vào) lẫn luồng thiết bị. Phải lọc đúng "luồng thiết
  // bị" bằng CÙNG tiêu chí với lib/deviceCircuits.ts fetchDeviceCircuits():
  // chưa gán port_circuit_links nào cả (luồng trung kế luôn có, luồng thiết
  // bị thì không) — nếu bỏ qua bước lọc này sẽ vô tình sửa/xóa dữ liệu
  // "Đối phương" của luồng TRUNG KẾ, hoàn toàn ngoài phạm vi yêu cầu.
  console.log(`[migrate-counterpart-to-position-next] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);

  const rawCircuits: RawCircuitRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("circuits")
      .select("id, counterpart_text, device_position_next, port_circuit_links(id)")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rawCircuits.push(...((data ?? []) as unknown as RawCircuitRow[]));
    if (!data || data.length < pageSize) break;
  }
  const circuits = rawCircuits.filter((r) => !r.port_circuit_links || r.port_circuit_links.length === 0);
  console.log(
    `[migrate-counterpart-to-position-next] Tổng circuits: ${rawCircuits.length} (luồng trung kế loại ra: ${rawCircuits.length - circuits.length}, luồng thiết bị xét tới: ${circuits.length})`
  );

  const deviceRows: { name: string }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from("devices").select("name").order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw error;
    deviceRows.push(...((data ?? []) as { name: string }[]));
    if (!data || data.length < pageSize) break;
  }

  const mapRows: { device_name: string; device_position: string | null; odf_position: string | null }[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from("device_position_map")
      .select("device_name, device_position, odf_position")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    mapRows.push(...((data ?? []) as typeof mapRows));
    if (!data || data.length < pageSize) break;
  }

  const canonicalByKey = new Map<string, string>();
  for (const d of deviceRows) canonicalByKey.set(normalizeDeviceNameKey(d.name), d.name);

  // Tra (device, trib) -> odf đã biết, tải 1 lần vào Map thay vì re-query DB
  // cho từng dòng circuits (khác growDevicePositionMapByTrib — hợp lý cho UI
  // gọi ít lần, nhưng ở đây cần tra hàng nghìn dòng nên tải sẵn 1 lần).
  const positionLookup = new Map<string, string>();
  for (const m of mapRows) {
    if (!m.odf_position) continue;
    const k = `${normalizeDeviceNameKey(m.device_name)}::${normalizeDevicePositionKey(m.device_position ?? "")}`;
    if (!positionLookup.has(k)) positionLookup.set(k, m.odf_position);
  }

  let migratedWithDevice = 0;
  let migratedOdfOnly = 0;
  let mergedFromExistingNext = 0;
  let foundOdfViaLibrary = 0;
  let skippedNotRelevant = 0;
  const conflictRows: { id: string; counterpart: string; existingNext: string; reason: string }[] = [];
  const unknownDevices = new Map<string, { trib: string; count: number }>();
  // Gom trước, ghi sau (backup toàn bộ giá trị CŨ ra file trước khi update
  // thật — counterpart_text sẽ bị xóa nên cần có đường lùi nếu phát hiện sai
  // sau này, giống quy ước scripts/dedupe-device-position-map.ts).
  const pendingUpdates: { id: string; oldCounterpartText: string | null; oldDevicePositionNext: string | null; newDevicePositionNext: string }[] =
    [];

  for (const c of circuits) {
    const counterpart = (c.counterpart_text ?? "").trim();
    if (!counterpart) continue;

    const parsed = parseTransitText(counterpart);
    const isAdn1Device = !!(
      parsed.matched &&
      parsed.stationCode &&
      isManagedStationCode(parsed.stationCode) &&
      parsed.deviceName &&
      parsed.coordinateText
    );
    const isBareOdf = !parsed.matched && /^ODF/i.test(counterpart);

    if (!isAdn1Device && !isBareOdf) {
      skippedNotRelevant++;
      continue;
    }

    const existingNext = (c.device_position_next ?? "").trim();
    let combined: string;

    if (isAdn1Device) {
      const deviceName = parsed.deviceName!.trim();
      const trib = parsed.coordinateText!.trim();
      let odf: string;

      if (existingNext) {
        const existingSplit = splitOdfDeviceStructure(existingNext);
        if (existingSplit.matched) {
          // Cực hiếm — existingNext ĐÃ có cấu trúc đủ 3 phần, xung đột thật.
          conflictRows.push({ id: c.id, counterpart, existingNext, reason: "next đã có cấu trúc đủ" });
          continue;
        }
        // existingNext chỉ là tọa độ ODF trơn — ghép làm Ô1, đáng tin hơn tra
        // thư viện vì là dữ liệu ghi riêng cho đúng dòng này.
        odf = existingNext;
        mergedFromExistingNext++;
      } else {
        odf = positionLookup.get(`${normalizeDeviceNameKey(deviceName)}::${normalizeDevicePositionKey(trib)}`) ?? "";
        if (odf) foundOdfViaLibrary++;
      }

      combined = combinePositionNext(odf, deviceName, trib);

      const canonicalName = canonicalByKey.get(normalizeDeviceNameKey(deviceName));
      if (!canonicalName) {
        const uKey = normalizeDeviceNameKey(deviceName) || deviceName;
        const existing = unknownDevices.get(uKey);
        if (existing) existing.count++;
        else unknownDevices.set(uKey, { trib, count: 1 });
      }
      migratedWithDevice++;
    } else {
      // isBareOdf: Đối phương chỉ có tọa độ ODF trơn, không có thiết bị/port
      // đi kèm để bổ sung — nếu existingNext CŨNG có sẵn thì không có cơ sở
      // để biết cái nào đúng hơn (2 tọa độ ODF trơn, không ghép bổ sung được
      // như trường hợp có thiết bị ở trên) -> để xem tay, không tự đoán.
      if (existingNext) {
        conflictRows.push({ id: c.id, counterpart, existingNext, reason: "cả 2 đều là ODF trơn, không rõ cái nào đúng" });
        continue;
      }
      combined = combinePositionNext(counterpart, "", "");
      migratedOdfOnly++;
    }

    pendingUpdates.push({
      id: c.id,
      oldCounterpartText: c.counterpart_text,
      oldDevicePositionNext: c.device_position_next,
      newDevicePositionNext: combined,
    });
  }

  if (COMMIT) {
    const backupDir = path.join(__dirname, "..", "data", "_backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `circuits_counterpart_to_position_next_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(pendingUpdates, null, 2), "utf8");
    console.log(`[migrate-counterpart-to-position-next] Đã backup ${pendingUpdates.length} dòng (giá trị CŨ) vào ${backupFile}`);

    for (const u of pendingUpdates) {
      const { error } = await db
        .from("circuits")
        .update({ device_position_next: u.newDevicePositionNext, counterpart_text: null })
        .eq("id", u.id);
      if (error) throw error;
    }
  }

  console.log(
    `[migrate-counterpart-to-position-next] Di chuyển — có thiết bị ADN1.xxx: ${migratedWithDevice} (trong đó: ghép với Ô1 ODF đã có sẵn = ${mergedFromExistingNext}, tra thư viện ra Ô1 = ${foundOdfViaLibrary}, không rõ Ô1 (để trống) = ${
      migratedWithDevice - mergedFromExistingNext - foundOdfViaLibrary
    })`
  );
  console.log(`[migrate-counterpart-to-position-next] Di chuyển — chỉ tọa độ ODF trơn, không thiết bị: ${migratedOdfOnly}`);
  console.log(`[migrate-counterpart-to-position-next] Bỏ qua — không thuộc diện xử lý (giữ nguyên Đối phương): ${skippedNotRelevant}`);
  console.log(`[migrate-counterpart-to-position-next] Bỏ qua — xung đột thật cần xem tay: ${conflictRows.length}`);
  if (conflictRows.length > 0) {
    console.log(`[migrate-counterpart-to-position-next] Danh sách dòng cần xem tay:`);
    for (const r of conflictRows) {
      console.log(`  [id=${r.id}] (${r.reason}) Đối phương="${r.counterpart}" | Vị trí ODF (tiếp theo) hiện có="${r.existingNext}"`);
    }
  }
  if (unknownDevices.size > 0) {
    console.log(
      `[migrate-counterpart-to-position-next] Thiết bị nhận diện được nhưng CHƯA có trong devices (không tự tạo, tự duyệt qua "Chuẩn hóa tên thiết bị chưa khớp" hoặc sửa tay trong ô Thiết bị (tiếp theo) sau): ${unknownDevices.size}`
    );
    for (const [name, info] of [...unknownDevices.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  - "${name}" @ ${info.trib} — ${info.count} dòng`);
    }
  }

  if (!COMMIT) {
    console.log(`[migrate-counterpart-to-position-next] DRY RUN — chưa ghi gì. Chạy: npm run migrate-counterpart-to-position-next -- --commit`);
  } else {
    console.log(`[migrate-counterpart-to-position-next] Đã ghi xong ${migratedWithDevice + migratedOdfOnly} dòng.`);
  }
}

main().catch((err) => {
  console.error("[migrate-counterpart-to-position-next] Lỗi:", err);
  process.exit(1);
});
