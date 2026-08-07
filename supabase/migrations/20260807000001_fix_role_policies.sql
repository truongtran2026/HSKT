-- ============================================================================
-- SỬA LỖI migration 20260806000001_authenticated_rls.sql (chạy 2026-08-07).
--
-- Khi chạy 20260806000001, thực tế bản CŨ của file đó (trước khi sửa lại
-- thành 3 cấp quyền viewer/operator/admin, xem architecture.md mục 68) đã
-- được áp dụng lên CSDL sống TRƯỚC — policy tên "authenticated_insert"/
-- "authenticated_update" (mở cho MỌI tài khoản đã đăng nhập, không phân biệt
-- role) và "admin_delete" (phạm vi cũ, gồm cả circuits/port_circuit_links/
-- transit_links/device_position_map) đã được tạo. Khi chạy lại bản MỚI (3
-- cấp), câu lệnh đầu tiên trong khối `do $$` của Part A báo lỗi
-- 'policy "authenticated_select" for table "stations" already exists' —
-- toàn bộ phần còn lại của Part A/B/C KHÔNG chạy được (dừng ngay tại câu đầu
-- tiên). Đã tự kiểm chứng bằng script tạm (đăng nhập thật bằng tài khoản
-- viewer test, thử insert vào bảng stations) — XÁC NHẬN: viewer đang insert
-- được (status 201, không lỗi) — đúng là behavior của bản CŨ, SAI với thiết
-- kế 3 cấp mong muốn.
--
-- File này sửa lại cho ĐÚNG, viết idempotent hoàn toàn (drop-if-exists TRƯỚC
-- mỗi create, dùng CẢ tên cũ lẫn tên mới) — chạy lại bao nhiêu lần cũng an
-- toàn, không phụ thuộc CSDL đang ở trạng thái nào (mvp_allow_all cũ, bản cũ
-- của 20260806000001, hay đã đúng bản mới rồi).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. 10 bảng — xóa MỌI policy insert/update cũ (tên cũ "authenticated_insert"/
--    "authenticated_update", mở cho mọi tài khoản) lẫn tên mới (phòng khi đã
--    chạy 1 phần), rồi tạo lại đúng: insert/update CHỈ operator/admin.
--    authenticated_select cũng drop+create lại cho chắc (định nghĩa không đổi
--    giữa các bản, nhưng làm vậy để file này tự đứng độc lập, không cần biết
--    lịch sử trước đó).
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'stations', 'devices', 'racks', 'ports', 'circuits',
    'port_circuit_links', 'transit_links', 'import_batches',
    'device_position_map', 'device_dedup_ignored'
  ]
  loop
    execute format('drop policy if exists "authenticated_select" on %I;', t);
    execute format('drop policy if exists "authenticated_insert" on %I;', t);
    execute format('drop policy if exists "authenticated_update" on %I;', t);
    execute format('drop policy if exists "write_operator_admin" on %I;', t);
    execute format('drop policy if exists "update_operator_admin" on %I;', t);

    execute format('create policy "authenticated_select" on %I for select to authenticated using (true);', t);
    execute format(
      $f$create policy "write_operator_admin" on %I for insert to authenticated with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));$f$,
      t
    );
    execute format(
      $f$create policy "update_operator_admin" on %I for update to authenticated using (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin')) with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));$f$,
      t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- B. device_aliases — cùng lỗi: "authenticated_insert" cũ (nếu có) mở cho
--    mọi tài khoản, thay bằng write_operator_admin.
-- ----------------------------------------------------------------------------
alter table device_aliases enable row level security;
drop policy if exists "authenticated_select" on device_aliases;
drop policy if exists "authenticated_insert" on device_aliases;
drop policy if exists "write_operator_admin" on device_aliases;
create policy "authenticated_select" on device_aliases for select to authenticated using (true);
create policy "write_operator_admin" on device_aliases for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

-- ----------------------------------------------------------------------------
-- C. DELETE — bản cũ có "admin_delete" (role='admin') trên CẢ 7 bảng gồm
--    circuits/port_circuit_links/transit_links/device_position_map, nghĩa là
--    operator hiện KHÔNG xóa được từng luồng (chỉ admin xóa được) — sai với
--    yêu cầu "operator xóa được từng luồng". Xóa policy cũ trên toàn bộ 7
--    bảng rồi tạo lại đúng: operator_delete (operator+admin) trên 4 bảng
--    "xóa từng luồng", admin_delete (chỉ admin) trên 3 bảng "xóa cả rack/
--    thiết bị" — xem giải thích ánh xạ đầy đủ ở 20260806000001 Part C.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'devices', 'circuits', 'port_circuit_links', 'transit_links',
    'ports', 'racks', 'device_position_map'
  ]
  loop
    execute format('drop policy if exists "admin_delete" on %I;', t);
    execute format('drop policy if exists "operator_delete" on %I;', t);
  end loop;

  foreach t in array array[
    'circuits', 'port_circuit_links', 'transit_links', 'device_position_map'
  ]
  loop
    execute format(
      $f$create policy "operator_delete" on %I for delete to authenticated using (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));$f$,
      t
    );
  end loop;

  foreach t in array array['devices', 'ports', 'racks']
  loop
    execute format(
      $f$create policy "admin_delete" on %I for delete to authenticated using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');$f$,
      t
    );
  end loop;
end $$;
