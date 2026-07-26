-- ============================================================================
-- Migration: Khởi tạo schema quản lý ODF trung kế & ODF/DDF thiết bị (ADN1)
-- Nguồn: architecture.md mục 3 — đây là bản chuyển thẳng từ tài liệu đó.
-- Giai đoạn 1 (MVP): single-user, RLS để mặc định TẮT (Supabase mặc định vậy
-- khi mới tạo bảng) — KHÔNG bật RLS ở migration này, sẽ bật ở giai đoạn 2
-- cùng với user_roles/audit_log (xem architecture.md mục 3.8, mục 5).
-- ============================================================================

-- pgcrypto để dùng gen_random_uuid() cho khóa chính UUID.
create extension if not exists pgcrypto;
-- pg_trgm để làm index tìm kiếm nhanh gần đúng (ILIKE) trên tên luồng,
-- phục vụ mục 4.3 "Tìm kiếm & tài nguyên" của architecture.md.
create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type rack_domain as enum ('trunk', 'device');
create type odf_type as enum ('welded', 'distribution');
create type port_medium as enum ('fiber', 'copper');
create type port_status as enum ('unused', 'in_use', 'standby');
create type circuit_role as enum ('active', 'standby');
create type link_role as enum ('tx', 'rx', 'single');
create type transit_target_type as enum ('port', 'device_direct', 'cable_out', 'text_only');
create type device_source as enum ('auto', 'manual');

-- ----------------------------------------------------------------------------
-- 3.1 stations — Trạm
-- ----------------------------------------------------------------------------
create table stations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,        -- 'ADN1', '2T9', 'VMS.ADN', 'HHI'...
  name        text not null,
  -- true CHỈ cho ADN1 — mọi trạm đối phương (kể cả 2T9) đều false,
  -- vì chỉ ADN1 được quản lý/validate đầy đủ port (architecture.md mục 1, 5).
  is_managed  boolean not null default false
);

comment on column stations.is_managed is
  'true chỉ cho ADN1. Các trạm khác (kể cả 2T9) luôn false — chỉ tham chiếu, không validate port.';

-- ----------------------------------------------------------------------------
-- 3.7 devices — Danh mục thiết bị (chỉ trạm ADN1, tự sinh hoặc nhập tay)
-- Đặt trước racks vì racks.device_id tham chiếu tới bảng này.
-- ----------------------------------------------------------------------------
create table devices (
  id              uuid primary key default gen_random_uuid(),
  station_id      uuid not null references stations(id),
  name            text not null,           -- vd 'OTS2', 'OMS3240'
  coordinate_text text,                    -- vd '(1-3-3)'
  full_label      text,                    -- vd 'ADN1.OTS2(1-3-3)'
  source          device_source not null default 'manual'
);

comment on table devices is
  'Tự sinh khi parse transit_links gặp tọa độ thuộc ADN1 (source=auto, có hỏi xác nhận ở UI trước khi lưu); trạm khác (kể cả 2T9) không tạo devices, chỉ lưu raw_text ở transit_links.';

create index idx_devices_station on devices(station_id);

-- ----------------------------------------------------------------------------
-- 3.2 racks — ODF/Rack/Block (dùng chung cho trunk & device qua cột domain)
-- ----------------------------------------------------------------------------
create table racks (
  id                uuid primary key default gen_random_uuid(),
  station_id        uuid not null references stations(id),
  code              text not null,         -- vd 'ODF1/1', 'ODF6/1 Block ƯC'
  domain            rack_domain not null,
  odf_type          odf_type not null,
  -- Block con gắn thêm vào 1 rack cha (vd Block ƯC gắn vào ODF1/3).
  parent_rack_id    uuid references racks(id),
  -- Chỉ set khi domain = 'device': rack DDF này thuộc thiết bị nào.
  device_id         uuid references devices(id),
  port_count        int not null check (port_count > 0),
  cable_route_name  text,                  -- chỉ có nghĩa khi domain = 'trunk'
  notes             text
);

comment on column racks.domain is
  'trunk = ODF trung kế, device = ODF/DDF thiết bị. Dùng chung 1 bảng để cho phép transit_links nối thẳng port trunk <-> port device không cần bảng thứ 3.';
comment on column racks.odf_type is
  'Gắn ở cấp rack HOẶC block con, vì 1 rack hàn nối vẫn có thể chứa 1 block con kiểu phân phối.';

create index idx_racks_station on racks(station_id);
create index idx_racks_parent on racks(parent_rack_id);
create index idx_racks_device on racks(device_id);

