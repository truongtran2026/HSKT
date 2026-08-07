"use client";

import { useState } from "react";
import SearchClient, { type SearchRow } from "@/components/search/SearchClient";
import DeviceSearchClient from "@/components/search/DeviceSearchClient";
import type { DeviceCircuitRow } from "@/lib/deviceCircuits";

// Chuyển đổi giữa 2 domain ở trang Tìm kiếm nhanh (yêu cầu người dùng
// 2026-08-08: "Xem tất cả kết quả tìm kiếm" trước đây CHỈ có ODF trung kế,
// thiếu hẳn Hồ sơ đấu nối thiết bị). Tách 2 bảng riêng thay vì gộp chung 1
// bảng — 2 domain có cấu trúc cột khác hẳn nhau (trung kế có Port/Sợi/Trạng
// thái cổng trống thật; thiết bị chỉ có vị trí ODF dạng text, không có khái
// niệm "cổng trống"), gộp cưỡng ép sẽ ra bảng có nhiều cột rỗng vô nghĩa.
type Tab = "trunk" | "device";

export default function SearchTabs({ trunkRows, deviceRows }: { trunkRows: SearchRow[]; deviceRows: DeviceCircuitRow[] }) {
  const [tab, setTab] = useState<Tab>("trunk");

  return (
    <div>
      <div className="mb-4 flex gap-1">
        {(
          [
            ["trunk", `ODF trung kế (${trunkRows.length})`],
            ["device", `Hồ sơ đấu nối (${deviceRows.length})`],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-md px-3 py-1.5 text-sm border " +
              (tab === t ? "bg-primary-600 text-white border-primary-600" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "trunk" ? <SearchClient rows={trunkRows} /> : <DeviceSearchClient rows={deviceRows} />}
    </div>
  );
}
