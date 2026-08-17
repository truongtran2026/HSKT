import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { fetchDevices, type DeviceRow } from "@/lib/devices";
import { splitOdfDeviceStructure, combinePositionNext } from "@/lib/parsers/transit-text";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";
import type { MirrorGapScanSummary, MirrorScanScope } from "@/lib/mirrorTrunkCircuits";
import { rowAnchor } from "@/lib/deviceCircuitAnchor";

// Phát hiện 2026-07-31 (người dùng, ngay sau khi tự thêm luồng "ADN1.ASBR#2-
// MX2020 (7/1/7) đi ADN1.P2 (16/1/9)"): khi 2 đầu 1 luồng đều là thiết bị
// LOCAL ADN1 đã có trong danh mục `devices`, dữ liệu gốc (từ Excel import
// ban đầu, xem architecture.md mục 7.2) luôn ghi 2 DÒNG `circuits` RIÊNG
// BIỆT — mỗi thiết bị 1 dòng, "device_position_own" của dòng NÀY chính là
// PHẦN ODF trong "device_position_next" của dòng KIA (đối chiếu nhiều cặp
// thật ASBR#2-MX2020 <-> P2 đã có sẵn để xác nhận quy luật này, KHÔNG phải
// suy đoán). Nghĩa là: toàn bộ thông tin để tạo dòng mirror ĐÃ CÓ SẴN ngay
// trong "device_position_next" của dòng gốc — không cần biết thêm gì về vật
// lý thật ở phía thiết bị kia (khác nhận định ban đầu SAI của trợ lý AI khi
// mới gặp ca này, người dùng đã chỉ ra đúng).
//
// findMissingDeviceMirrors() dùng CHUNG cho cả script rà soát (đọc, in báo
// cáo) lẫn script đồng bộ (ghi thật) — tránh lặp lại thuật toán ở 2 nơi rồi
// tự lệch nhau (bài học architecture.md mục 9).
export interface DeviceMirrorGap {
  sourceCircuitId: string;
  sourceCircuitName: string;
  sourceInterfaceType: string | null;
  sourceDeviceName: string | null;
  sourceOwnPosition: string | null;
  sourceTrib: string | null;
  rawNext: string;
  targetDeviceId: string;
  targetDeviceName: string;
  targetOwnPosition: string;
  targetTrib: string;
}

// Trường hợp KHÔNG khớp Trib nhưng thiết bị đích ĐÃ CÓ 1 luồng CÙNG TÊN hệt
// luồng gốc — phát hiện thật 2026-07-31 khi kiểm tra chéo trước khi tự động
// ghi: ví dụ "STM1 AĐN1.ADX (ADX#16/LP1) - 2T9.OME11" đã có sẵn ở CẢ 2 phía
// (OMS3255 lẫn ADX), nhưng dòng phía ADX ghi `trib_text` = "ADX#15/LP1"
// (lệch 1 số so với "ADX#16/LP1" mà phía kia tham chiếu tới — lỗi gõ/copy từ
// dữ liệu gốc, 2 dòng LP1/LP2 kề nhau rất dễ lẫn). KHÔNG được coi đây là
// "thiếu mirror" rồi tự tạo thêm — sẽ tạo TRÙNG luồng đã có, làm dữ liệu tệ
// hơn. Tách riêng để báo cho người dùng tự sửa lại đúng Trib bên nào.
export interface DeviceMirrorMismatch {
  sourceCircuitId: string;
  sourceCircuitName: string;
  sourceDeviceName: string | null;
  targetDeviceName: string;
  expectedTrib: string;
  existingCircuitId: string;
  existingTrib: string | null;
}

export interface DeviceMirrorAudit {
  gaps: DeviceMirrorGap[];
  mismatches: DeviceMirrorMismatch[];
}

