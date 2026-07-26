-- ============================================================================
-- Migration: circuits.device_position_own (đổi tên từ device_position_text
-- chưa dùng tới) + circuits.device_position_next (cột mới)
--
-- Lý do (người dùng yêu cầu 2026-07-26): "Vị trí ODF (thiết bị)" và "Vị trí
-- ODF (tiếp theo)" hiện đang chỉ nằm trong circuits.notes dạng text (nhãn
-- "Tọa độ DDF/ODF:", xem lib/deviceNotes.ts extractDevicePositions()) — mỗi
-- lần sửa phải vào ô Ghi chú mới sửa được, không có ô riêng để chọn/gợi ý.
-- Đưa 2 giá trị này ra cột riêng để form sửa/nhập luồng thiết bị có ô riêng,
-- hỗ trợ gợi ý/tự động điền từ device_position_map (mục đích ban đầu của
-- device_position_text ở migration 20260722000001 — cột đó được tạo sẵn
-- nhưng CHƯA từng được ghi/đọc ở đâu, nay đổi tên và dùng thật).
--
-- Sau migration này, chạy 1 lần:
--   npx tsx scripts/migrate-notes-to-position-columns.ts               (dry run)
--   npx tsx scripts/migrate-notes-to-position-columns.ts -- --commit   (ghi thật)
-- để tách dữ liệu "Tọa độ DDF/ODF:" đang có trong notes ra 2 cột này và xóa
-- các dòng đó khỏi notes (các nhãn khác trong notes — "Thiết bị chuyển tiếp:",
-- "TBi đầu cuối:", ghi chú gốc, "ID gốc:" — giữ nguyên, KHÔNG đụng tới).
-- ============================================================================

alter table circuits rename column device_position_text to device_position_own;
alter table circuits add column device_position_next text;

comment on column circuits.device_position_own is
  'Vị trí ODF/DDF CHÍNH thiết bị này đấu cáp ra (tách từ notes "Tọa độ DDF/ODF:" dòng đầu). Dùng để kiểm tra 1 vị trí không bị gán cho 2 thiết bị khác nhau, và gợi ý/tự điền qua device_position_map.';
comment on column circuits.device_position_next is
  'Vị trí ODF tiếp theo / nhảy lên ODF trung kế đi ra ngoài (tách từ notes "Tọa độ DDF/ODF:" dòng thứ hai, nếu có).';
