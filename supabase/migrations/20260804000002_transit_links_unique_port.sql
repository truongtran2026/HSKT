-- Chốt bất biến "1 port chỉ có đúng 1 dòng Chuyển tiếp" bằng ràng buộc DB thật,
-- không chỉ dựa vào code (rà soát toàn dự án 2026-08-03/04 — trước đó có 6 nơi
-- ghi transit_links.raw_text khác công thức nhau, gây ra đúng 1 port bị ghi
-- trùng 3 dòng y hệt trong dữ liệu sống; đã dọn sạch bằng
-- scripts/repair-transit-per-circuit.ts --commit ngày 2026-08-04 trước khi
-- chạy migration này — xác nhận lại bằng dry-run lần 2: "0 port gộp được an
-- toàn... 0 port mơ hồ" trước khi thêm ràng buộc unique).
--
-- Mọi đường ghi mới đều phải đi qua lib/transitLinks.ts writeTransitForPorts()
-- (đường ghi duy nhất, tự ON CONFLICT theo source_port_id) nên ràng buộc này
-- không chặn hoạt động bình thường, chỉ ngăn tái phát lỗi ghi trùng dòng.
--
-- Xóa index thường cũ (idx_transit_source, chỉ tăng tốc tra cứu, không ràng
-- buộc gì) và thay bằng unique index cùng cột — vẫn giữ nguyên tác dụng tăng
-- tốc tra cứu, thêm ràng buộc duy nhất.

drop index if exists idx_transit_source;

create unique index if not exists idx_transit_source_unique on transit_links (source_port_id);