-- ----------------------------------------------------------------------------
-- 3.3 ports — Port/Sợi vật lý. QUAN TRỌNG: 1 dòng = 1 port/sợi, không gộp
-- Tx/Rx (xem CLAUDE.md nguyên tắc dữ liệu #1).
-- ----------------------------------------------------------------------------
create table ports (
  id            uuid primary key default gen_random_uuid(),
  rack_id       uuid not null references racks(id) on delete cascade,
  port_number   int not null,
  fiber_number  int,                       -- chỉ có nghĩa với domain=trunk
  medium        port_medium not null default 'fiber',
  status        port_status not null default 'unused',
  unique (rack_id, port_number)
);

create index idx_ports_rack on ports(rack_id);
-- Phục vụ "tìm port/sợi trống theo tuyến cáp" (architecture.md mục 4.3).
create index idx_ports_status on ports(status);

-- ----------------------------------------------------------------------------
-- 3.4 circuits — Luồng (entity riêng, KHÔNG lưu port trực tiếp ở đây)
-- ----------------------------------------------------------------------------
create table circuits (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,   -- vd '100GE ADN1.P2(1/0/3) - 2T9.P1(4/0/3)'
  interface_type          text,            -- '100GE','10GE','STM16','DWDM'...
  circuit_role            circuit_role not null default 'active',
  counterpart_text        text,            -- ODF đối phương dạng text tự do
  counterpart_port_id     uuid references ports(id),
  response_plan_text      text,            -- luôn cho nhập text tự do
  -- Tùy chọn — KHÔNG bắt buộc nhập khi lưu form (CLAUDE.md nguyên tắc #3).
  response_plan_port_id   uuid references ports(id),
  execution_station_text  text,
  notes                   text
);

comment on column circuits.response_plan_port_id is
  'Liên kết bán cấu trúc TÙY CHỌN tới port dự phòng cụ thể — để trống vẫn hợp lệ, điền dần sau.';

-- Full-text/gần-đúng theo tên luồng (mục 4.3: tìm theo tên luồng / port / sợi).
create index idx_circuits_name_trgm on circuits using gin (name gin_trgm_ops);
create index idx_circuits_role on circuits(circuit_role);

-- ----------------------------------------------------------------------------
-- 3.5 port_circuit_links — Nối Port <-> Luồng
-- unique(port_id): 1 port chỉ thuộc 1 luồng tại 1 thời điểm.
-- Việc gộp hiển thị 2 sợi liền kề thành 1 dòng CHỈ làm ở tầng UI/view,
-- không gộp ở đây (CLAUDE.md nguyên tắc #1, #2 — lỗi hay gặp nhất cần tránh).
-- ----------------------------------------------------------------------------
create table port_circuit_links (
  id          uuid primary key default gen_random_uuid(),
  port_id     uuid not null unique references ports(id) on delete cascade,
  circuit_id  uuid not null references circuits(id) on delete cascade,
  link_role   link_role not null default 'single'
);

create index idx_pcl_circuit on port_circuit_links(circuit_id);

-- ----------------------------------------------------------------------------
-- 3.6 transit_links — Chuyển tiếp (trunk <-> device <-> thiết bị)
-- Cho phép để trống liên kết chuẩn hóa (target_type='text_only', chỉ raw_text)
-- và chuẩn hóa dần sau — không bắt buộc (CLAUDE.md nguyên tắc #3).
-- ----------------------------------------------------------------------------
create table transit_links (
  id                uuid primary key default gen_random_uuid(),
  source_port_id    uuid not null references ports(id) on delete cascade,
  target_type       transit_target_type not null default 'text_only',
  target_port_id    uuid references ports(id),
  target_device_id  uuid references devices(id),
  raw_text          text,            -- luôn lưu lại text gốc, không mất dữ liệu
  constraint chk_transit_target check (
    (target_type = 'port'          and target_port_id   is not null) or
    (target_type = 'device_direct' and target_device_id is not null) or
    (target_type in ('cable_out', 'text_only'))
  )
);

create index idx_transit_source on transit_links(source_port_id);
create index idx_transit_target_port on transit_links(target_port_id);
create index idx_transit_target_device on transit_links(target_device_id);

-- ----------------------------------------------------------------------------
-- 3.9 import_batches — log mỗi lần import Excel để truy vết
-- ----------------------------------------------------------------------------
create table import_batches (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null,
  imported_at timestamptz not null default now(),
  imported_by text,
  row_count   int,
  status      text,
  error_log   jsonb
);

-- ============================================================================
-- KHÔNG tạo ở đây (theo architecture.md mục 3.8 & mục 5 — dành cho giai đoạn 2):
--   user_roles, audit_log, edit_locks, dashboard_configs
-- Sẽ thêm migration riêng khi bắt đầu giai đoạn multi-user / dashboard UI.
-- ============================================================================