export function findMissingDeviceMirrors(circuits: DeviceCircuitRow[], devices: DeviceRow[]): DeviceMirrorAudit {
  const deviceIdByKey = new Map<string, { id: string; name: string }>();
  for (const d of devices) deviceIdByKey.set(normalizeDeviceNameKey(d.name), { id: d.id, name: d.name });

  // Gom Trib "own" của MỖI thiết bị (key hóa tên) để tra ngược khi kiểm tra
  // thiết bị đích đã có Trib đó chưa.
  const ownTribByDeviceKey = new Map<string, Set<string>>();
  // Gom TÊN LUỒNG của mỗi thiết bị — dùng để phát hiện "đã có mirror nhưng
  // lệch Trib" (xem DeviceMirrorMismatch) thay vì báo thiếu nhầm.
  const circuitsByDeviceKey = new Map<string, DeviceCircuitRow[]>();
  for (const c of circuits) {
    if (!c.deviceName) continue;
    const key = normalizeDeviceNameKey(c.deviceName);
    if (c.tribText) {
      const set = ownTribByDeviceKey.get(key) ?? new Set<string>();
      set.add(normalizeDevicePositionKey(c.tribText));
      ownTribByDeviceKey.set(key, set);
    }
    const list = circuitsByDeviceKey.get(key) ?? [];
    list.push(c);
    circuitsByDeviceKey.set(key, list);
  }

  const gaps: DeviceMirrorGap[] = [];
  const mismatches: DeviceMirrorMismatch[] = [];
  for (const c of circuits) {
    const raw = c.devicePositionNext;
    if (!raw) continue;
    const split = splitOdfDeviceStructure(raw);
    if (!split.matched || !split.deviceName || !split.port || !split.odfPart) continue;

    const targetKey = normalizeDeviceNameKey(split.deviceName);
    const target = deviceIdByKey.get(targetKey);
    if (!target) continue; // không phải thiết bị local ADN1 đã biết
    if (c.deviceName && normalizeDeviceNameKey(c.deviceName) === targetKey) continue; // tự trỏ về chính nó

    const targetTribKey = normalizeDevicePositionKey(split.port);
    const targetOwnTribs = ownTribByDeviceKey.get(targetKey);
    if (targetOwnTribs && targetOwnTribs.has(targetTribKey)) continue; // đã có mirror khớp Trib

    // Trước khi kết luận "thiếu" — kiểm tra thiết bị đích có luồng CÙNG TÊN
    // chưa (mirror thật luôn giữ NGUYÊN tên luồng ở cả 2 phía, đối chiếu xác
    // nhận qua nhiều cặp có sẵn). Có tên khớp mà Trib lệch -> đây là mismatch
    // cần sửa tay, KHÔNG tự tạo thêm.
    const targetCircuits = circuitsByDeviceKey.get(targetKey) ?? [];
    const sameNameCircuit = targetCircuits.find((tc) => tc.name === c.name);
    if (sameNameCircuit) {
      mismatches.push({
        sourceCircuitId: c.id,
        sourceCircuitName: c.name,
        sourceDeviceName: c.deviceName,
        targetDeviceName: target.name,
        expectedTrib: split.port,
        existingCircuitId: sameNameCircuit.id,
        existingTrib: sameNameCircuit.tribText,
      });
      continue;
    }

    gaps.push({
      sourceCircuitId: c.id,
      sourceCircuitName: c.name,
      sourceInterfaceType: c.interfaceType,
      sourceDeviceName: c.deviceName,
      sourceOwnPosition: c.devicePositionOwn,
      sourceTrib: c.tribText,
      rawNext: raw,
      targetDeviceId: target.id,
      targetDeviceName: target.name,
      targetOwnPosition: split.odfPart,
      targetTrib: split.port,
    });
  }
  return { gaps, mismatches };
}

