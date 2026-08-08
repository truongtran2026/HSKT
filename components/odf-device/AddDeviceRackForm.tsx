"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";
import RoleGate from "@/components/ui/RoleGate";

// Thêm rack ODF/DDF thiết bị MỚI (yêu cầu người dùng 2026-07-28: "Chưa có
// phần thêm/sửa/xóa Rack... Số port là nhập liệu ban đầu khi khởi tạo Rack
// này") — LUÔN domain='device' (component riêng cho trang này, không dùng
// chung cho trung kế — thêm rack trung kế rủi ro hơn nhiều vì đụng dữ liệu
// Excel gốc thật, ngoài phạm vi yêu cầu lần này, xem architecture.md mục 12
// bài học về domain). cable_route_name/fiber_number luôn null cho domain này
// (không có ý nghĩa ngoài trung kế, đúng quy ước 112 rack nội bộ đã tạo ở
// scripts/import-internal-odf-racks.ts).
export default function AddDeviceRackForm({ stationId }: { stationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [odfType, setOdfType] = useState<"welded" | "distribution">("distribution");
  const [portCount, setPortCount] = useState("48");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openForm() {
    setOpen(true);
    setCode("");
    setOdfType("distribution");
    setPortCount("48");
    setError(null);
  }

  async function submit() {
    const trimmedCode = code.trim();
    const count = Number(portCount);
    if (!trimmedCode) {
      setError("Nhập mã rack (vd: ODF3/9).");
      return;
    }
    if (!Number.isInteger(count) || count <= 0) {
      setError("Số port phải là số nguyên dương.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Kiểm tra trùng mã TRƯỚC khi insert (rà soát 2026-08-03) — schema chưa
      // có ràng buộc UNIQUE cho (station_id, code), toàn bộ cơ chế đối chiếu
      // vị trí (lib/trunkPorts.ts matchTrunkPosition()) giả định "1 mã rack =
      // 1 rack"; 2 rack trùng mã sẽ bị gộp port làm một và lấy nhầm domain,
      // triệu chứng xuất hiện ở nơi khác hoàn toàn (bảng đối chiếu báo sai)
      // nên rất khó lần ra nguyên nhân. Báo lỗi tiếng Việt rõ ràng ở đây thay
      // vì để rơi xuống lỗi Postgres thô.
      const { data: existing, error: checkErr } = await supabase
        .from("racks")
        .select("id, code, domain")
        .eq("station_id", stationId)
        .eq("code", trimmedCode)
        .maybeSingle();
      if (checkErr) throw checkErr;
      if (existing) {
        setError(
          `Đã có rack mã "${trimmedCode}" (${
            existing.domain === "trunk" ? "ODF trung kế" : "ODF/DDF thiết bị"
          }). Mã rack phải là duy nhất — chọn mã khác hoặc mở rack đã có để sửa.`
        );
        setBusy(false);
        return;
      }
      const { data: newRack, error: rackErr } = await supabase
        .from("racks")
        .insert({
          station_id: stationId,
          code: trimmedCode,
          domain: "device",
          odf_type: odfType,
          port_count: count,
          cable_route_name: null,
        })
        .select("id")
        .single();
      if (rackErr) throw rackErr;
      const newRackId = newRack.id as string;
      const rows = Array.from({ length: count }, (_, i) => ({
        rack_id: newRackId,
        port_number: i + 1,
        fiber_number: null,
        medium: "fiber" as const,
        status: "unused" as const,
      }));
      const { error: portErr } = await supabase.from("ports").insert(rows);
      if (portErr) throw portErr;
      router.push(`/odf-trunk/${newRackId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Phòng hờ (2026-08-03): kiểm tra trước ở trên đã chặn hầu hết trường
      // hợp, nhưng vẫn có thể lọt qua nếu 2 người tạo cùng lúc — dịch mã lỗi
      // trùng khóa Postgres sang tiếng Việt thay vì để lộ nguyên văn.
      setError(
        msg.includes("23505") || msg.toLowerCase().includes("duplicate key")
          ? `Mã rack "${trimmedCode}" đã tồn tại — mã rack phải là duy nhất.`
          : translatePgError(msg)
      );
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <RoleGate allow={["operator", "admin"]}>
        <button type="button" className="btn-secondary" onClick={openForm}>
          + Thêm rack mới
        </button>
      </RoleGate>
    );
  }

  return (
    <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-4">
      <p className="mb-3 text-sm font-medium text-primary-800">Thêm rack ODF/DDF thiết bị mới</p>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-500">
          <span className="block mb-1">Mã rack</span>
          <input className="input w-40" placeholder="VD: ODF3/9" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </label>
        <label className="text-xs text-slate-500">
          <span className="block mb-1">Loại ODF</span>
          <select className="input w-auto" value={odfType} onChange={(e) => setOdfType(e.target.value as "welded" | "distribution")}>
            <option value="distribution">Phân phối</option>
            <option value="welded">Hàn nối</option>
          </select>
        </label>
        <label className="text-xs text-slate-500">
          <span className="block mb-1">Số port</span>
          <input type="number" className="input w-24" min={1} value={portCount} onChange={(e) => setPortCount(e.target.value)} />
        </label>
        <button className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Đang tạo..." : "Tạo rack"}
        </button>
        <button className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Hủy
        </button>
      </div>
    </div>
  );
}
