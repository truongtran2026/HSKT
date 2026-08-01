-- ============================================================================
-- Migration: circuits.mirror_of_id
--
-- Lý do (KHÔNG có trong architecture.md ban đầu — người dùng xác nhận
-- 2026-07-31, xem architecture.md mục 32): scripts/sync-missing-trunk-circuits.ts
-- (2026-07-28) tự tạo 1 luồng "mirror" bên Hồ sơ ODF Trung kế cho mỗi luồng
-- thiết bị có device_position_own/next khớp 1 port trung kế thật đang trống,
-- để phản ánh đúng port đang dùng. 2 dòng circuit này TRƯỚC ĐÂY chỉ nhận ra
-- nhau qua 1 cụm text cố định trong circuits.notes ("...luồng gốc id
-- <uuid>."), KHÔNG có ràng buộc CSDL nào — nên xóa luồng thiết bị gốc ở BẤT
-- KỲ đâu (kể cả nút "Xóa hẳn thiết bị" ở /devices lẫn script quản trị sau
-- này) đều để lại mirror mồ côi bên trung kế, port báo "đang dùng" mãi dù
-- luồng gốc không còn tồn tại thật (bug thật đã gặp 2026-07-31).
--
-- mirror_of_id: tự trỏ vào chính circuits(id) — CHỈ set trên dòng "mirror"
-- (trỏ về luồng thiết bị gốc), NULL với mọi luồng khác (đa số). `on delete
-- cascade`: xóa luồng gốc thì Postgres TỰ xóa mirror theo (kéo theo tự xóa
-- port_circuit_links của mirror qua cascade đã có sẵn từ init_schema.sql) —
-- đảm bảo đúng ở tầng CSDL, không phụ thuộc code nhớ gọi đúng hàm dọn dẹp ở
-- từng nơi xóa luồng thiết bị.
-- ============================================================================

alter table circuits add column mirror_of_id uuid references circuits(id) on delete cascade;

comment on column circuits.mirror_of_id is
  'Chỉ set khi luồng này là "mirror" tự sinh bên trung kế (script sync-missing-trunk-circuits.ts) — trỏ về luồng thiết bị gốc. on delete cascade: xóa luồng gốc thì mirror tự xóa theo.';

create index idx_circuits_mirror_of on circuits(mirror_of_id);
