import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchDeviceCircuits, type DeviceCircuitRow } from "@/lib/deviceCircuits";
import { fetchDevices, type DeviceRow } from "@/lib/devices";
import { fetchDevicePositionMap, type DevicePositionMapRow } from "@/lib/devicePositionMap";
import { fetchAllOdfPorts } from "@/lib/trunkPorts";
import { fetchDeviceAliases, type DeviceAliasRow } from "@/lib/deviceAliases";
import { findUnlinkedMirrorPairs, findUnlinkedDeviceDevicePairs } from "@/lib/unlinkedMirrorPairs";
import { computeMirrorLinkStatuses } from "@/lib/mirrorLinkStatus";
import { findAllDeviceTrunkPairs } from "@/lib/circuitPairSync";
import DeviceCircuitList from "@/components/odf-device/DeviceCircuitList";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Xem giải thích ở app/odf-trunk/page.tsx — bắt buộc để không bị cache dữ
// liệu cũ.
export const dynamic = "force-dynamic";

// Tiêu đề tab trình duyệt theo đúng trang (yêu cầu người dùng 2026-08-08 —
// xem giải thích đầy đủ ở app/dashboard/page.tsx).
export const metadata: Metadata = { title: "Hồ sơ đấu nối" };

// Tách khỏi SuaLuongThietBiPage + bọc <Suspense> (tối ưu 2026-08-08, cùng đợt
// với app/odf-trunk/page.tsx và app/odf-trunk/[rackId]/page.tsx — xem
// architecture.md) — trunkPorts (fetchAllOdfPorts, TOÀN TRẠM) + các hàm rà
// soát thuần (findUnlinkedMirrorPairs/findAllDeviceTrunkPairs, nặng) chỉ phục
// vụ huy hiệu "Đã liên kết"/nút "Kiểm tra đồng bộ" trong từng dòng — bản thân
// DeviceCircuitList (circuits/devices/devicePositionMap/deviceAliases) không
// cần chờ chúng.
async function DeviceCircuitSection({
  supabase,
  circuits,
  devices,
  devicePositionMap,
  deviceAliases,
}: {
  supabase: SupabaseClient;
  circuits: DeviceCircuitRow[];
  devices: DeviceRow[];
  devicePositionMap: DevicePositionMapRow[];
  deviceAliases: DeviceAliasRow[];
}) {
  // fetchAllOdfPorts (không phải fetchAllTrunkPorts) — cần CẢ rack trung kế
  // lẫn ODF/DDF nội bộ (domain='device') để "Vị trí ODF (tiếp theo)" nhận
  // diện/chuẩn hóa được cả 2 loại (yêu cầu người dùng 2026-07-27).
  const trunkPorts = await fetchAllOdfPorts(supabase);
  // Huy hiệu "Đã liên kết"/"Chưa liên kết" trên từng dòng (yêu cầu người dùng
  // 2026-08-02) — tái dùng ĐÚNG 2 hàm rà soát đã có ở /data-quality (mục
  // 44/45), không viết thuật toán khác ở đây. Rẻ: không thêm round-trip
  // Supabase nào (xem lib/mirrorLinkStatus.ts).
  const [unlinkedMirrorPairs, unlinkedDeviceDevicePairs] = await Promise.all([
    findUnlinkedMirrorPairs(trunkPorts, circuits),
    findUnlinkedDeviceDevicePairs(circuits, devices),
  ]);
  const mirrorLinkStatuses = computeMirrorLinkStatuses(trunkPorts, circuits, unlinkedMirrorPairs, unlinkedDeviceDevicePairs);
  // Nút "Kiểm tra đồng bộ" ngay trong form sửa 1 luồng (yêu cầu người dùng
  // 2026-08-02 — xem lib/circuitPairSync.ts).
  const circuitPairDetails = await findAllDeviceTrunkPairs(trunkPorts, circuits, unlinkedMirrorPairs);

  return (
    <DeviceCircuitList
      circuits={circuits}
      devices={devices}
      devicePositionMap={devicePositionMap}
      trunkPorts={trunkPorts}
      mirrorLinkStatuses={mirrorLinkStatuses}
      circuitPairDetails={circuitPairDetails}
      deviceAliases={deviceAliases}
    />
  );
}

function DeviceCircuitSectionSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
      Đang tải danh sách luồng...
    </div>
  );
}

// Chuyển từ app/odf-device/page.tsx sang đây (yêu cầu người dùng 2026-07-28):
// "/odf-device" giờ là danh sách rack (Hồ sơ ODF Thiết bị mới, xem
// architecture.md) — trang PHẲNG (Thêm/Sửa/Xóa luồng) chuyển về đây. Đổi tên
// hiển thị "Sửa luồng thiết bị" -> "Hồ sơ đấu nối" (yêu cầu người dùng
// 2026-07-28, cùng đợt sửa Sidebar) — vẫn là nơi DUY NHẤT thao tác chi tiết
// luồng, chỉ đổi tên cho rõ nghĩa hơn.
export default async function SuaLuongThietBiPage() {
  const supabase = await createSupabaseServerClient();
  // 4 fetch nhẹ, độc lập với trunkPorts — đủ để hiện bảng + số đếm ngay.
  const [circuits, devices, devicePositionMap, deviceAliases] = await Promise.all([
    fetchDeviceCircuits(supabase),
    fetchDevices(supabase),
    fetchDevicePositionMap(supabase),
    fetchDeviceAliases(supabase),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ đấu nối</h1>
      <p className="text-slate-500 mt-1">Danh sách {circuits.length} luồng đấu nối tại thiết bị, xem/sửa/xóa ngay tại đây.</p>
      <p className="mt-2">
        <Link href="/devices" className="text-sm text-primary-600 hover:underline">
          → Chuẩn hóa / đổi tên thiết bị
        </Link>
      </p>
      <div className="mt-6">
        <Suspense fallback={<DeviceCircuitSectionSkeleton />}>
          <DeviceCircuitSection
            supabase={supabase}
            circuits={circuits}
            devices={devices}
            devicePositionMap={devicePositionMap}
            deviceAliases={deviceAliases}
          />
        </Suspense>
      </div>
    </div>
  );
}
