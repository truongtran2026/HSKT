import Link from "next/link";
import type { MirrorLinkStatus } from "@/lib/mirrorLinkStatus";
import { IconLink, IconLinkOff } from "@/components/ui/icons";

// Thay cho MirrorLinkBadge.tsx cũ (yêu cầu người dùng 2026-08-08: bỏ ký hiệu
// "🔗 Đã liên kết"/"⚠️ Chưa liên kết" gắn ngay cạnh TÊN luồng, chuyển thành 1
// CỘT riêng dạng icon, lọc được — xem PortTable.tsx/DeviceCircuitList.tsx cột
// "Liên kết"). Vẫn giữ NGUYÊN 3 trạng thái nội bộ (linked/candidate/không có
// gì) từ lib/mirrorLinkStatus.ts, chỉ gộp "candidate" + "không có gì" lại
// thành chữ hiển thị/lọc "Chưa liên kết" (đúng yêu cầu chỉ 2 trạng thái lọc)
// — màu/tooltip vẫn phân biệt candidate (có gợi ý, màu hổ phách) với không có
// gì để đối chiếu (màu xám, không phải lỗi).
//
// `circuitId` — khi có VÀ status="linked", bấm icon nhảy tới /circuit/[id]
// (trang so sánh 2 hồ sơ cạnh nhau), giữ đúng hành vi cũ của MirrorLinkBadge.
export default function MirrorLinkStatusIcon({ status, circuitId }: { status: MirrorLinkStatus | undefined; circuitId?: string }) {
  if (status === "linked") {
    const el = (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-emerald-600"
        title="Đã liên kết mirror thật (mirror_of_id) — xóa 1 bên sẽ tự xóa theo bên kia. Bấm để xem chi tiết."
      >
        <IconLink className="h-3.5 w-3.5" />
        Đã liên kết
      </span>
    );
    return circuitId ? (
      <Link href={`/circuit/${circuitId}`} className="hover:underline">
        {el}
      </Link>
    ) : (
      el
    );
  }
  if (status === "candidate") {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap text-amber-600"
        title="Phát hiện 1 luồng khác khớp vị trí nhưng CHƯA liên kết — vào Chất lượng dữ liệu (tab Thiết bị-Trung kế/Thiết bị-Thiết bị chưa liên kết) để xác nhận."
      >
        <IconLinkOff className="h-3.5 w-3.5" />
        Chưa liên kết
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-slate-300"
      title="Không có vị trí nào để đối chiếu (vd trỏ ra trạm khác không quản lý) — không phải lỗi/thiếu sót."
    >
      <IconLinkOff className="h-3.5 w-3.5" />
      Chưa liên kết
    </span>
  );
}
