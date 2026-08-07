"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Đợt 3 bảo mật (2026-08-06) — chỉ 1 tài khoản duy nhất (người dùng xác
// nhận), tạo tay qua Supabase Dashboard → Authentication → Users → Add user.
// Vì vậy KHÔNG có link đăng ký/quên mật khẩu ở đây — thêm sau nếu có nhiều
// người dùng hơn (xem architecture.md, mục ghi lại đợt này).
export default function LoginPage() {
  const router = useRouter();
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
    // router.refresh() để cây Server Component (đọc phiên qua
    // lib/supabase-server.ts) render lại với phiên đăng nhập MỚI trước khi
    // điều hướng — không thì trang "/" có thể vẫn thấy trạng thái cũ.
    router.refresh();
    router.push("/");
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
