-- ============================================================================
-- Migration: device_position_map
--
-- Lý do (KHÔNG có trong architecture.md ban đầu — đã hỏi & được người dùng
-- xác nhận 2026-07-24): người dùng cần 1 danh mục tra cứu riêng "thiết bị +
-- vị trí thiết bị -> vị trí ODF/DDF nó đấu ra" để sau này nhập/sửa luồng
-- thiết bị chỉ cần CHỌN thiết bị + vị trí là tự điền đúng vị trí ODF/DDF
-- (hoặc ngược lại), thay vì gõ tay dễ sai định dạng ("ODF1/2(1,2)" vs
-- "ODF 1/2 (1,2)"...) làm hỏng khả năng tìm kiếm.
--
-- Cố ý làm bảng ĐỘC LẬP với circuits/devices — không sửa schema 2 bảng đó,
-- vì 1 thiết bị có thể có NHIỀU vị trí ra ODF/DDF khác nhau (không phải
-- quan hệ 1-1 để gắn thẳng vào devices.coordinate_text). Việc dùng bảng này
-- để tự điền vào form sửa luồng thiết bị sẽ làm ở bước tiếp theo, sau khi
-- đã có UI nhập liệu cho bảng này.
-- ============================================================================

create table device_position_map (
  id              uuid primary key default gen_random_uuid(),
  device_name     text not null,
  device_position text,
  odf_position    text,
  created_at      timestamptz not null default now()
);

comment on table device_position_map is
  'Tra cứu "thiết bị + vị trí thiết bị -> vị trí ODF/DDF" để tự điền khi nhập/sửa luồng thiết bị. Độc lập với circuits/devices vì 1 thiết bị có thể có nhiều vị trí ra ODF/DDF khác nhau.';

create index idx_device_position_map_device_name on device_position_map(device_name);
create index idx_device_position_map_odf_position on device_position_map(odf_position);

alter table device_position_map enable row level security;
create policy "mvp_allow_all" on device_position_map for all using (true) with check (true);
