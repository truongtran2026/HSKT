"use client";

import { useMemo, useState } from "react";
import { formatRackCodeDisplay } from "@/lib/rackCode";
import { supabase } from "@/lib/supabase";
import { fetchAllOdfPorts, transitDisplay, type TrunkPortRow } from "@/lib/trunkPorts";
import { fetchDeviceCircuits } from "@/lib/deviceCircuits";
import { fetchDevices } from "@/lib/devices";
import { findUnlinkedMirrorPairs, findUnlinkedDeviceDevicePairs } from "@/lib/unlinkedMirrorPairs";
import { computeMirrorLinkStatuses, mirrorLinkStatusLabel } from "@/lib/mirrorLinkStatus";
import { exportMultiSheetExcel, type ExcelColumn } from "@/lib/exportExcel";
import RackListTable, { type RackListItem } from "@/components/odf-trunk/RackListTable";
import GroupedMultiSelect from "@/components/ui/GroupedMultiSelect";
import EmptyUntilFiltered from "@/components/ui/EmptyUntilFiltered";

// Slicer theo tuyến cáp cho "/odf-trunk" (yêu cầu người dùng 2026-08-08 —
// trang này trước đây hiện thẳng 41 rack, không có cách lọc phạm vi trước).
// Tái dùng NGUYÊN GroupedMultiSelect y hệt cách ImportExportClient.tsx đã
// dùng cho rack trung kế (item/rack, nhóm theo tuyến cáp — vừa chọn được
// theo rack lẻ, vừa chọn được cả tuyến cùng lúc).
//
// LƯU Ý: GroupedMultiSelect coi `selected=null` là "đã chọn tất cả" (mặc định
// hiện mọi checkbox đã tick) — nhưng KHÔNG được để mặc định hiện bảng theo
// đúng nghĩa đó (mục tiêu là mặc định TRỐNG). Tách riêng `viewAll` để biết
// người dùng ĐÃ chủ động bấm "Xem tất cả" hay chưa — chỉ khi đó (hoặc khi
// selectedRackIds đã có giá trị cụ thể do tự tick/bỏ tick) mới hiện bảng.

interface ExportRow {
  port: number;
  fiber: number | null;
  name: string;
  status: string;
  interfaceType: string;
  transit: string;
  counterpart: string;
  responsePlan: string;
  station: string;
  notes: string;
}

const EXPORT_COLUMNS: ExcelColumn<ExportRow>[] = [
  { label: "Port", getValue: (r) => r.port },
  { label: "Sợi", getValue: (r) => r.fiber },
  { label: "Tên luồng", getValue: (r) => r.name },
  { label: "Trạng thái", getValue: (r) => r.status },
  { label: "Giao tiếp", getValue: (r) => r.interfaceType },
  { label: "Chuyển tiếp", getValue: (r) => r.transit },
  { label: "Đối phương", getValue: (r) => r.counterpart },
  { label: "PA ứng cứu", getValue: (r) => r.responsePlan },
  { label: "Trạm thực hiện", getValue: (r) => r.station },
  { label: "Ghi chú", getValue: (r) => r.notes },
];

