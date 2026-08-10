"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { IconRefresh } from "@/components/ui/icons";

// Nút "Làm mới dữ liệu" dùng chung cho mọi bảng (yêu cầu người dùng
// 2026-08-10): dữ liệu bảng chỉ tải 1 lần lúc vào trang (Server Component) —
// nếu 1 tab trình duyệt KHÁC vừa thêm/sửa dữ liệu (vd thêm thiết bị mới, sửa
// thư viện vị trí thiết bị) thì tab đang mở không tự biết, phải bấm F5 tải
// lại NGUYÊN trang mới thấy dữ liệu mới — mất luôn cả form đang gõ dở/dòng
// đang Sửa nếu có.
//
// KHÔNG polling định kỳ (đúng yêu cầu người dùng) — chỉ chạy lại khi người
// dùng CHỦ ĐỘNG bấm nút này. `router.refresh()` (Next.js App Router) chạy
// lại (các) Server Component của route hiện tại và lấy props MỚI, nhưng GIỮ
// NGUYÊN state phía Client Component (form đang gõ dở, dòng đang Sửa, tick
// đã chọn...) vì không remount cây component — đây CHÍNH LÀ cơ chế mọi form
// Thêm/Sửa/Xóa trong app đã dùng SAU KHI lưu thành công (vd
// DeviceCircuitList.tsx, PortTable.tsx...), giờ thêm 1 nút bấm tay để gọi lại
// đúng cơ chế đó bất kỳ lúc nào — kể cả khi đang mở form Thêm/Sửa (props mới
// gồm cả `devices`/`devicePositionMap`/`trunkPorts` dùng để gợi ý trong form
// đó cũng được làm mới theo, KHÔNG xóa các ô đang gõ dở vì đó là state riêng
// của form, không phải props).
export default function RefreshButton({
  title = "Làm mới dữ liệu — lấy bản mới nhất từ CSDL (vd nếu vừa thêm/sửa ở tab trình duyệt khác), không tải lại cả trang",
}: {
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      className="btn-secondary px-2 py-1.5"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      title={title}
      aria-label="Làm mới dữ liệu"
    >
      <IconRefresh className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
    </button>
  );
}
