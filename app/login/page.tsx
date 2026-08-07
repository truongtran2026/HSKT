"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Đợt 3 bảo mật (2026-08-06) — chỉ 1 tài khoản duy nhất (người dùng xác
// nhận), tạo tay qua Supabase Dashboard → Authentication → Users → Add user.
// Vì vậy KHÔNG có link đăng ký/quên mật khẩu ở đây — thêm sau nếu có nhiều
// người dùng hơn (xem architecture.md, mục ghi lại đợt này).
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      setError(signInErr.message === "Invalid login credentials" ? "Sai email hoặc mật khẩu." : translatePgError(signInErr.message));
      setBusy(false);
      return;
    }
    // Tải lại TOÀN TRANG (không dùng router.refresh()+router.push() kiểu
    // client-side) — phát hiện 2026-08-07: người dùng báo đăng nhập xong vẫn
    // vào được các trang bình thường (phiên thật đã đúng), nhưng Sidebar
    // (nằm ở app/layout.tsx, đọc user qua createSupabaseServerClient()) đôi
    // khi vẫn hiện "—" thay vì email — 2 lệnh client-side không đảm bảo layout
    // gốc kịp render lại với cookie phiên MỚI trước khi điều hướng xong. Tải
    // lại toàn trang thì chắc chắn: request mới hoàn toàn, cookie vừa set đã
    // có sẵn, layout gốc render đúng ngay từ đầu, không còn khoảng hở nào.
    window.location.href = "/";
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-bold text-primary-800">HSKT</h1>
        <p className="mb-4 text-sm text-slate-500">Đăng nhập để xem/sửa hồ sơ ODF trạm ADN1.</p>

        {error && <p className="mb-3 text-sm text-red-600">Lỗi: {error}</p>}

        <label className="mb-3 block text-sm">
          <span className="mb-1 block text-slate-700">Email</span>
          <input
            type="email"
            className="input w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            required
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-slate-700">Mật khẩu</span>
          <input
            type="password"
            className="input w-full"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