export default function TrunkRackListPanel({ racks }: { racks: RackListItem[] }) {
  const [selectedRackIds, setSelectedRackIds] = useState<string[] | null>(null);
  const [viewAll, setViewAll] = useState(false);
  const scopeChosen = viewAll || selectedRackIds !== null;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const items = useMemo(
    () => racks.map((r) => ({ value: r.id, label: formatRackCodeDisplay(r.code), group: r.cableRouteName ?? "(không có tuyến)" })),
    [racks]
  );
  const effectiveRacks = selectedRackIds === null ? racks : racks.filter((r) => selectedRackIds.includes(r.id));

  // Xuất Excel CHI TIẾT từng port/sợi/tên luồng... của NHIỀU rack cùng lúc
  // (yêu cầu người dùng 2026-08-09: trước đây chỉ export được từng bảng của
  // 1 ODF khi bấm vào chi tiết đúng rack đó — muốn xuất cả 1 tuyến cáp hoặc
  // vài rack lẻ tự chọn cùng lúc). Dùng ĐÚNG bộ chọn "Tuyến cáp / rack" ở
  // trên làm phạm vi xuất (không cần chọn lại lần 2) — mỗi rack 1 sheet riêng
  // (người dùng chọn khi được hỏi, xem architecture.md).
  //
  // Toàn bộ tính toán nặng (fetchAllOdfPorts/fetchDeviceCircuits quét CẢ
  // TRẠM + computeMirrorLinkStatuses) CHỈ chạy khi bấm nút này — KHÔNG chạy
  // sẵn lúc vào trang /odf-trunk, giữ đúng tinh thần tối ưu tải trang đã làm
  // ở Mục 81/82 (trang danh sách rack không trả giá cho dữ liệu nó không cần
  // hiển thị). Các hàm gọi ở đây (fetchAllOdfPorts, fetchDeviceCircuits,
  // fetchDevices, findUnlinkedMirrorPairs, findUnlinkedDeviceDevicePairs,
  // computeMirrorLinkStatuses) là ĐÚNG y hệt logic
  // app/odf-trunk/[rackId]/page.tsx dùng để tính trunkPorts/mirrorLinkStatuses
  // cho PortTable.tsx — các hàm này vốn đã nhận SupabaseClient làm tham số
  // (không cố định server/browser, xem comment ở lib/trunkPorts.ts), nên gọi
  // thẳng được từ Client Component này, không cần thêm Server Action/Route
  // Handler riêng.
  async function exportDetail() {
    if (effectiveRacks.length === 0) return;
    setExporting(true);
    setExportError(null);
    try {
      const [trunkPorts, deviceCircuits, devices] = await Promise.all([
        fetchAllOdfPorts(supabase),
        fetchDeviceCircuits(supabase),
        fetchDevices(supabase),
      ]);
      const [unlinkedMirrorPairs, unlinkedDeviceDevicePairs] = await Promise.all([
        findUnlinkedMirrorPairs(trunkPorts, deviceCircuits),
        findUnlinkedDeviceDevicePairs(deviceCircuits, devices),
      ]);
      const mirrorLinkStatuses = computeMirrorLinkStatuses(trunkPorts, deviceCircuits, unlinkedMirrorPairs, unlinkedDeviceDevicePairs);

      const portsByRack = new Map<string, TrunkPortRow[]>();
      for (const p of trunkPorts) {
        const list = portsByRack.get(p.rackId);
        if (list) list.push(p);
        else portsByRack.set(p.rackId, [p]);
      }

      const sheets = effectiveRacks.map((rack) => {
        const ports = (portsByRack.get(rack.id) ?? []).slice().sort((a, b) => a.portNumber - b.portNumber);
        const rows: ExportRow[] = ports.map((p) => ({
          port: p.portNumber,
          fiber: p.fiberNumber,
          name: p.circuit?.name ?? "",
          status: p.circuit ? mirrorLinkStatusLabel(mirrorLinkStatuses[p.circuit.id]) : "",
          interfaceType: p.circuit?.interfaceType ?? "",
          transit: transitDisplay(p.transitText, trunkPorts),
          counterpart: p.circuit?.counterpartText ?? "",
          responsePlan: p.circuit?.responsePlanText ?? "",
          station: p.circuit?.executionStationText ?? "",
          notes: p.circuit?.notes ?? "",
        }));
        return { sheetName: formatRackCodeDisplay(rack.code), rows };
      });

      exportMultiSheetExcel(sheets, EXPORT_COLUMNS, "ODF_trung_ke_chi_tiet_nhieu_rack");
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <GroupedMultiSelect items={items} selected={selectedRackIds} onChange={setSelectedRackIds} buttonLabel="Tuyến cáp / rack" />
        <button
          type="button"
          className="btn-secondary"
          onClick={exportDetail}
          disabled={exporting || effectiveRacks.length === 0}
          title="Xuất chi tiết từng port/sợi/tên luồng của các rack đang chọn ở trên — mỗi rack 1 sheet riêng"
        >
          {exporting ? "Đang xuất..." : `Xuất chi tiết (${effectiveRacks.length} rack)`}
        </button>
      </div>
      {exportError && <p className="mb-3 text-sm text-red-600">Lỗi xuất Excel: {exportError}</p>}
      <EmptyUntilFiltered active={scopeChosen} onShowAll={() => setViewAll(true)} prompt="Chọn tuyến cáp/rack ở trên để xem, hoặc">
        <RackListTable racks={effectiveRacks} />
      </EmptyUntilFiltered>
    </div>
  );
}
