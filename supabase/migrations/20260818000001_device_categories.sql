-- ============================================================================
-- Bảng "device_categories" — quản lý LĨNH VỰC như 1 danh sách thật (yêu cầu
-- người dùng 2026-08-18: "làm sao thêm lĩnh vực (ATBM), xóa lĩnh vực thì sao
-- (xóa phải không còn thiết bị thuộc lĩnh vực đó mới xóa được)"). Trước đây
-- devices.category chỉ là text tự do — "lĩnh vực" chỉ tồn tại ngầm khi có ≥1
-- thiết bị dùng đúng chữ đó, không thêm/xóa được độc lập, gõ sai chính tả dễ
-- tạo ra 1 "lĩnh vực" trùng ý nhưng khác chữ (không phát hiện được).
--
-- GIỮ NGUYÊN devices.category là cột TEXT (không đổi sang category_id) để
-- KHÔNG phải sửa hàng chục chỗ code đang dùng category như string (lib/
-- devices.ts deviceCategoryLabel(), mọi group-by-category ở DeviceCircuitList/
-- DevicePositionMapClient/DeviceCategoryClient/ImportExportClient/
-- CommandPalette/PortTable) — chỉ THÊM ràng buộc khóa ngoại text -> text.
--
-- on delete restrict: Postgres tự chặn xóa 1 dòng device_categories nếu còn
-- ≥1 devices.category đang tham chiếu — đúng yêu cầu "xóa phải hết thiết bị
-- mới xóa được".
-- on update cascade: đổi tên 1 lĩnh vực (update device_categories.name) tự
-- động cập nhật toàn bộ devices.category đang dùng tên cũ, không cần code
-- riêng đi update từng dòng devices.
-- ============================================================================

create table if not exists device_categories (
  name text primary key,
  created_at timestamptz not null default now()
);

alter table device_categories enable row level security;

drop policy if exists "authenticated_select" on device_categories;
create policy "authenticated_select" on device_categories for select to authenticated using (true);

drop policy if exists "write_operator_admin" on device_categories;
create policy "write_operator_admin" on device_categories for insert to authenticated
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

drop policy if exists "update_operator_admin" on device_categories;
create policy "update_operator_admin" on device_categories for update to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'))
  with check (auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin'));

drop policy if exists "admin_delete" on device_categories;
create policy "admin_delete" on device_categories for delete to authenticated
  using (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

-- Seed từ dữ liệu thật đang có (6 lĩnh vực hiện tại: IP, Truyền Dẫn, Vô
-- tuyến, Tổng Đài, VN2, Server) — không hardcode tên, tự lấy DISTINCT từ
-- devices.category để không sai lệch nếu dữ liệu đã đổi khác lúc chạy migration.
insert into device_categories (name)
select distinct category from devices where category is not null
on conflict (name) do nothing;

alter table devices
  drop constraint if exists devices_category_fkey;
alter table devices
  add constraint devices_category_fkey
  foreign key (category) references device_categories (name)
  on delete restrict
  on update cascade;
