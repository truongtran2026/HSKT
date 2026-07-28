// Rà soát TOÀN BỘ dữ liệu ODF thiết bị để tìm chỗ "chưa đồng bộ" với ODF
// trung kế (phát hiện thực tế 2026-07-28 qua luồng "10GE AĐN1.P2 (17/0/3) -
// DNG.MPE.06 (1/2/1)" — Ô "Vị trí ODF (tiếp theo)" ghi "ODF 1/5 (07,08)",
// rack ODF1/5 là rack trung kế THẬT (tuyến "48FO#2 ADN1 - 2T9"), nhưng port
// 7/8 ở đó lại "trống" trên Hồ sơ ODF Trung kế — không có port_circuit_links
// thật nào cả, dù bên "Sửa luồng thiết bị" ghi rõ đã dùng).
//
// CHỈ ĐỌC (read-only) — không sửa gì, chỉ in báo cáo.
//
// Dùng THẲNG các hàm live thật (matchTrunkPosition/fetchAllOdfPorts/
// fetchDeviceCircuits/splitOdfDeviceStructure) thay vì chép lại thuật toán,
// để không lệch với UI đang chạy (bài học ở architecture.md mục 9: sửa thuật
// toán gốc mà quên sửa bản chép sẽ lệch kết quả). Các file lib đó
// `import { supabase } from "@/lib/supabase"`, đọc process.env NGAY lúc
// import module — nạp env TRƯỚC bằng loadEnv() rồi mới `await import(...)`
// ĐỘNG (dynamic import, không hoist như import tĩnh) để đảm bảo thứ tự chạy
// đúng, KHÔNG cần cờ `-r dotenv/config` hay biến môi trường phụ nào khi gọi
// qua `npm run` (khác cách 2 script `normalize-odf-positions.ts`/
// `fix-100g-label.ts` trước đây phải chép nguyên văn thuật toán vì chưa nghĩ
// ra cách này).
//
// Chạy: npm run audit-device-trunk-sync
import * as path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.join(__dirname, "..", ".env.local") });

