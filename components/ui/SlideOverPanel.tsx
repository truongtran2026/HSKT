"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Panel trượt từ phải (yêu cầu người dùng 2026-07-29, "Giai đoạn 2") — dùng
// cho các chỗ cần "xem/sửa nhanh 1 thứ liên quan" (thiết bị đối phương, port
// trung kế đích...) mà KHÔNG muốn rời trang đang làm việc (khác điều hướng
// full-page qua <Link>, vốn mất hết context/vị trí đang cuộn/đang sửa dở).
// z-50 — CAO HƠN Sidebar lúc bỏ ghim (z-40, xem Sidebar.tsx) để panel luôn
// nổi lên trên, kể cả khi đang rê chuột mở tạm Sidebar. Đóng bằng phím ESC
// hoặc bấm ra ngoài (backdrop) — không đổi URL (yêu cầu người dùng: "không
// cần chia sẻ link được ngay", để đơn giản trước).
export default function SlideOverPanel({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // document.body chỉ tồn tại ở trình duyệt — Next.js vẫn render Client
  // Component này ở server 1 lần trước khi hydrate, gọi document.body lúc đó
  // sẽ lỗi. Chỉ portal sau khi đã mount xong ở client (useEffect luôn chạy
  // sau lần render đầu, đúng lúc document đã có thật).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  // Portal thẳng vào document.body (yêu cầu người dùng 2026-07-29) — panel
  // này được gọi từ nhiều nơi, có chỗ (EditRow trong PortTable.tsx) trả về
  // 1 <tr>, nếu không portal thì <aside>/<div> ở đây sẽ thành con trực tiếp
  // của <tbody> — sai cấu trúc HTML bảng, trình duyệt có thể tự "sửa" DOM
  // theo cách khó đoán. position:fixed vốn không phụ thuộc vị trí lồng trong
  // cây DOM nên portal ra ngoài không ảnh hưởng gì tới cách hiển thị.
  return createPortal(
    <>
      {open && <div className="fixed inset-0 z-50 bg-slate-900/30" onClick={onClose} aria-hidden="true" />}
      <aside
        className={
          "fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-200 " +
          (open ? "translate-x-0" : "translate-x-full")
        }
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
          >
            Đóng ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>,
    document.body
  );
}
