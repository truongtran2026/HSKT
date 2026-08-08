"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { translatePgError } from "@/lib/translatePgError";

// Đổi mật khẩu CHO CHÍNH tài khoản đang đăng nhập — supabase.auth.updateUser
// tự dùng phiên (session) hiện có, không cần nhập lại mật khẩu cũ (đúng hành
// vi mặc định của Supabase Auth khi đã có session hợp lệ). Không đụng tới
// service role/route API vì không sửa tài khoản NGƯỜI KHÁC.
export default function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (password.length < 6) {
      setError("Mật khẩu mới cần ít nhất 6 ký tự.");
      return;
    }
    if (password !== confirm) {
      setError("2 ô mật khẩu chưa khớp nhau.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(translatePgError(err.message));
      return;
    }
    setPassword("");
    setConfirm("");
    setDone(true);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-sm space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu mới</label>
        <input
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Xác nhận mật khẩu mới</label>
        <input
          type="password"
          className="input"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {done && <p className="text-sm text-green-600">Đã đổi mật khẩu thành công.</p>}
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Đang lưu..." : "Đổi mật khẩu"}
      </button>
    </form>
  );
}
