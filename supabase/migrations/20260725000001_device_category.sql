-- ============================================================================
-- Migration: devices.category
--
-- Lý do (đã hỏi & xác nhận 2026-07-25): lô import thiết bị mới (126 file)
-- xếp theo 6 thư mục lĩnh vực (IP/Server/Truyền Dẫn/Tổng Đài/VN2/Vô tuyến).
-- Người dùng muốn lọc/nhóm thiết bị theo đúng lĩnh vực này ở UI (dropdown
-- chọn thiết bị, trang Chuẩn hóa thiết bị) thay vì 1 danh sách dài chung.
-- Thêm cột nullable — 26 thiết bị chuẩn hóa từ trước (nguồn dữ liệu cũ,
-- không có khái niệm lĩnh vực) để NULL, hiện dưới nhóm "Chưa phân loại".
-- ============================================================================

alter table devices add column category text;

comment on column devices.category is
  'Lĩnh vực thiết bị (IP/Server/Truyền Dẫn/Tổng Đài/VN2/Vô tuyến...) — suy từ thư mục con trong data/ lúc import lô 126 file 2026-07-25. NULL với thiết bị chuẩn hóa từ trước, chưa có lĩnh vực.';
