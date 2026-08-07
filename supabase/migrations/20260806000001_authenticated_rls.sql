-- ============================================================================
-- Đợt 3 bảo mật (HSKT-audit-2026-08-03.md mục 1, architecture.md — bật
-- Supabase Auth, người dùng xác nhận 2026-08-06 đổi nguyên tắc "không auth ở
-- MVP" cũ trong CLAUDE.md vì lỗ hổng bảo mật thật): policy "mvp_allow_all"
-- (`for all using (true) with check (true)`) trên mọi bảng + anon key nằm
-- công khai trong bundle JS nghĩa là BẤT KỲ AI mở hskt.vercel.app đều đọc/
-- ghi/xóa được toàn bộ CSDL qua REST API của Supabase, không cần qua app,
-- không cần đăng nhập.
--
-- SỬA 2026-08-06 (cùng ngày, vẫn CHƯA chạy lần nào): người dùng yêu cầu thêm
-- 3 CẤP quyền thay vì chỉ authenticated/admin như bản đầu — viewer (chỉ xem),
-- operator (xem + sửa + xóa TỪNG luồng, không xóa cả rack/thiết bị), admin
-- (mọi quyền). Dùng chung 1 giá trị app_metadata.role ∈ {'viewer','operator',
-- 'admin'} cho cả 3 mục đích (select/insert/update, xóa từng luồng, xóa cả
-- rack/thiết bị) — không cần bảng role riêng, đủ cho quy mô vài tài khoản.
--
-- ⚠️ CHỈ CHẠY FILE NÀY SAU KHI:
--   1. Đã tạo tài khoản thật trong Supabase Dashboard → Authentication →
--      Users → Add user (hoặc qua script `npm run create-role-accounts --
--      --commit`, xem scripts/create-role-test-accounts.ts).
--   2. Đã tự đăng nhập được bằng tài khoản đó qua `npm run dev` (RLS lúc đó
--      vẫn còn mvp_allow_all — bước này chỉ xác nhận luồng đăng nhập/redirect
--      của middleware.ts chạy đúng, KHÔNG liên quan gì tới file SQL này).
--   3. Đã gán app_metadata.role cho từng tài khoản (xem câu lệnh mẫu ở cuối
--      file, hoặc script ở bước 1 tự gán sẵn cho 2 tài khoản operator/viewer
--      nó tạo) — QUÊN gán role="admin" cho tài khoản chính thì mọi nút Xóa
--      trong app (kể cả 2 RPC delete_trunk_circuit/delete_devices_with_circuits
--      của Đợt 2) sẽ ngưng hoạt động luôn cho chính người dùng đó.
-- Chạy file này XONG mới có tác dụng khóa RLS thật — trước đó app vẫn hoạt
-- động dưới mvp_allow_all như cũ, không có lúc nào bị hỏng giữa chừng.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. 10 bảng đã có RLS + policy "mvp_allow_all" (grep xác nhận từ
--    20260720000003_enable_rls_open_policy.sql, 20260724000001_device_position_map.sql,
--    20260729000002_device_dedup_ignored.sql) — xóa policy mở, thay bằng:
--    - select: mọi tài khoản đã đăng nhập (kể cả viewer) — đọc không rủi ro.
--    - insert/update: CHỈ operator/admin — viewer là chỉ-xem thật sự, không
--      cho ghi gì (kể cả sửa nhỏ), tránh viewer bấm Lưu rồi nhận lỗi RLS khó
--      hiểu ở giữa 1 form dài.
-- ----------------------------------------------------------------------------
drop policy if exists "mvp_allow_all" on stations;
drop policy if exists "mvp_allow_all" on devices;
drop policy if exists "mvp_allow_all" on racks;
drop policy if exists "mvp_allow_all" on ports;
drop policy if exists "mvp_allow_all" on circuits;
drop policy if exists "mvp_allow_all" on port_circuit_links;
drop policy if exists "mvp_allow_all" on transit_links;
drop policy if exists "mvp_allow_all" on import_batches;
drop policy if exists "mvp_allow_all" on device_position_map;
drop policy if exists "mvp_allow_all" on device_dedup_ignored;

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
-- B. device_aliases (migration 20260801000001) — phát hiện khi tự rà lại
--    2026-08-06: bảng này CHƯA TỪNG bật RLS, không có policy nào — đang mở
--    hoàn toàn qua GRANT mặc định của Supabase, CÙNG mức rủi ro như 10 bảng
--    trên dù không mang tên "mvp_allow_all". Không có delete thật từ app
--    (chỉ select + upsert-ignore-duplicates, xem lib/deviceAliases.ts) nên
--    không cần policy update/delete.
-- ----------------------------------------------------------------------------
alter table device_aliases enable row level security;
create policy "authenticated_select" on device_aliases for select to authenticated using (true);
create policy "write_operator_admin" on device_aliases for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

-- ----------------------------------------------------------------------------
-- C. Tách quyền DELETE làm 2 mức, chỉ trên bảng THẬT có `.delete()` gọi từ
--    app (grep xác nhận):
--    - operator_delete (operator + admin): circuits, port_circuit_links,
--      transit_links, device_position_map — đây là "xóa TỪNG luồng" (RPC
--      delete_trunk_circuit chỉ đụng 3 bảng này + update ports.status, KHÔNG
--      đụng devices/racks/ports, xem migration 20260804000003 — nên operator
--      gọi RPC này vẫn xóa được đúng ý "xóa từng luồng" mà không cần sửa RPC).
--    - admin_delete (chỉ admin): devices, ports, racks — đây là "xóa cả
--      rack/ODF" (components/odf-device/DeleteRackButton.tsx) và "xóa cả
--      thiết bị" (RPC delete_devices_with_circuits, migration 20260804000003,
--      DELETE trên bảng devices nằm trong RPC này).
--
--    Dùng app_metadata (JWT `auth.jwt() -> 'app_metadata' ->> 'role'`) —
--    app_metadata chỉ sửa được qua Dashboard/Admin API, KHÔNG sửa được từ
--    chính người dùng (khác user_metadata), nên an toàn làm nguồn xác định
--    quyền.
--
--    2 RPC delete_trunk_circuit()/delete_devices_with_circuits() (Đợt 2,
--    migration 20260804000003) đều `security invoker` — chạy dưới quyền JWT
--    người GỌI, nên lệnh `delete` bên trong 2 hàm đó vẫn bị ĐÚNG policy dưới
--    đây chặn nếu người gọi không đủ quyền — không cần sửa lại 2 hàm.
--
--    Bảng KHÔNG có delete thật từ app (stations, import_batches,
--    device_dedup_ignored, device_aliases) — không thêm policy delete nào,
--    mặc định RLS chặn (không có policy = không ai xóa được, kể cả admin,
--    trừ qua service role key của script).
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
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

-- ----------------------------------------------------------------------------
-- Mẫu câu lệnh gán role tay (đổi email thật vào) — script
-- scripts/create-role-test-accounts.ts đã tự làm việc này cho 2 tài khoản nó
-- tạo, chỉ cần chạy tay cho tài khoản admin đầu tiên (đã tạo trước khi có
-- script này):
--
-- update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
--   where email = 'ĐIỀN_EMAIL_THẬT@...';
-- ----------------------------------------------------------------------------
