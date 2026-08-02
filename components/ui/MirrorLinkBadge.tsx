import type { MirrorLinkStatus } from "@/lib/mirrorLinkStatus";

// Huy hiệu nhỏ dùng chung cho PortTable.tsx (dòng port) và DeviceCircuitList.tsx
// (dòng luồng) — xem lib/mirrorLinkStatus.ts để hiểu 2 trạng thái. `undefined`
// (không có trong Map trạng thái) -> không hiện gì (không phải lỗi/thiếu sót,
// đơn giản là không có vị trí liên quan để đối chiếu, vd trỏ ra trạm khác).
export default function MirrorLinkBadge({ status }: { status: MirrorLinkStatus | undefined }) {
  if (status === "linked") {
    return (
      <span
        className="ml-1 shrink-0 rounded bg-emerald-100 px-1 py-0.5 text-[10px] font-medium text-emerald-700"
        title="Đã liên kết mirror thật (mirror_of_id) — xóa 1 bên sẽ tự xóa theo bên kia."
      >
        🔗 Đã liên kết
      </span>
    );
  }
  if (status === "candidate") {
    return (
      <span
        className="ml-1 shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-700"
        title="Phát hiện 1 luồng khác khớp vị trí nhưng CHƯA liên kết — vào Chất lượng dữ liệu (tab Thiết bị-Trung kế/Thiết bị-Thiết bị chưa liên kết) để xác nhận."
      >
        ⚠️ Chưa liên kết
      </span>
    );
  }
  return null;
}
