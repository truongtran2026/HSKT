"use client";

import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/lib/roleLabel";

type ApiUser = {
  id: string;
  email: string | null;
  role: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

const ROLE_OPTIONS = ["viewer", "operator", "admin"] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

// Chỉ được render khi app/settings/page.tsx đã xác nhận role=admin (server
// đã kiểm tra, không gửi component này xuống client cho người khác) — nhưng
// mọi API gọi từ đây (GET/POST/PATCH) vẫn tự kiểm tra lại quyền ở route
// handler (requireAdmin), không tin riêng việc "component này được render".
export default function UserManagementPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<(typeof ROLE_OPTIONS)[number]>("viewer");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function reload() {
    setError(null);
    const res = await fetch("/api/admin/users");
    const body = await res.json();
    if (!res.ok) {
      setError(body.error ?? "Không tải được danh sách tài khoản.");
      return;
    }
    setUsers(body.users);
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleRoleChange(userId: string, role: string) {
    setBusyId(userId);
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const body = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(body.error ?? "Đổi vai trò thất bại.");
      return;
    }
    await reload();
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddBusy(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail.trim(), password: newPassword, role: newRole }),
    });
    const body = await res.json();
    setAddBusy(false);
    if (!res.ok) {
      setAddError(body.error ?? "Thêm tài khoản thất bại.");
      return;
    }
    setNewEmail("");
    setNewPassword("");
    setNewRole("viewer");
    setShowAddForm(false);
    await reload();
  }

  return (
    <div>
      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Vai trò</th>
              <th className="px-4 py-2 text-left">Ngày tạo</th>
              <th className="px-4 py-2 text-left">Đăng nhập gần nhất</th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                  Đang tải...
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const isSelf = u.id === currentUserId;
              return (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-800">
                    {u.email ?? "—"}
                    {isSelf && <span className="ml-1.5 text-xs text-slate-400">(bạn)</span>}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className="input w-auto"
                      value={u.role ?? ""}
                      disabled={isSelf || busyId === u.id}
                      title={isSelf ? "Không thể tự đổi vai trò của chính mình — nhờ 1 admin khác đổi giúp" : undefined}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    >
                      {!u.role && <option value="">chưa gán quyền</option>}
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatDateTime(u.createdAt)}</td>
                  <td className="px-4 py-2 text-slate-600">{formatDateTime(u.lastSignInAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3">
        {!showAddForm ? (
          <button type="button" className="btn-secondary" onClick={() => setShowAddForm(true)}>
            + Thêm tài khoản mới
          </button>
        ) : (
          <form onSubmit={handleAddUser} className="mt-2 max-w-md space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mật khẩu</label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Vai trò</label>
              <select className="input" value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </div>
            {addError && <p className="text-sm text-red-600">{addError}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary" disabled={addBusy}>
                {addBusy ? "Đang tạo..." : "Tạo tài khoản"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowAddForm(false)}>
                Hủy
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