async function main() {
  const { fetchAllOdfPorts, matchTrunkPosition } = await import("../lib/trunkPorts");
  const { fetchDeviceCircuits } = await import("../lib/deviceCircuits");
  const { splitOdfDeviceStructure } = await import("../lib/parsers/transit-text");

  type TrunkPortRow = Awaited<ReturnType<typeof fetchAllOdfPorts>>[number];
  type TrunkPositionMatch = ReturnType<typeof matchTrunkPosition>;
  type DeviceCircuitRow = Awaited<ReturnType<typeof fetchDeviceCircuits>>[number];

  // Cùng logic odfPartOf() trong lib/deviceRackPorts.ts — device_position_next
  // có thể là chuỗi ghép "ODF x/y (a,b) - TênThiếtBị (Trib)", phải tách lấy
  // đúng phần ODF trước khi so khớp port, nếu không chữ số trong tên/trib
  // phía sau sẽ bị đọc nhầm thành port (đúng lỗi "696 port mâu thuẫn" đã tự
  // sửa ở architecture.md mục 13).
  function odfPartOf(raw: string | null): string | null {
    if (!raw) return null;
    const split = splitOdfDeviceStructure(raw);
    return split.matched ? split.odfPart ?? null : raw;
  }

  interface Mismatch {
    circuitId: string;
    circuitName: string;
    deviceName: string | null;
    field: "own" | "next";
    rawText: string;
    rackCode: string;
    emptyPorts: number[];
    occupiedByOther: { portNumber: number; circuitName: string }[];
  }

  const mismatches: Mismatch[] = [];
  const invalidList: { circuitId: string; circuitName: string; field: string; rackCode: string; invalidPorts: number[] }[] = [];

  function checkMatch(circuit: DeviceCircuitRow, field: "own" | "next", rawText: string, match: TrunkPositionMatch) {
    if (!match.matched || match.rackDomain !== "trunk" || !match.rackCode) return;
    if (match.invalidPortNumbers && match.invalidPortNumbers.length > 0) {
      invalidList.push({
        circuitId: circuit.id,
        circuitName: circuit.name,
        field,
        rackCode: match.rackCode,
        invalidPorts: match.invalidPortNumbers,
      });
      return;
    }
    const ports = match.resolvedPorts ?? [];
    if (ports.length === 0) return;
    const emptyPorts = ports.filter((p) => !p.inUse).map((p) => p.portNumber);
    const occupiedByOther = ports.filter((p) => p.inUse).map((p) => ({ portNumber: p.portNumber, circuitName: p.circuitName ?? "?" }));
    if (emptyPorts.length > 0) {
      mismatches.push({
        circuitId: circuit.id,
        circuitName: circuit.name,
        deviceName: circuit.deviceName,
        field,
        rawText,
        rackCode: match.rackCode,
        emptyPorts,
        occupiedByOther,
      });
    }
  }

  console.log("Đang tải dữ liệu port (cả trung kế + ODF/DDF nội bộ) và luồng thiết bị...");
  const trunkPorts: TrunkPortRow[] = await fetchAllOdfPorts();
  const circuits: DeviceCircuitRow[] = await fetchDeviceCircuits();
  console.log(`Tổng ${trunkPorts.length} port, ${circuits.length} luồng thiết bị.\n`);

  let ownMatchedTrunk = 0;
  let ownMatchedDevice = 0;
  let ownUnmatched = 0;
  let nextMatchedTrunk = 0;
  let nextMatchedDevice = 0;
  let nextUnmatched = 0;

  for (const c of circuits) {
    if (c.devicePositionOwn) {
      const m = matchTrunkPosition(c.devicePositionOwn, trunkPorts);
      if (m.matched && m.rackDomain === "trunk") ownMatchedTrunk++;
      else if (m.matched && m.rackDomain === "device") ownMatchedDevice++;
      else ownUnmatched++;
      checkMatch(c, "own", c.devicePositionOwn, m);
    }
    const nextOdf = odfPartOf(c.devicePositionNext);
    if (nextOdf) {
      const m = matchTrunkPosition(nextOdf, trunkPorts);
      if (m.matched && m.rackDomain === "trunk") nextMatchedTrunk++;
      else if (m.matched && m.rackDomain === "device") nextMatchedDevice++;
      else nextUnmatched++;
      checkMatch(c, "next", c.devicePositionNext ?? "", m);
    }
  }

  console.log("=== Thống kê khớp rack (own = Vị trí ODF thiết bị) ===");
  console.log(`  Khớp rack TRUNG KẾ thật: ${ownMatchedTrunk}`);
  console.log(`  Khớp rack ODF/DDF nội bộ (domain=device): ${ownMatchedDevice}`);
  console.log(`  Không khớp rack nào (text tự do/chưa có rack): ${ownUnmatched}`);

  console.log("\n=== Thống kê khớp rack (next = Vị trí ODF tiếp theo) ===");
  console.log(`  Khớp rack TRUNG KẾ thật: ${nextMatchedTrunk}`);
  console.log(`  Khớp rack ODF/DDF nội bộ (domain=device): ${nextMatchedDevice}`);
  console.log(`  Không khớp rack nào (text tự do/chưa có rack): ${nextUnmatched}`);

  console.log(`\n=== Port/sợi KHÔNG có thật trong rack đã khớp (lỗi gõ, ${invalidList.length} lượt) ===`);
  for (const it of invalidList) {
    console.log(`  - [${it.field}] "${it.circuitName}" (${it.circuitId}) -> rack "${it.rackCode}", port lỗi: ${it.invalidPorts.join(",")}`);
  }

  console.log(`\n=== CHƯA ĐỒNG BỘ: khớp rack TRUNG KẾ thật nhưng port đang TRỐNG (${mismatches.length} lượt) ===`);
  console.log("(Đúng loại lỗi người dùng phát hiện: dữ liệu thiết bị nói port này đã dùng, nhưng Hồ sơ ODF Trung kế lại trống.)\n");
  for (const m of mismatches) {
    console.log(
      `  - [${m.field}] "${m.circuitName}" (thiết bị: ${m.deviceName ?? "?"}) [id: ${m.circuitId}]\n` +
        `      Ghi: "${m.rawText}" -> rack thật "${m.rackCode}", port TRỐNG: ${m.emptyPorts.join(",")}` +
        (m.occupiedByOther.length > 0
          ? ` | port đã có luồng KHÁC: ${m.occupiedByOther.map((o) => `${o.portNumber}=${o.circuitName}`).join(", ")}`
          : "")
    );
  }

  console.log(`\n=== TÓM TẮT ===`);
  console.log(`Tổng ${mismatches.length} lượt "chưa đồng bộ" (port trung kế trống dù thiết bị ghi đã dùng).`);
  console.log(`Tổng ${invalidList.length} lượt ghi port/sợi không tồn tại thật trong rack đã khớp.`);

  // Tùy chọn xuất JSON (--json <path>) để dựng báo cáo/artifact xem trực
  // quan — không đổi hành vi mặc định (vẫn chỉ in console), thêm 2026-07-28
  // ngay khi cần render bảng cho người dùng rà soát.
  const jsonFlagIndex = process.argv.indexOf("--json");
  if (jsonFlagIndex !== -1 && process.argv[jsonFlagIndex + 1]) {
    const fs = await import("node:fs/promises");
    const outPath = process.argv[jsonFlagIndex + 1];
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          totals: { ports: trunkPorts.length, deviceCircuits: circuits.length },
          ownStats: { matchedTrunk: ownMatchedTrunk, matchedDevice: ownMatchedDevice, unmatched: ownUnmatched },
          nextStats: { matchedTrunk: nextMatchedTrunk, matchedDevice: nextMatchedDevice, unmatched: nextUnmatched },
          invalidList,
          mismatches,
        },
        null,
        2
      ),
      "utf-8"
    );
    console.log(`\nĐã ghi JSON: ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
