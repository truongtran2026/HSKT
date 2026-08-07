"use client";

import { useEffect } from "react";
import { translatePgError } from "@/lib/translatePgError";

// Chặn lỗi văng ra ngoài thành trang trắng "Application error" của Next.js
// (Đợt 4 audit — trước đây không có error boundary nào, 1 lỗi ném ra trong
// lúc render Server Component làm sập cả trang, người dùng không có cách nào
// tự thử lại ngoài F5). Bắt buộc "use client" theo đúng quy ước Next.js cho
// error.tsx. Không bắt được lỗi ở chính app/layout.tsx (cần global-error.tsx
// riêng) — chưa gặp ca đó thật nên chưa làm, xem ghi chú ở architecture.md.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-lg font-semibold text-red-700">Đã có lỗi xảy ra</p>
      <p className="max-w-md text-sm text-slate-600">{translatePgError(error.message)}</p>
      <button type="button" className="btn-primary" onClick={() => reset()}>
        Thử lại
      </button>
    </div>
  );
}
