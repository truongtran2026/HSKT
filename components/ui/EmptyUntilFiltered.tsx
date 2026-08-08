"use client";

// Khung "chưa chọn gì thì chưa hiện bảng" dùng chung (yêu cầu người dùng
// 2026-08-08: bảng đang hiện HẾT dữ liệu ngay lúc mở tab làm chậm — mặc định
// nên trống, chỉ hiện khi người dùng chọn phạm vi hoặc bấm "Xem tất cả").
// Bảng gọi tự quyết định `active` (đã chọn phạm vi HAY đã bấm "Xem tất cả")
// — component này chỉ lo hiển thị, không giữ state.
export default function EmptyUntilFiltered({
  active,
  onShowAll,
  prompt,
  children,
}: {
  active: boolean;
  onShowAll: () => void;
  prompt: string;
  children: React.ReactNode;
}) {
  if (active) return <>{children}</>;
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
      <p>{prompt}</p>
      <button type="button" className="btn-secondary mt-3" onClick={onShowAll}>
        Xem tất cả
      </button>
    </div>
  );
}