// Ghép "device_position_next" cho dòng MIRROR — trỏ ngược về đúng
// own/device/trib của luồng gốc (dùng combinePositionNext() sẵn có, đúng
// định dạng "ODF... - Tên (trib)" đã dùng khắp nơi khác).
//
// Sửa 2026-07-31 (người dùng chỉ ra sau khi phát hiện ca ADX<->OMS3255):
// "2 vị trí ODF không thể là CÙNG 1 tọa độ" — nếu `device_position_own` của
// luồng GỐC lại trùng với PHẦN ODF đã tách từ chính `device_position_next`
// của nó (own == targetOwnPosition, xem findMissingDeviceMirrors), đó là
// dấu hiệu dữ liệu gốc dùng kiểu ghi CŨ để thể hiện "kết nối trực tiếp" (lặp
// lại tọa độ thay vì ghi thẳng chữ — khác các dòng đã chuẩn hóa như
// ADX#15/LP1, #16/LP1, #16/LP2 ghi own="Kết nối trực tiếp" rõ ràng). Khi đó
// dùng "Kết nối trực tiếp" cho phần ODF của "next" bên mirror thay vì lặp
// lại đúng tọa độ đã dùng cho "own" (own vẫn giữ tọa độ thật, chỉ next đổi).
export function buildMirrorNextPosition(gap: DeviceMirrorGap): string {
  const sourceDeviceBareName = (gap.sourceDeviceName ?? "").replace(/^ADN1\.\s*/i, "").replace(/^AĐN1\.\s*/i, "");
  const ownKey = normalizeDevicePositionKey(gap.sourceOwnPosition ?? "");
  const targetOwnKey = normalizeDevicePositionKey(gap.targetOwnPosition);
  const nextOdfPart = ownKey && targetOwnKey && ownKey === targetOwnKey ? "Kết nối trực tiếp" : gap.sourceOwnPosition ?? "";
  return combinePositionNext(nextOdfPart, sourceDeviceBareName, gap.sourceTrib ?? "");
}

// Phát hiện 2026-07-31 (người dùng, sau khi thêm 2 luồng ADSR#2 (7/1/8) và
// (7/1/9) nhưng bên ADN1.PSS24X#3 BB1 (1-4-1)/(1-4-5) KHÔNG tự có): cơ chế
// "tự tạo mirror" ở mục 35/36 CHỈ từng chạy 1 LẦN qua script dọn dữ liệu cũ
// (sync-missing-device-device-circuits.ts), CHƯA BAO GIỜ được gắn vào form
// Thêm/Sửa luồng thật trên UI — nên mọi luồng thiết bị-thiết bị MỚI thêm/sửa
// sau đó vẫn bị thiếu mirror y hệt trước khi dọn. Hàm này gọi được thẳng từ
// submitCreate()/saveEdit() (DeviceCircuitList.tsx) ngay sau khi lưu xong 1
// luồng, để tạo NGAY mirror nếu thiếu — TÁI DÙNG ĐÚNG findMissingDeviceMirrors
// + buildMirrorNextPosition ở trên (không viết lại thuật toán khác ở đây,
// tránh lệch nhau như bài học mục 34/35), chỉ khác là tự fetch dữ liệu MỚI
// NHẤT rồi ghi luôn (không cần DRY RUN vì đây là 1 luồng đơn lẻ người dùng vừa
// chủ động lưu, không phải sửa hàng loạt).
// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
export async function autoCreateMirrorForCircuit(
  client: SupabaseClient,
  sourceCircuitId: string
): Promise<
  | { status: "created"; targetDeviceName: string; trib: string }
  | { status: "linked"; targetDeviceName: string; trib: string }
  | { status: "no-gap" }
  | {
      status: "mismatch";
      targetDeviceName: string;
      existingCircuitId: string;
      existingTrib: string | null;
      expectedTrib: string;
    }
  | {
      status: "occupied";
      targetDeviceName: string;
      targetTrib: string;
      occupantCircuitId: string;
      occupantCircuitName: string;
    }
  | { status: "error"; message: string }
