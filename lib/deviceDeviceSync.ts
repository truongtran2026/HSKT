import { supabase } from "@/lib/supabase";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { fetchDevices, type DeviceRow } from "@/lib/devices";
import { splitOdfDeviceStructure, combinePositionNext } from "@/lib/parsers/transit-text";
import { normalizeDeviceNameKey, normalizeDevicePositionKey } from "@/lib/deviceNotes";

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
  sourceCircuitName: string;
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
        sourceCircuitName: c.name,
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
export async function autoCreateMirrorForCircuit(
  sourceCircuitId: string
): Promise<
  | { status: "created"; targetDeviceName: string; trib: string }
  | { status: "no-gap" }
  | { status: "mismatch"; targetDeviceName: string; existingTrib: string | null; expectedTrib: string }
  | { status: "error"; message: string }
> {
  const circuits = await fetchDeviceCircuits();
  const devices = await fetchDevices();
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
        existingTrib: mismatch.existingTrib,
        expectedTrib: mismatch.expectedTrib,
      };
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
