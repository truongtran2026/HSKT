-- ============================================================================
-- Migration: devices.updated_at
--
-- Lý do (yêu cầu người dùng 2026-07-27): 1 thiết bị có thể được "chuẩn hóa"
-- (đổi tên/gộp/gán lĩnh vực) nhiều lần theo thời gian — cần biết lần gần
-- nhất là khi nào mà không cần thêm cột riêng gây rối bảng (hiện ở UI dạng
-- chữ nhỏ dưới tên thiết bị, không phải cột mới).
--
-- Dùng trigger tự cập nhật thay vì bắt code ở mọi chỗ tự set updated_at —
-- an toàn hơn (không sợ quên ở 1 chỗ update nào đó), đúng thông lệ Postgres.
-- ============================================================================

alter table devices add column updated_at timestamptz not null default now();

comment on column devices.updated_at is
  'Lần cuối thiết bị này được sửa (đổi tên/gộp/gán lĩnh vực...) — tự cập nhật qua trigger, không cần code set tay.';

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger devices_set_updated_at
  before update on devices
  for each row
  execute function set_updated_at();
