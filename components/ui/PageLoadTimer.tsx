"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

// Hiện thời gian tải trang hiện tại (yêu cầu người dùng 2026-08-08: "việc
// load xong trang thì chưa có gì đo đếm được, cho tôi 1 vị trí phù hợp") —
// mount 1 LẦN DUY NHẤT ở app/layout.tsx (giống CommandPalette) để có mặt trên
// MỌI trang, không lặp lại từng page.tsx.
//
// Next.js 14 App Router CHƯA có hook chính thức đo thời gian điều hướng giữa
// 2 trang (chỉ Navigation Timing API cho LẦN TẢI ĐẦU/F5 cứng) — cách đo ở đây
// là gần đúng tốt nhất có thể mà KHÔNG thêm thư viện ngoài (web-vitals...):
// bắt thời điểm BẤM vào 1 link nội bộ (capture phase, mọi <a href="/...">
// trong cây, kể cả Sidebar/bảng/nút "→ ..."), rồi tính khoảng cách tới lúc
// usePathname() đổi sang route mới (nghĩa là phần CHÍNH của trang mới đã
// commit xong). Với các trang dùng <Suspense> (đợt tối ưu cùng ngày — xem
// architecture.md), mốc này rơi đúng vào lúc PHẦN NHANH hiện ra, CHƯA tính
// các khung phụ còn đang tải sau (transit warning, đếm port...) — đây là chủ
// đích, không phải thiếu sót: người dùng quan tâm "bao lâu thấy được nội
// dung chính", không phải "bao lâu mọi thứ trên trang xong hết".
export default function PageLoadTimer() {
  const pathname = usePathname();
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const navStartRef = useRef<number | null>(null);
  const isFirstPathnameRef = useRef(true);

  useEffect(() => {
    function onClickCapture(e: MouseEvent) {
      const anchor = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      // Chỉ tính link nội bộ (bắt đầu bằng "/", không phải "//" hay
      // "http://..." trỏ ra ngoài) — link ngoài không đổi pathname của app
      // này nên sẽ không bao giờ có nhịp "kết thúc" để tính.
      if (!href.startsWith("/") || href.startsWith("//")) return;
      navStartRef.current = performance.now();
    }
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, []);

  useEffect(() => {
    if (isFirstPathnameRef.current) {
      isFirstPathnameRef.current = false;
      // Lần đầu tiên component này chạy (F5/gõ URL/mở tab mới) — không có
      // click nào để đo, dùng Navigation Timing API của chính lần tải này.
      const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
      if (nav) setDurationMs(nav.duration);
      return;
    }
    if (navStartRef.current !== null) {
      setDurationMs(performance.now() - navStartRef.current);
      navStartRef.current = null;
    }
    // Chỉ cần chạy lại khi pathname đổi — đây chính là tín hiệu "trang mới đã
    // commit xong" mà effect này dùng để chốt mốc kết thúc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (durationMs === null) return null;
  const label = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(2)}s` : `${Math.round(durationMs)}ms`;

  return (
    <span
      className="fixed bottom-2 right-2 z-20 rounded-full border border-slate-200 bg-white/90 px-2 py-0.5 text-[11px] text-slate-400 shadow-sm"
      title="Thời gian tải trang này (ước lượng: từ lúc bấm link tới lúc phần chính của trang hiện xong, chưa tính các khung phụ còn tải sau)"
    >
      ⏱ {label}
    </span>
  );
}
