import { isStandbyCircuitName } from "./text";

export type DerivedPortStatus = "empty" | "standby" | "in_use";

// Nguồn xác định trạng thái DUY NHẤT dùng chung cho Search + Dashboard — suy
// trực tiếp từ dữ liệu thật (có luồng gán hay không + tên luồng), KHÔNG dùng
// ports.status/circuits.circuit_role (2 cột đó suy đoán lúc import theo tên
// rack, sai lệch nhiều so với thực tế — xem lib/text.ts:isStandbyCircuitName).
export function derivePortStatus(circuit: { name: string } | null): DerivedPortStatus {
  if (!circuit) return "empty";
  return isStandbyCircuitName(circuit.name) ? "standby" : "in_use";
}
