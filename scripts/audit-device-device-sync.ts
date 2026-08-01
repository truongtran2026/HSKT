// Rà soát TOÀN BỘ luồng thiết bị (domain=device) tìm trường hợp "Vị trí ODF
// tiếp theo" tham chiếu tới 1 THIẾT BỊ LOCAL ADN1 KHÁC đã có sẵn trong danh
// mục `devices` nhưng thiết bị đích đó lại KHÔNG có luồng mirror trỏ ngược
// lại — người dùng phát hiện thật 2026-07-31: thêm luồng "ADN1.ASBR#2-MX2020
// (7/1/7) đi ADN1.P2 (16/1/9)" nhưng bên "ADN1.P2" không hề có luồng nào ở
// Trib "16/1/9" cả.
//
// Người dùng chỉ ra ĐÚNG: toàn bộ dữ liệu cần để tạo mirror ĐÃ CÓ SẴN trong
// "device_position_next" của dòng gốc (đối chiếu các cặp ASBR#2-MX2020 <->
// P2 đã có sẵn xác nhận: own của thiết bị B = phần ODF trong next của thiết
// bị A) — không cần thêm thông tin vật lý nào khác. Thuật toán dùng chung
// với scripts/sync-missing-device-device-circuits.ts, xem lib/deviceDeviceSync.ts.
//
// CHỈ ĐỌC (read-only) — không sửa gì, chỉ in báo cáo.
//
// Chạy: npm run audit-device-device-sync
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const { fetchDeviceCircuits } = await import("../lib/deviceCircuits");
  const { fetchDevices } = await import("../lib/devices");
  const { findMissingDeviceMirrors } = await import("../lib/deviceDeviceSync");

  console.log("Đang tải dữ liệu luồng thiết bị + danh mục thiết bị...");
  const circuits = await fetchDeviceCircuits();
  const devices = await fetchDevices();

  const { gaps, mismatches } = findMissingDeviceMirrors(circuits, devices);

  console.log(`\n=== ${gaps.length} trường hợp THIẾU HẲN luồng mirror (an toàn để tự tạo) ===`);
  for (const g of gaps) {
    console.log(
      `  "${g.sourceCircuitName}" (thiết bị "${g.sourceDeviceName}", Trib "${g.sourceTrib}") ghi tiếp theo "${g.rawNext}" -> thiết bị "${g.targetDeviceName}" chưa có Trib "${g.targetTrib}"`
    );
  }

  console.log(`\n=== ${mismatches.length} trường hợp ĐÃ CÓ mirror cùng tên nhưng Trib LỆCH (cần sửa tay, KHÔNG tự tạo) ===`);
  for (const m of mismatches) {
    console.log(
      `  "${m.sourceCircuitName}" -> thiết bị "${m.targetDeviceName}" đã có luồng cùng tên (id ${m.existingCircuitId}) nhưng Trib đang ghi "${m.existingTrib}" khác với Trib mong đợi "${m.expectedTrib}"`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
