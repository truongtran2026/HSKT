import Link from "next/link";
import type { MirrorLinkStatus } from "@/lib/mirrorLinkStatus";
import { IconLink, IconLinkOff } from "@/components/ui/icons";

// Thay cho MirrorLinkBadge.tsx cũ (yêu cầu người dùng 2026-08-08: bỏ ký hiệu
// "🔗 Đã liên kết"/"⚠️ Chưa liên kết" gắn ngay cạnh TÊN luồng, chuyển thành 1
// CỘT riêng "Trạng thái" — xem PortTable.tsx/DeviceCircuitList.tsx). SỬA
// cùng ngày (người dùng: "không cần phải ghi là đã hay chưa liên kết; chỉ
// cần biểu tượng là hiểu rồi") — bỏ hẳn chữ, CHỈ còn icon + màu, giữ `title`
// (tooltip khi rê chuột) để vẫn tra được ý nghĩa khi cần. 3 màu phân biệt 3
// trạng thái thật (khớp đúng lib/mirrorLinkStatus.ts):
// emerald = đã liên kết, amber = có gợi ý nhưng chưa liên kết (candidate),
// slate = không có gì để đối chiếu (không phải lỗi).
//
// `circuitId` — khi có VÀ status="linked", bấm icon nhảy tới /circuit/[id]
// (trang so sánh 2 hồ sơ cạnh nhau), giữ đúng hành vi cũ của MirrorLinkBadge.
export default function MirrorLinkStatusIcon({ status, circuitId }: { status: MirrorLinkStatus | undefined; circuitId?: string }) {
  if (status === "linked") {
    const el = (
      <IconLink
        className="h-4 w-4 text-emerald-600"
        aria-label="Đã liên kết"
      />
    );
    return circuitId ? (
      <Link
        href={`/circuit/${circuitId}`}
        title="Đã liên kết mirror thật (mirror_of_id) — xóa 1 bên sẽ tự xóa theo bên kia. Bấm để xem chi tiết."
        className="inline-flex hover:opacity-70"
      >
        {el}
      </Link>
    ) : (
      <span title="Đã liên kết mirror thật (mirror_of_id) — xóa 1 bên sẽ tự xóa theo bên kia.">{el}</span>
    );
  }
  if (status === "candidate") {
    return (
      <span
        className="inline-flex"
        title="Chưa liên kết — nhưng phát hiện 1 luồng khác khớp vị trí, có thể là cùng 1 luồng. Vào Chất lượng dữ liệu (tab Thiết bị-Trung kế/Thiết bị-Thiết bị chưa liên kết) để xác nhận."
      >
        <IconLinkOff className="h-4 w-4 text-amber-600" aria-label="Chưa liên kết, có gợi ý" />
      </span>
    );
  }
  return (
    <span
      className="inline-flex"
      title="Chưa liên kết — không có vị trí nào để đối chiếu (vd trỏ ra trạm khác không quản lý), không phải lỗi/thiếu sót."
    >
      <IconLinkOff className="h-4 w-4 text-slate-400" aria-label="Chưa liên kết" />
    </span>
  );
}
