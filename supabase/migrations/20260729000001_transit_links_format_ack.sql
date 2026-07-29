-- ============================================================================
-- Migration: transit_links.format_ack
--
-- Lý do (yêu cầu người dùng 2026-07-29, xem architecture.md mục 20/26): khung
-- cảnh báo "Chuyển tiếp chưa đúng chuẩn form" (TransitFormatWarning.tsx,
-- lib/transitLinks.ts) chỉ liệt kê, không tự sửa — nhưng một số dòng thực
-- chất PHẢI ghi khác 2 form chuẩn (không phải lỗi thật), nên cần 1 nút
-- "Ack" (Acknowledge — xác nhận đã xem, bỏ qua) cho TỪNG dòng cụ thể. Trạng
-- thái này phải còn lại sau khi tải lại trang hoặc đổi máy (nhà/cơ quan) nên
-- KHÔNG thể chỉ giữ ở state trình duyệt/localStorage — cần lưu xuống DB.
-- ============================================================================

alter table transit_links add column format_ack boolean not null default false;

comment on column transit_links.format_ack is
  'Người dùng đã bấm "Ack" (xác nhận đã xem, chấp nhận) cảnh báo "chưa đúng chuẩn form" của dòng Chuyển tiếp này -- true thì ẩn khỏi TransitFormatWarning. Không phản ánh dữ liệu đúng/sai, chỉ là đã xem.';
