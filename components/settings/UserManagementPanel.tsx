"use client";

import { useEffect, useState } from "react";
import { ROLE_LABEL } from "@/lib/roleLabel";
import { IconTrash, IconEdit } from "@/components/ui/icons";

type ApiUser = {
  id: string;
  email: string | null;
  role: string | null;
  createdAt: string;
  lastSignInAt: string | null;
};

const ROLE_OPTIONS = ["viewer", "operator", "admin"] as const;

// Ma trận quyền tóm tắt cho admin xem trước khi cấp/thu hồi — khớp đúng RLS
// thật (supabase/migrations/20260806000001_authenticated_rls.sql +
// 20260807000001_fix_role_policies.sql), không phải mô tả tự suy diễn. Trước
// đây trang này KHÔNG liệt kê gì, admin cấp quyền mà không biết chính xác
// đang cho phép/thu hồi những gì (yêu cầu người dùng 2026-08-08).
const ROLE_CAPABILITIES: { role: (typeof ROLE_OPTIONS)[number]; items: string[] }[] = [
  { role: "viewer", items: ["Xem mọi hồ sơ/dữ liệu", "Không thêm/sửa/xóa được gì"] },
  {
    role: "operator",
    items: [
      "Xem mọi hồ sơ/dữ liệu",
      "Thêm/sửa mọi hồ sơ",
      "Xóa TỪNG luồng/liên kết (không xóa được cả rack/thiết bị)",
    ],
  },
  { role: "admin", items: ["Toàn quyền — thêm/sửa/xóa mọi thứ, kể cả xóa cả rack/thiết bị", "Quản lý tài khoản (trang này)"] },
];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

// Chỉ được render khi app/settings/page.tsx đã xác nhận role=admin (server
// đã kiểm tra, không gửi component này xuống client cho người khác) — nhưng
// mọi API gọi từ đây (GET/POST/PATCH/DELETE) vẫn tự kiểm tra lại quyền ở
// route handler (requireAdmin), không tin riêng việc "component này được
// render".
export default function UserManagementPanel({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<ApiUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Đặt lại mật khẩu inline theo dòng (yêu cầu người dùng 2026-08-08 — trước
  // đây admin không quản lý được mật khẩu tài khoản cấp dưới, phải nhờ chính
  // chủ tự đổi ở "/settings").
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

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

  async function handleDelete(u: ApiUser) {
    if (!confirm(`Xóa hẳn tài khoản "${u.email ?? u.id}"? Không thể hoàn tác.`)) return;
    setBusyId(u.id);
    setError(null);
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    const body = await res.json();
    setBusyId(null);
    if (!res.ok) {
      setError(body.error ?? "Xóa tài khoản thất bại.");
      return;
    }
    await reload();
  }

  function openResetPassword(userId: string) {
    setResetPasswordId(userId);
    setResetPasswordValue("");
    setResetError(null);
  }

  async function submitResetPassword(userId: string) {
    if (resetPasswordValue.length < 6) {
      setResetError("Mật khẩu cần ít nhất 6 ký tự.");
      return;
    }
    setResetBusy(true);
    setResetError(null);
    const res = await fetch(`/api/admin/users/${userId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPasswordValue }),
    });
    const body = await res.json();
    setResetBusy(false);
    if (!res.ok) {
      setResetError(body.error ?? "Đặt lại mật khẩu thất bại.");
      return;
    }
    setResetPasswordId(null);
    setResetPasswordValue("");
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
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ROLE_CAPABILITIES.map((c) => (
          <div key={c.role} className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-sm font-semibold text-primary-800">{ROLE_LABEL[c.role]}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600">
              {c.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {error && <p className="mb-2 text-sm text-red-600">Lỗi: {error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-primary-50 text-primary-800">
            <tr>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Vai trò</th>
              <th className="px-4 py-2 text-left">Ngày tạo</th>
              <th className="px-4 py-2 text-left">Đăng nhập gần nhất</th>
              <th className="px-4 py-2 text-left">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {users === null && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Đang tải...
                </td>
              </tr>
            )}
            {users?.map((u) => {
              const isSelf = u.id === currentUserId;
              const resetting = resetPasswordId === u.id;
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
                  <td className="px-4 py-2">
                    {resetting ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="password"
                            className="input w-40 py-1 text-xs"
                            placeholder="Mật khẩu mới"
                            autoComplete="new-password"
                            value={resetPasswordValue}
                            onChange={(e) => setResetPasswordValue(e.target.value)}
                            autoFocus
                          />
                          <button
                            type="button"
                            className="btn-primary px-2 py-1 text-xs"
                            onClick={() => submitResetPassword(u.id)}
                            disabled={resetBusy}
                          >
                            {resetBusy ? "Đang lưu..." : "Lưu"}
                          </button>
                          <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setResetPasswordId(null)}>
                            Hủy
                          </button>
                        </div>
                        {resetError && <p className="text-xs text-red-600">{resetError}</p>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          className="text-primary-600 hover:underline disabled:text-slate-300"
                          onClick={() => openResetPassword(u.id)}
                          disabled={busyId === u.id}
                          title="Đặt lại mật khẩu"
                          aria-label="Đặt lại mật khẩu"
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          className="text-red-600 hover:underline disabled:text-slate-300"
                          onClick={() => handleDelete(u)}
                          disabled={isSelf || busyId === u.id}
                          title={isSelf ? "Không thể tự xóa chính tài khoản đang đăng nhập" : "Xóa tài khoản"}
                          aria-label="Xóa tài khoản"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    )}
                  </td>
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
