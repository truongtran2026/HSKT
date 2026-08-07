-- ============================================================================
-- Đợt 2 (HSKT-audit-2026-08-03.md mục 2.3/2.5) — 2 việc:
--
-- A. Hai hàm RPC xóa nguyên tử (transaction ngầm định của Postgres function)
--    thay cho chuỗi lời gọi Supabase độc lập từ trình duyệt — nếu mất mạng/
--    đóng tab giữa chừng, DB dừng lại ở TRẠNG THÁI DỞ DANG thay vì rollback
--    sạch. Ví dụ thật đã ghi trong audit: PortTable.deleteGroup() xóa xong
--    circuits nhưng lỡ đứt mạng TRƯỚC bước update ports.status → port vẫn
--    'in_use' dù không còn luồng nào — trạng thái ma, chỉ tự phát hiện được
--    qua rà soát thủ công.
--
--    CHỈ bọc phần THUẦN CƠ HỌC (delete/update theo id, không có logic dò/
--    khớp text) vào transaction — phần có business logic thật (tự tạo lại
--    mirror sau khi xóa ở deleteGroup; dọn device_position_map theo tên
--    chuẩn hóa ở deleteSelectedDevices) VẪN giữ nguyên ở tầng JS, gọi SAU
--    khi RPC thành công, y hệt cách xử lý "best-effort, báo lỗi riêng nếu
--    thất bại" đã có sẵn trong code — không đổi ngữ nghĩa, chỉ thu hẹp cửa sổ
--    "dở dang" xuống đúng phần có thể xảy ra thật (nhiều lời gọi Supabase rời
--    rạc từ trình duyệt).
--
-- B. unique(mirror_of_id) + check(mirror_of_id <> id) — mô hình nghiệp vụ là
--    1-1 (1 luồng thiết bị ↔ 1 luồng trung kế mirror), nhưng DB hiện cho phép
--    2 luồng trung kế cùng trỏ `mirror_of_id` về 1 luồng thiết bị. Khi đó xóa
--    luồng thiết bị sẽ cascade xóa CẢ HAI — luồng thứ hai có thể là 1 đấu nối
--    hoàn toàn khác. Đã kiểm tra dữ liệu sống 2026-08-04 (script đọc trực
--    tiếp Supabase): 119 dòng có mirror_of_id, 0 self-reference, 0 nhóm
--    trùng — an toàn thêm ràng buộc ngay, không cần dọn dữ liệu trước.
-- ============================================================================

-- B. Trước tiên (constraint đơn giản, không phụ thuộc gì ở dưới).
create unique index if not exists uq_circuits_mirror_of on circuits (mirror_of_id) where mirror_of_id is not null;
alter table circuits add constraint chk_mirror_not_self check (mirror_of_id <> id);

-- A.1 — thay PortTable.deleteGroup(): 4 bước tuần tự (xóa port_circuit_links,
-- xóa circuits, update ports.status, xóa transit_links) gộp thành 1 lời gọi.
-- security invoker: tôn trọng RLS của người gọi (policy mvp_allow_all hiện
-- tại cho phép mọi thao tác dù invoker hay definer — chọn invoker để đúng
-- nguyên tắc "không vượt quyền người gọi", sẵn sàng cho lúc bật Auth thật ở
-- Đợt 3 mà không cần sửa lại hàm này).
create or replace function delete_trunk_circuit(p_circuit_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_port_ids uuid[];
begin
  select array_agg(port_id) into v_port_ids
    from port_circuit_links where circuit_id = p_circuit_id;

  delete from port_circuit_links where circuit_id = p_circuit_id;
  delete from circuits where id = p_circuit_id;

  if v_port_ids is not null then
    update ports set status = 'unused' where id = any(v_port_ids);
    delete from transit_links where source_port_id = any(v_port_ids);
  end if;
end;
$$;

-- A.2 — thay phần cơ học của DeviceCategoryClient.deleteSelectedDevices():
-- xóa circuits theo device_id (tự cascade xóa mirror trung kế qua
-- `mirror_of_id ... on delete cascade`, kéo theo port_circuit_links của
-- mirror), dọn ports.status/transit_links của các port mirror vừa giải
-- phóng (KHÔNG tự cascade — 2 bảng không có FK trỏ tới circuits), rồi xóa
-- devices. Phần dọn device_position_map (khớp theo TÊN đã chuẩn hóa qua
-- normalizeDeviceNameKey() — hàm JS, không có bản SQL tương đương) CỐ Ý
-- không đưa vào đây, vẫn gọi riêng ở tầng JS sau khi RPC này thành công,
-- y hệt hành vi cũ.
create or replace function delete_devices_with_circuits(p_device_ids uuid[])
returns void
language plpgsql
security invoker
as $$
declare
  v_mirror_port_ids uuid[];
begin
  -- Port của các luồng TRUNG KẾ đang là mirror (mirror_of_id) của luồng
  -- thiết bị sắp xóa — thu thập TRƯỚC khi xóa, vì sau khi circuits gốc bị
  -- xóa thì mirror cũng đã bị cascade xóa theo, không còn port_circuit_links
  -- để dò ngược nữa.
  select array_agg(pcl.port_id) into v_mirror_port_ids
    from circuits mirror
    join port_circuit_links pcl on pcl.circuit_id = mirror.id
    where mirror.mirror_of_id in (select id from circuits where device_id = any(p_device_ids));

  delete from circuits where device_id = any(p_device_ids);

  if v_mirror_port_ids is not null then
    delete from transit_links where source_port_id = any(v_mirror_port_ids);
    update ports set status = 'unused' where id = any(v_mirror_port_ids);
  end if;

  delete from devices where id = any(p_device_ids);
end;
$$;