> {
  const supabase = client;
  const circuits = await fetchDeviceCircuits(client);
  const devices = await fetchDevices(client);
  const sourceCircuit = circuits.find((c) => c.id === sourceCircuitId);
  if (!sourceCircuit) return { status: "no-gap" };

  const { gaps, mismatches } = findMissingDeviceMirrors(circuits, devices);
  const gap = gaps.find((g) => g.sourceCircuitId === sourceCircuitId);
  if (!gap) {
    const mismatch = mismatches.find((m) => m.sourceCircuitName === sourceCircuit.name);
    if (mismatch) {
      return {
        status: "mismatch",
        targetDeviceName: mismatch.targetDeviceName,
        existingCircuitId: mismatch.existingCircuitId,
        existingTrib: mismatch.existingTrib,
        expectedTrib: mismatch.expectedTrib,
      };
    }

    // Phát hiện 2026-08-17 (người dùng, ca "100GE ADN1.P2 (18/1/8)" bị nhập
    // TRÙNG LẶP y hệt lần 2 — "100 ADN1.P2 (18/1/8)..."): `findMissingDeviceMirrors`
    // không tạo gap CŨNG KHÔNG tạo mismatch cho ca này — nó chỉ âm thầm bỏ
    // qua ở dòng `if (targetOwnTribs.has(targetTribKey)) continue` (Trib đích
    // đã bị 1 luồng KHÁC chiếm mất, dù không cùng tên với mismatch nào) —
    // "no-gap" trả về khiến người dùng KHÔNG biết luồng vừa lưu chưa liên kết
    // được vì đâu. Soi lại TRỰC TIẾP ở đây (không đụng thuật toán dùng chung
    // findMissingDeviceMirrors — hàm đó còn phục vụ quét hàng loạt ở
    // syncAllDeviceMirrorGaps, không nên đổi hành vi của nó): nếu Ô "Vị trí
    // ODF (tiếp theo)" trỏ đúng 1 thiết bị+Trib local đã có luồng KHÁC chiếm,
    // báo rõ "occupied" (cùng tinh thần "occupied" của mirror TRUNG KẾ, xem
    // lib/mirrorTrunkCircuits.ts) để UI hỏi xóa luồng chiếm chỗ đó rồi tạo lại
    // — thay vì cùng tên thì tự gắn liên kết luôn (status "linked", không cần
    // hỏi, đối xứng case B của mirror trung kế).
    const raw = sourceCircuit.devicePositionNext;
    if (raw) {
      const split = splitOdfDeviceStructure(raw);
      if (split.matched && split.deviceName && split.port) {
        const targetKey = normalizeDeviceNameKey(split.deviceName);
        const target = devices.find((d) => normalizeDeviceNameKey(d.name) === targetKey);
        const isSelf = sourceCircuit.deviceName && normalizeDeviceNameKey(sourceCircuit.deviceName) === targetKey;
        if (target && !isSelf) {
          const targetTribKey = normalizeDevicePositionKey(split.port);
          const occupant = circuits.find(
            (c) => c.id !== sourceCircuitId && c.deviceId === target.id && c.tribText && normalizeDevicePositionKey(c.tribText) === targetTribKey
          );
          if (occupant && occupant.mirrorOfId !== sourceCircuitId && sourceCircuit.mirrorOfId !== occupant.id) {
            if (occupant.name === sourceCircuit.name) {
              const { error: linkErr } = await supabase.from("circuits").update({ mirror_of_id: sourceCircuitId }).eq("id", occupant.id);
              if (linkErr) return { status: "error", message: linkErr.message };
              return { status: "linked", targetDeviceName: target.name, trib: split.port };
            }
            return {
              status: "occupied",
              targetDeviceName: target.name,
              targetTrib: split.port,
              occupantCircuitId: occupant.id,
              occupantCircuitName: occupant.name,
            };
          }
        }
      }
    }
    return { status: "no-gap" };
  }

  // Rà sống lại ngay trước khi ghi (đúng pattern script sync) — tránh trùng
  // nếu vừa có luồng khác lấp đúng Trib này ở 1 nhịp trước đó.
  const { data: liveRows, error: liveErr } = await supabase.from("circuits").select("id, trib_text").eq("device_id", gap.targetDeviceId);
  if (liveErr) return { status: "error", message: liveErr.message };
  const targetTribKey = normalizeDevicePositionKey(gap.targetTrib);
  const already = (liveRows ?? []).some((r) => r.trib_text && normalizeDevicePositionKey(r.trib_text) === targetTribKey);
  if (already) return { status: "no-gap" };

  const nextPosition = buildMirrorNextPosition(gap);
  const { error: insErr } = await supabase.from("circuits").insert({
    name: gap.sourceCircuitName,
    interface_type: gap.sourceInterfaceType,
    device_id: gap.targetDeviceId,
    trib_text: gap.targetTrib,
    device_position_own: gap.targetOwnPosition,
    device_position_next: nextPosition || null,
    mirror_of_id: gap.sourceCircuitId,
    notes: `Tự tạo từ luồng thiết bị "${gap.sourceCircuitName}" (thiết bị "${gap.sourceDeviceName}", Trib "${gap.sourceTrib}") — tự động ngay lúc lưu luồng gốc, xem lib/deviceDeviceSync.ts.`,
  });
  if (insErr) return { status: "error", message: insErr.message };
  return { status: "created", targetDeviceName: gap.targetDeviceName, trib: gap.targetTrib };
}

