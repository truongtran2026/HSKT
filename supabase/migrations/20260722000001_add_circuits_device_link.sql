-- ============================================================================
-- Migration: circuits.device_id + circuits.device_position_text
--
-- Lý do (KHÔNG có trong architecture.md ban đầu — đã hỏi & được người dùng
-- xác nhận 2026-07-22): dữ liệu file M3.TD-1_2 (ODF/DDF thiết bị) đang lưu
-- tên thiết bị + vị trí cổng DDF/ODF dạng text tự do gộp trong circuits.notes
-- (nhãn "Thiết bị:" / "Tọa độ DDF/ODF:" — xem scripts/import-legacy.ts dòng
-- ~398-402). Người dùng cần: (1) chuẩn hóa tên thiết bị (nhiều biến thể
-- chính tả cho cùng 1 thiết bị thực), (2) sau đó kiểm tra tính nhất quán
-- "1 vị trí DDF/ODF không được gán cho 2 thiết bị khác nhau". Cả 2 việc này
-- cần trường có cấu trúc, parse lại text tự do mỗi lần không đủ tin cậy.
--
-- device_id: liên kết chuẩn hóa tới bảng devices có sẵn (mục 3.7), source
-- 'auto' khi được tạo qua UI chuẩn hóa (giữ đúng ý nghĩa cột devices.source).
-- device_position_text: tách riêng từ "Tọa độ DDF/ODF:" trong notes, KHÔNG
-- xóa/sửa notes gốc (notes vẫn là bản đầy đủ, không mất dữ liệu).
--
-- Chỉ có nghĩa với luồng thuộc domain=device (luồng chưa gán port nào —
-- xem lib/deviceCircuits.ts). CHƯA tạo racks/ports thật cho domain=device,
-- vẫn theo quyết định hoãn ở mục 7.2 — việc đó để sau khi đã chuẩn hóa xong
-- tên thiết bị + vị trí qua bước này.
-- ============================================================================

alter table circuits add column device_id uuid references devices(id);
alter table circuits add column device_position_text text;

comment on column circuits.device_id is
  'Chỉ có nghĩa khi luồng thuộc domain=device (chưa gán port nào). Gán qua UI chuẩn hóa thiết bị /odf-device/chuan-hoa.';
comment on column circuits.device_position_text is
  'Vị trí cổng DDF/ODF tại thiết bị, tách từ notes ("Tọa độ DDF/ODF: ..."), dùng để kiểm tra 1 vị trí không bị gán cho 2 thiết bị khác nhau.';

create index idx_circuits_device on circuits(device_id);
