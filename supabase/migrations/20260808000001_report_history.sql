-- ============================================================================
-- "Lịch sử tra cứu" — bảng lưu đoạn text báo cáo đã sinh (tick-to-text) dùng
-- CHUNG cho cả Hồ sơ ODF trung kế lẫn Hồ sơ đấu nối (yêu cầu người dùng
-- 2026-08-07, xem architecture.md). Không phân biệt nguồn trang — chỉ 1 dòng
-- cho mỗi luồng, lưu lại "cập nhật đè" mỗi lần tick+lưu lại (đúng quyết định
-- người dùng chọn, không tạo dòng trùng theo thời gian).
-- ============================================================================

create table if not exists report_history (
  id uuid primary key default gen_random_uuid(),
  circuit_id uuid not null references circuits(id) on delete cascade,
  report_text text not null,
  accessed_at timestamptz not null default now()
);

-- unique(circuit_id) là cơ chế cho "cập nhật đè": client dùng
-- .upsert(..., { onConflict: "circuit_id" }) thay vì tự kiểm tra tồn tại
-- trước rồi update/insert riêng.
create unique index if not exists report_history_circuit_id_key on report_history(circuit_id);

alter table report_history enable row level security;

drop policy if exists "authenticated_select" on report_history;
drop policy if exists "write_operator_admin" on report_history;
drop policy if exists "update_operator_admin" on report_history;
drop policy if exists "operator_delete" on report_history;

create policy "authenticated_select" on report_history for select to authenticated using (true);

create policy "write_operator_admin" on report_history for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

create policy "update_operator_admin" on report_history for update to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'))
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

-- Xóa 1 dòng lịch sử là thao tác nhẹ (không phải xóa cả rack/thiết bị) —
-- cùng cấp operator_delete như circuits/port_circuit_links (mục 68).
create policy "operator_delete" on report_history for delete to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));
