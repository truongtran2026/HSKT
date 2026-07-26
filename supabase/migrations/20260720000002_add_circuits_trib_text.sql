-- ============================================================================
-- Migration: thêm circuits.trib_text
--
-- Lý do (phát sinh khi khảo sát dữ liệu thật file M3.TD-1_2 ODF/DDF thiết bị,
-- KHÔNG có trong architecture.md ban đầu — đã hỏi & được người dùng xác nhận):
-- file gốc có cột "Trib" = vị trí cổng vật lý NGAY TẠI thiết bị đang xét
-- (vd '1/1/1', 'S1-2', 'Slot 1/Port1 INPUT'). Đây là thông tin vị trí quan
-- trọng, không thể gộp chung vào notes như cột "Agg" (aggregate — khai báo
-- mềm bên thiết bị truyền dẫn, ít quan trọng hơn, vẫn gộp vào notes).
--
-- Chỉ có ý nghĩa khi rack.domain = 'device' (ODF/DDF thiết bị); NULL cho
-- circuit thuộc ODF trung kế.
-- ============================================================================

alter table circuits add column trib_text text;

comment on column circuits.trib_text is
  'Cột "Trib" trong Excel gốc M3.TD-1_2: vị trí cổng vật lý ngay tại thiết bị (vd "1/1/1", "S1-2"). Chỉ có nghĩa khi luồng thuộc ODF/DDF thiết bị.';
