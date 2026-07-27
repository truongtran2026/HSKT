-- ============================================================================
-- Migration: circuits.updated_at
--
-- Lý do (yêu cầu người dùng 2026-07-27): mỗi luồng có thể được sửa nhiều lần
-- theo thời gian — cần biết lần gần nhất là khi nào, cùng nhu cầu như
-- devices.updated_at (migration 20260727000001), hiện ở UI dạng chữ nhỏ dưới
-- tên luồng, KHÔNG thêm cột bảng mới cho rối bảng.
--
-- Tái dùng function set_updated_at() đã tạo ở migration 20260727000001 —
-- không cần định nghĩa lại.
-- ============================================================================

alter table circuits add column updated_at timestamptz not null default now();

comment on column circuits.updated_at is
  'Lần cuối luồng này được sửa — tự cập nhật qua trigger, không cần code set tay.';

create trigger circuits_set_updated_at
  before update on circuits
  for each row
  execute function set_updated_at();
