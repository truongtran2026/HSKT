"use client";

import { useMemo, useState } from "react";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import { exportTrunkExcel, exportDeviceExcel } from "@/lib/exportExcel";
import { deviceCategoryLabel, UNCATEGORIZED_LABEL, type DeviceRow } from "@/lib/devices";
import type { TrunkExportRow } from "@/lib/trunkExportData";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

// Xuất Excel (yêu cầu người dùng 2026-08-07, Export trước — Import để đợt
// sau). 2 khối độc lập, mỗi khối tự chọn phạm vi rồi xuất — dữ liệu đã tải
// hết 1 lần ở page.tsx (Server Component), lọc phạm vi làm ở đây, không phải
// gọi lại Supabase mỗi lần đổi lựa chọn.
export default function ImportExportClient({
  trunkRows,
  deviceRows,
  devices,
}: {
  trunkRows: TrunkExportRow[];
  deviceRows: DeviceCircuitRow[];
  devices: DeviceRow[];
}) {
  // Khối ODF trung kế — items = rack (label=mã rack, group=tên tuyến cáp),
  // đủ để vừa chọn "theo rack" (bỏ tick 1 rack) vừa "theo tuyến cáp" (gõ tìm
  // tên tuyến, bấm "Chọn tất cả" trong nhóm lọc), không cần 2 UI riêng.
  const rackItems = useMemo(() => {
    const seen = new Map<string, string>(); // rackId -> label "code | tuyến"
    for (const r of trunkRows) if (!seen.has(r.rackId)) seen.set(r.rackId, r.rackCode);
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([rackId, code]) => ({
        value: rackId,
        label: code,
        group: trunkRows.find((r) => r.rackId === rackId)?.rackCableRouteName ?? "(không có tuyến)",
      }));
  }, [trunkRows]);
  // "Toàn trạm" là 1 checkbox RIÊNG, tách khỏi ngữ nghĩa ngầm "selected=null"
  // của GroupedMultiSelect (yêu cầu người dùng 2026-08-08: bấm "Chọn tất cả"
  // trong dropdown 41 rack không rõ ràng/không tìm thấy) — mặc định BẬT
  // (đúng là chọn hết), tắt đi mới hiện khung chọn rack cụ thể. Rõ ràng hơn
  // nhiều so với việc phải hiểu "để trống nghĩa là chọn hết".
  const [wholeStationTrunk, setWholeStationTrunk] = useState(true);
  const [selectedRackIds, setSelectedRackIds] = useState<string[] | null>(null);
  const effectiveRackIds = wholeStationTrunk ? null : selectedRackIds;
  const trunkCount = effectiveRackIds === null ? trunkRows.length : trunkRows.filter((r) => effectiveRackIds.includes(r.rackId)).length;

  // Khối Hồ sơ đấu nối — items = tên thiết bị (nhóm theo Lĩnh vực), ĐÚNG
  // quy ước lọc đã có sẵn ở DeviceCircuitList.tsx (theo thiết bị/lĩnh vực,
  // KHÔNG theo rack — circuits không có FK thật tới rack/port, xem
  // lib/deviceCircuits.ts).
  const categoryByDeviceName = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of devices) map.set(d.name, deviceCategoryLabel(d.category));
    return map;
  }, [devices]);
  const deviceItems = useMemo(() => {
    const set = new Set<string>();
    for (const c of deviceRows) set.add(c.deviceName ?? "(chưa xác định)");
    return [...set]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ value: name, label: name, group: categoryByDeviceName.get(name) ?? UNCATEGORIZED_LABEL }));
  }, [deviceRows, categoryByDeviceName]);
  const [wholeStationDevice, setWholeStationDevice] = useState(true);
  const [selectedDeviceNames, setSelectedDeviceNames] = useState<string[] | null>(null);
  const effectiveDeviceNames = wholeStationDevice ? null : selectedDeviceNames;
  const deviceCount =
    effectiveDeviceNames === null ? deviceRows.length : deviceRows.filter((r) => r.deviceName !== null && effectiveDeviceNames.includes(r.deviceName)).length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-primary-800">ODF trung kế</h2>
        <p className="mt-1 text-sm text-slate-500">
          Xuất đúng cấu trúc cột file gốc (Rack-sub ODF / Port / Sợi / Tên luồng / Giao tiếp / Chuyển tiếp / Đối phương / Phương án ứng cứu / Trạm thực
          hiện / Ghi chú), mỗi port 1 dòng.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={wholeStationTrunk} onChange={(e) => setWholeStationTrunk(e.target.checked)} />
            Toàn trạm (tất cả {rackItems.length} rack)
          </label>
          {!wholeStationTrunk && (
            <GroupedMultiSelect items={rackItems} selected={selectedRackIds} onChange={setSelectedRackIds} buttonLabel="Chọn rack/tuyến cáp" />
          )}
          <span className="text-sm text-slate-500">Sẽ xuất {trunkCount} dòng.</span>
          <button type="button" className="btn-primary" onClick={() => exportTrunkExcel(trunkRows, effectiveRackIds)} disabled={trunkCount === 0}>
            Xuất Excel
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-primary-800">Hồ sơ đấu nối (thiết bị)</h2>
        <p className="mt-1 text-sm text-slate-500">
          Xuất theo cấu trúc cột hiện tại của trang Hồ sơ đấu nối (Tên luồng / Trib / Thiết bị / Vị trí ODF thiết bị / Vị trí ODF tiếp theo / Giao tiếp /
          Đối phương / Ghi chú).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={wholeStationDevice} onChange={(e) => setWholeStationDevice(e.target.checked)} />
            Tất cả thiết bị ({deviceItems.length})
          </label>
          {!wholeStationDevice && (
            <GroupedMultiSelect items={deviceItems} selected={selectedDeviceNames} onChange={setSelectedDeviceNames} buttonLabel="Chọn thiết bị/lĩnh vực" />
          )}
          <span className="text-sm text-slate-500">Sẽ xuất {deviceCount} dòng.</span>
          <button type="button" className="btn-primary" onClick={() => exportDeviceExcel(deviceRows, effectiveDeviceNames)} disabled={deviceCount === 0}>
            Xuất Excel
          </button>
        </div>
      </div>
    </div>
  );
}
