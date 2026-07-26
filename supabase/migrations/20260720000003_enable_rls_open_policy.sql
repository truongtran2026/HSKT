-- ============================================================================
-- Migration: bật RLS + policy mở toàn quyền cho MVP single-user
--
-- Lý do (phát sinh khi test thật, KHÔNG có trong architecture.md ban đầu):
-- architecture.md mục 2 giả định "Giai đoạn 1: RLS tắt hoặc mở toàn quyền,
-- dùng anon key trực tiếp" theo kiểu key cũ (anon/service_role). Nhưng
-- Supabase đã đổi sang hệ key mới (Publishable/Secret) — với hệ key mới,
-- publishable key CHỈ đọc được dữ liệu khi bảng đã bật RLS và có policy cho
-- phép; nếu RLS tắt, publishable key trả về mảng RỖNG (không lỗi, rất dễ
-- nhầm là bug code) thay vì thấy toàn bộ dữ liệu như hành vi anon key cũ.
--
-- Cách xử lý: bật RLS trên mọi bảng + tạo 1 policy "cho phép tất cả" — về
-- HIỆU QUẢ vẫn giống "RLS tắt" (single-user, không phân quyền) như
-- architecture.md mục 2 dự định cho giai đoạn 1, chỉ khác cách triển khai để
-- tương thích hệ key mới. Giai đoạn 2 (multi-user) sẽ THAY policy này bằng
-- policy theo user_roles, không phải bật RLS từ đầu (đã bật sẵn ở đây).
-- ============================================================================

alter table stations enable row level security;
alter table devices enable row level security;
alter table racks enable row level security;
alter table ports enable row level security;
alter table circuits enable row level security;
alter table port_circuit_links enable row level security;
alter table transit_links enable row level security;
alter table import_batches enable row level security;

create policy "mvp_allow_all" on stations for all using (true) with check (true);
create policy "mvp_allow_all" on devices for all using (true) with check (true);
create policy "mvp_allow_all" on racks for all using (true) with check (true);
create policy "mvp_allow_all" on ports for all using (true) with check (true);
create policy "mvp_allow_all" on circuits for all using (true) with check (true);
create policy "mvp_allow_all" on port_circuit_links for all using (true) with check (true);
create policy "mvp_allow_all" on transit_links for all using (true) with check (true);
create policy "mvp_allow_all" on import_batches for all using (true) with check (true);
