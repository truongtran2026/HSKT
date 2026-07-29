-- ============================================================================
-- Migration: device_dedup_ignored
--
-- Lý do (yêu cầu người dùng 2026-07-29, trang "Chất lượng dữ liệu" mới, tab
-- "Thiết bị trùng gần đúng"): thuật toán so khớp gần đúng (Levenshtein trên
-- tên đã chuẩn hóa) chỉ GỢI Ý, không tự gộp — nhưng 1 cặp thiết bị bị gợi ý
-- sai (2 thiết bị thật khác nhau, tình cờ tên gần giống) cần cách "bỏ qua,
-- đừng báo lại cặp này nữa", giữ được sau khi tải lại trang/đổi máy nên phải
-- lưu DB (không thể chỉ giữ ở state trình duyệt, cùng lý do transit_links.
-- format_ack ở migration 20260729000001).
--
-- Dùng device_a_id/device_b_id (uuid, FK thật tới devices) thay vì lưu TÊN
-- như 1 phương án từng đề xuất — vì tên thiết bị có thể đổi sau (đổi tên/gộp
-- ở "Danh mục thiết bị"), lưu theo tên sẽ tự động sai lệch/mồ côi theo thời
-- gian giống hệt vấn đề device_position_map đã gặp (xem
-- syncDevicePositionMapNames trong lib/devicePositionMap.ts phải tồn tại
-- CHỈ để chữa lỗi này) — FK thật + on delete cascade tự dọn khi xóa thiết bị,
-- không cần thêm hàm đồng bộ tên nào nữa.
--
-- check (device_a_id < device_b_id): luôn chèn/tra theo đúng 1 thứ tự cố định
-- (app tự sort trước khi gọi) để 1 cặp chỉ có ĐÚNG 1 cách biểu diễn, unique
-- index mới chặn được trùng thật (không thì "bỏ qua A,B" và "bỏ qua B,A" sẽ
-- là 2 dòng khác nhau, không chặn được nhau).
-- ============================================================================

create table device_dedup_ignored (
  id             uuid primary key default gen_random_uuid(),
  device_a_id    uuid not null references devices(id) on delete cascade,
  device_b_id    uuid not null references devices(id) on delete cascade,
  created_at     timestamptz not null default now(),
  constraint chk_dedup_ignored_order check (device_a_id < device_b_id)
);

create unique index idx_dedup_ignored_pair on device_dedup_ignored(device_a_id, device_b_id);

comment on table device_dedup_ignored is
  'Các cặp thiết bị người dùng đã xem gợi ý "trùng gần đúng" và xác nhận là 2 thiết bị thật khác nhau (không phải lỗi gõ) -- không báo lại cặp này ở trang Chất lượng dữ liệu nữa.';

alter table device_dedup_ignored enable row level security;
create policy "mvp_allow_all" on device_dedup_ignored for all using (true) with check (true);
