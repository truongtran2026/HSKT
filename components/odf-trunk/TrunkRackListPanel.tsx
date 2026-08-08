"use client";

import { useMemo, useState } from "react";
import { formatRackCodeDisplay } from "@/lib/rackCode";
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
export default function TrunkRackListPanel({ racks }: { racks: RackListItem[] }) {
  const [selectedRackIds, setSelectedRackIds] = useState<string[] | null>(null);
  const [viewAll, setViewAll] = useState(false);
  const scopeChosen = viewAll || selectedRackIds !== null;

  const items = useMemo(
    () => racks.map((r) => ({ value: r.id, label: formatRackCodeDisplay(r.code), group: r.cableRouteName ?? "(không có tuyến)" })),
    [racks]
  );
  const effectiveRacks = selectedRackIds === null ? racks : racks.filter((r) => selectedRackIds.includes(r.id));

  return (
    <div>
      <div className="mb-3">
        <GroupedMultiSelect items={items} selected={selectedRackIds} onChange={setSelectedRackIds} buttonLabel="Tuyến cáp / rack" />
      </div>
      <EmptyUntilFiltered active={scopeChosen} onShowAll={() => setViewAll(true)} prompt="Chọn tuyến cáp/rack ở trên để xem, hoặc">
        <RackListTable racks={effectiveRacks} />
      </EmptyUntilFiltered>
    </div>
  );
}
