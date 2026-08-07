// Tạo THẬT luồng "mirror" cho các trường hợp "chưa đồng bộ" mà
// scripts/audit-device-device-sync.ts phát hiện (2026-07-31) — khi 2 đầu 1
// luồng đều là thiết bị LOCAL ADN1 đã có trong danh mục `devices`, dữ liệu
// gốc luôn có 2 dòng `circuits` riêng biệt (own của B = phần ODF trong next
// của A) — người dùng xác nhận quy luật này đúng qua nhiều cặp có sẵn, và
// xác nhận hướng xử lý: tự động tạo mirror cho toàn bộ trường hợp thiếu.
//
// KHÁC scripts/sync-missing-trunk-circuits.ts / sync-missing-trunk-trunk-
// circuits.ts (luôn tạo port_circuit_links vì đích là port trung kế THẬT):
// ở đây đích là 1 luồng thiết bị mới (domain=device, KHÔNG có port nào cả,
// đúng bản chất circuits.device_id — architecture.md mục 7.2) — chỉ cần
// INSERT 1 dòng `circuits` với device_id/trib_text/device_position_own/next
// suy ra CƠ HỌC từ dòng gốc (xem lib/deviceDeviceSync.ts), không đụng
// ports/port_circuit_links gì cả.
//
// Gắn `circuits.mirror_of_id` NGAY LÚC TẠO (cột thật từ mục 33, `on delete
// cascade`) — dù domain=device không có port, cột này vẫn áp dụng được y hệt
// (tự trỏ vào `circuits.id`, không phụ thuộc domain) — xóa luồng gốc thì
// mirror thiết bị này cũng tự xóa theo, tránh lặp lại bug mồ côi mục 32.
//
// TỰ RÀ SOÁT LẠI TỪ ĐẦU + RÀ SỐNG NGAY TRƯỚC KHI GHI TỪNG DÒNG (đúng pattern
// 2 script sync trước) để tránh tạo trùng khi 2 gap cùng đợt chạy đụng nhau.
//
// DRY RUN mặc định, --commit để ghi thật.
//
// Chạy: npm run sync-missing-device-device-circuits
//       npm run sync-missing-device-device-circuits -- --commit
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

const COMMIT = process.argv.includes("--commit");

async function main() {
  const { getSupabaseAdmin } = await import("./lib/supabaseAdmin");
  const { fetchDeviceCircuits } = await import("../lib/deviceCircuits");
  const { fetchDevices } = await import("../lib/devices");
  const { findMissingDeviceMirrors, buildMirrorNextPosition } = await import("../lib/deviceDeviceSync");
  const { normalizeDevicePositionKey } = await import("../lib/deviceNotes");

  const supabase = getSupabaseAdmin();

  console.log(`[sync-missing-device-device-circuits] Chế độ: ${COMMIT ? "COMMIT (ghi thật)" : "DRY RUN"}`);
  console.log("Đang tải dữ liệu luồng thiết bị + danh mục thiết bị...");

  const circuits = await fetchDeviceCircuits(supabase);
  const devices = await fetchDevices(supabase);
  const { gaps, mismatches } = findMissingDeviceMirrors(circuits, devices);

  console.log(`Tìm thấy ${gaps.length} ứng viên cần tạo luồng mirror (khớp lúc quét ban đầu).`);
  if (mismatches.length > 0) {
    console.log(
      `Bỏ qua sẵn ${mismatches.length} trường hợp đã có luồng cùng tên nhưng Trib lệch (không tự tạo, chạy npm run audit-device-device-sync để xem chi tiết, cần sửa tay).\n`
    );
  } else {
    console.log("");
  }

  let created = 0;
  let skipped = 0;

  for (const gap of gaps) {
    // Rà soát LẠI ngay trước khi ghi — tránh dùng dữ liệu cũ (vd 1 mirror
    // trước đó trong CÙNG lượt chạy này đã lấp đúng Trib này rồi).
    const { data: liveRows, error: liveErr } = await supabase
      .from("circuits")
      .select("id, trib_text")
      .eq("device_id", gap.targetDeviceId);
    if (liveErr) {
      console.log(`  [LỖI] "${gap.sourceCircuitName}" -> không đọc được luồng sống của "${gap.targetDeviceName}": ${liveErr.message}`);
      skipped++;
      continue;
    }
    const targetTribKey = normalizeDevicePositionKey(gap.targetTrib);
    const already = (liveRows ?? []).some((r) => r.trib_text && normalizeDevicePositionKey(r.trib_text) === targetTribKey);
    if (already) {
      console.log(`  [BỎ QUA] "${gap.sourceCircuitName}" -> "${gap.targetDeviceName}" đã có Trib "${gap.targetTrib}" (do luồng mirror khác cùng đợt chạy này, hoặc đã được thêm tay).`);
      skipped++;
      continue;
    }

    const nextPosition = buildMirrorNextPosition(gap);

    if (!COMMIT) {
      console.log(
        `  [SẼ TẠO] "${gap.sourceCircuitName}" -> thiết bị "${gap.targetDeviceName}", Trib "${gap.targetTrib}", ` +
          `Vị trí ODF = "${gap.targetOwnPosition}", tiếp theo = "${nextPosition}"`
      );
      created++;
      continue;
    }

    const { error: insErr } = await supabase.from("circuits").insert({
      name: gap.sourceCircuitName,
      interface_type: gap.sourceInterfaceType,
      device_id: gap.targetDeviceId,
      trib_text: gap.targetTrib,
      device_position_own: gap.targetOwnPosition,
      device_position_next: nextPosition || null,
      mirror_of_id: gap.sourceCircuitId,
      notes: `Tự tạo từ luồng thiết bị "${gap.sourceCircuitName}" (thiết bị "${gap.sourceDeviceName}", Trib "${gap.sourceTrib}") — rà soát đồng bộ thiết bị-thiết bị 2026-07-31, script sync-missing-device-device-circuits.ts.`,
    });
    if (insErr) {
      console.log(`  [LỖI] "${gap.sourceCircuitName}" -> tạo circuit thất bại: ${insErr.message}`);
      skipped++;
      continue;
    }

    console.log(`  [ĐÃ TẠO] "${gap.sourceCircuitName}" -> thiết bị "${gap.targetDeviceName}", Trib "${gap.targetTrib}"`);
    created++;
  }

  console.log(`\n=== TÓM TẮT ===`);
  console.log(`${COMMIT ? "Đã tạo" : "Sẽ tạo"}: ${created}`);
  console.log(`Bỏ qua (xung đột/lỗi): ${skipped}`);
  if (!COMMIT) {
    console.log(`\nDRY RUN — chưa ghi gì. Chạy: npm run sync-missing-device-device-circuits -- --commit`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
