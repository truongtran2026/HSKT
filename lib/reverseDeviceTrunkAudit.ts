import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllTrunkPorts } from "@/lib/trunkPorts";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";

// Phát hiện 2026-07-31 (người dùng đặt câu hỏi giả định, rồi yêu cầu xây
// luôn): CHIỀU NGƯỢC của mục 38/39 — 1 luồng bên "Hồ sơ ODF Trung kế" đã có
// sẵn (đúng số liệu, có port_circuit_links thật) nhưng bên "Hồ sơ đấu nối"
// thiết bị lại CHƯA có dòng nào cho luồng đó (không phải lệch Trib, mà THIẾU
// HẲN — có thể do nhập tay bỏ sót, hoặc do đã nhập nhưng khác định dạng tên
// thiết bị nên không khớp).
//
// KHÔNG dùng cách "dò tên thiết bị trong text rồi tự match/tạo" như mục
// 38/39 — người dùng chỉ rõ rủi ro: tên thiết bị ghi trong luồng trung kế có
// thể sai FORMAT (vd "ADN1.MPE8" thay vì đúng chuẩn "ADN1.MPE#8"), nếu tự
// match/tạo theo text này sẽ lặp lại đúng bug tạo trùng thiết bị đã gặp ở mục
// 35 (PSS64/BB330G). Vì vậy hàm này CHỈ dùng để PHÁT HIỆN + hiển thị cho
// người dùng tự phán đoán (đúng nguyên tắc "không đoán, để người dùng tự
// sửa" đã áp dụng xuyên suốt dự án) — không tự tạo/match device nào cả.
//
// Cách phát hiện: mirror pair LUÔN giữ NGUYÊN tên luồng ở cả 2 phía (xác nhận
// nhiều lần trong dự án, xem mục 35). Vậy 1 luồng trung kế có PHẦN TÊN dạng
// "ADN1.<thiết bị> (<trib>)" (tức có thể liên quan 1 thiết bị local) mà KHÔNG
// có bất kỳ luồng nào bên domain=device cùng TÊN CHÍNH XÁC -> khả năng cao là
// thiếu mirror bên thiết bị.
const NAME_DEVICE_SEGMENT = /A[DĐ]N1\.([^()]+?)\s*\(([^)]+)\)/i;

export interface TrunkCircuitMissingDeviceMirror {
  trunkCircuitId: string;
  trunkCircuitName: string;
  rackId: string;
  rackCode: string;
  /** portId của port ĐẦU TIÊN — dùng để nhảy tới đúng dòng ở /odf-trunk/<rackId>#port-<portId>. */
  firstPortId: string;
  portNumbers: number[];
  /** Đoạn "<thiết bị> (<trib>)" tách được từ tên, chỉ để HIỂN THỊ cho người
   *  dùng tự đối chiếu format — không dùng để match/tạo device nào. */
  parsedDeviceText: string;
}

// Đợt 3 (2026-08-06): tham số `client` bắt buộc — xem lib/devices.ts.
export async function findTrunkCircuitsMissingDeviceMirror(client: SupabaseClient): Promise<TrunkCircuitMissingDeviceMirror[]> {
  const [trunkPorts, deviceCircuits] = await Promise.all([fetchAllTrunkPorts(client), fetchDeviceCircuits(client)]);
  const deviceCircuitNames = new Set(deviceCircuits.map((c) => c.name));

  const byCircuit = new Map<string, { name: string; rackId: string; rackCode: string; firstPortId: string; portNumbers: number[] }>();
  for (const p of trunkPorts) {
    if (!p.circuit) continue;
    if (!NAME_DEVICE_SEGMENT.test(p.circuit.name)) continue; // tên không nhắc tới thiết bị ADN1 nào -> ngoài phạm vi
    const entry =
      byCircuit.get(p.circuit.id) ?? { name: p.circuit.name, rackId: p.rackId, rackCode: p.rackCode, firstPortId: p.portId, portNumbers: [] };
    entry.portNumbers.push(p.portNumber);
    byCircuit.set(p.circuit.id, entry);
  }

  const result: TrunkCircuitMissingDeviceMirror[] = [];
  for (const [circuitId, info] of byCircuit) {
    if (deviceCircuitNames.has(info.name)) continue; // đã có luồng cùng tên bên thiết bị -> coi như đã đồng bộ
    const m = info.name.match(NAME_DEVICE_SEGMENT);
    result.push({
      trunkCircuitId: circuitId,
      trunkCircuitName: info.name,
      rackId: info.rackId,
      rackCode: info.rackCode,
      firstPortId: info.firstPortId,
      portNumbers: [...info.portNumbers].sort((a, b) => a - b),
      parsedDeviceText: m ? `${m[1].trim()} (${m[2].trim()})` : "",
    });
  }
  return result.sort((a, b) => a.trunkCircuitName.localeCompare(b.trunkCircuitName));
}