// "Xóa bên đang chiếm rồi tạo lại theo đúng bên vừa lưu" — đối xứng
// `replaceOccupantAndCreateTrunkMirror`/`replaceOccupantAndCreateTrunkTrunkMirror`
// (lib/mirrorTrunkCircuits.ts, bước 3/6, cùng 1 cách xử lý DUY NHẤT cho mọi
// loại cặp thay vì phân biệt trung kế/thiết bị). Luồng thiết bị KHÔNG có
// port_circuit_links (chỉ gắn `device_id`, xem architecture.md mục 3.4) nên
// xóa đơn giản hơn phía trung kế — không cần dọn `ports`/`transit_links`.
export async function replaceMismatchedDeviceMirror(
  client: SupabaseClient,
  existingCircuitId: string,
  sourceCircuitId: string
): ReturnType<typeof autoCreateMirrorForCircuit> {
  const supabase = client;
  const { error } = await supabase.from("circuits").delete().eq("id", existingCircuitId);
  if (error) return { status: "error", message: error.message };
  return autoCreateMirrorForCircuit(client, sourceCircuitId);
}

// "Nếu bên hồ sơ còn lại đang trống thì sync luôn chứ sao phải đợi sửa lại
// bên hồ sơ đúng 1 chút gì đó... rồi mới kích hoạt" (yêu cầu người dùng
// 2026-08-02) — đối xứng `syncAllTrunkMirrorGaps` (lib/mirrorTrunkCircuits.ts):
// quét TOÀN BỘ tồn đọng cũ 1 lượt, không cần đợi ai sửa+lưu lại từng luồng.
// `findMissingDeviceMirrors` đã tính SẴN toàn bộ gaps/mismatches cho MỌI
// circuit trong 1 lần gọi (khác trunk phải lặp qua từng luồng) nên hàm này
// đơn giản hơn hẳn — không viết lại thuật toán, chỉ thêm vòng lặp ghi.
export async function syncAllDeviceMirrorGaps(client: SupabaseClient, scope?: MirrorScanScope): Promise<MirrorGapScanSummary> {
  const supabase = client;
  const circuits = await fetchDeviceCircuits(client);
  const devices = await fetchDevices(client);
  // findMissingDeviceMirrors() phải chạy trên TOÀN BỘ dữ liệu (không lọc
  // scope ở INPUT) — nó cần thấy hết mọi luồng của thiết bị ĐÍCH để biết
  // đúng Trib nào đã có, lọc scope SỚM sẽ làm sai kết quả đối chiếu đó. Chỉ
  // lọc scope ở OUTPUT (gaps/mismatches), sau khi đã tính xong.
  const { gaps: allGaps, mismatches: allMismatches } = findMissingDeviceMirrors(circuits, devices);

  const gapInScope = (g: (typeof allGaps)[number]) => {
    if (!scope) return true;
    if (scope.deviceName && g.sourceDeviceName !== scope.deviceName && g.targetDeviceName !== scope.deviceName) return false;
    if (
      scope.deviceRackCode &&
      !(g.sourceOwnPosition ?? "").includes(scope.deviceRackCode) &&
      !g.targetOwnPosition.includes(scope.deviceRackCode)
    )
      return false;
    return true;
  };
  const gaps = allGaps.filter(gapInScope);
  // DeviceMirrorMismatch không mang theo vị trí ODF (chỉ có tên thiết bị
  // nguồn/đích) nên chỉ lọc được theo deviceName — bỏ qua deviceRackCode cho
  // danh sách này (không đủ dữ liệu để xác định chắc, thà hiện thừa còn hơn
  // giấu mất 1 xung đột thật).
  const mismatches = scope?.deviceName
    ? allMismatches.filter((m) => m.targetDeviceName === scope.deviceName || m.sourceDeviceName === scope.deviceName)
    : allMismatches;

  const summary: MirrorGapScanSummary = {
    created: 0,
    linked: 0,
    // "Mỗi lần vướng lại phải hỏi bạn lấy dữ liệu từ đâu... có cách nào ghi
    // sẵn không" (yêu cầu người dùng 2026-08-02) — detail phải tự nói rõ
    // nguồn gốc (thiết bị nào, Trib nào) + sourceHref bấm thẳng tới đúng dòng
    // "Hồ sơ đấu nối" của luồng NGUỒN, không bắt phải hỏi lại.
    conflicts: mismatches.map((m) => ({
      sourceName: m.sourceCircuitName,
      detail: `Luồng của thiết bị "${m.sourceDeviceName ?? "?"}" đặt tên trùng "${m.sourceCircuitName}" — thiết bị "${
        m.targetDeviceName
      }" đã có luồng cùng tên đó nhưng Trib ghi "${m.existingTrib ?? "(trống)"}" khác với Trib mong đợi "${m.expectedTrib}"`,
      sourceHref: `/odf-device/sua-luong#${rowAnchor(m.sourceCircuitId)}`,
    })),
    errors: [],
  };

  for (const gap of gaps) {
    const { data: liveRows, error: liveErr } = await supabase.from("circuits").select("id, trib_text").eq("device_id", gap.targetDeviceId);
    if (liveErr) {
      summary.errors.push(`${gap.sourceCircuitName}: ${liveErr.message}`);
      continue;
    }
    const targetTribKey = normalizeDevicePositionKey(gap.targetTrib);
    const already = (liveRows ?? []).some((r) => r.trib_text && normalizeDevicePositionKey(r.trib_text) === targetTribKey);
    if (already) continue; // đã lấp trong lượt quét này (1 gap khác của cùng thiết bị đích) hoặc đã có từ trước

    const nextPosition = buildMirrorNextPosition(gap);
    const { error: insErr } = await supabase.from("circuits").insert({
      name: gap.sourceCircuitName,
      interface_type: gap.sourceInterfaceType,
      device_id: gap.targetDeviceId,
      trib_text: gap.targetTrib,
      device_position_own: gap.targetOwnPosition,
      device_position_next: nextPosition || null,
      mirror_of_id: gap.sourceCircuitId,
      notes: `Tự tạo từ luồng thiết bị "${gap.sourceCircuitName}" (quét lấp đầy chỗ trống, /data-quality) — xem lib/deviceDeviceSync.ts.`,
    });
    if (insErr) {
      summary.errors.push(`${gap.sourceCircuitName}: ${insErr.message}`);
      continue;
    }
    summary.created++;
  }

  return summary;
}
