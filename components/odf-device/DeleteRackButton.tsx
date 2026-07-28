"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Xóa hẳn 1 rack ODF/DDF thiết bị (yêu cầu người dùng 2026-07-28) — CHỈ dùng
// cho domain='device' (xem app/odf-trunk/[rackId]/page.tsx, chỉ render nút
// này khi rack.domain==='device'). Đã kiểm chứng thật trên DB trước khi làm
// (script tạm, xóa sau khi chạy xong): port_circuit_links VÀ transit_links
// đều KHÔNG có dòng nào trỏ tới port của rack domain='device' (0/0/5424 port
// — luồng thiết bị chỉ tham chiếu qua text device_position_own/next, không
// bao giờ tạo bảng nối thật, xem lib/deviceRackPorts.ts) — nên chỉ cần xóa
// đúng 2 bảng ports + racks, không cần dọn thêm gì khác. Các luồng thiết bị
// đang ghi vị trí trỏ tới rack này qua text (nếu có) KHÔNG bị xóa theo — vị
// trí ghi trong đó chỉ đơn giản không còn khớp rack nào nữa, cần tự rà lại
// nếu cần (không có cách tự động dọn text tự do, đã nói rõ trong dialog xác
// nhận bên dưới).
export default function DeleteRackButton({ rackId, rackCode }: { rackId: string; rackCode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const ok = confirm(
      `Xóa hẳn rack "${rackCode}" và toàn bộ port của nó? Không thể hoàn tác.\n\n` +
        `Lưu ý: nếu có luồng thiết bị đang ghi vị trí trỏ tới rack này (Vị trí ODF/Vị trí ODF tiếp theo), ` +
        `dữ liệu đó KHÔNG tự xóa/sửa theo — sẽ trở thành vị trí không còn khớp rack nào, cần tự rà lại sau nếu cần.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const { error: portErr } = await supabase.from("ports").delete().eq("rack_id", rackId);
    if (portErr) {
      setBusy(false);
      setError(portErr.message);
      return;
    }
    const { error: rackErr } = await supabase.from("racks").delete().eq("id", rackId);
    if (rackErr) {
      setBusy(false);
      setError(rackErr.message);
      return;
    }
    router.push("/odf-device");
  }

  return (
    <div className="mt-2">
      {error && <p className="mb-1 text-sm text-red-600">Lỗi: {error}</p>}
      <button
        type="button"
        className="text-sm text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-300"
        onClick={handleDelete}
        disabled={busy}
      >
        {busy ? "Đang xóa..." : "Xóa rack này"}
      </button>
    </div>
  );
}
