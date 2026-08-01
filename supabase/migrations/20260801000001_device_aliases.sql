-- device_aliases: mapping nhiều cách gõ khác nhau của CÙNG 1 thiết bị (yêu
-- cầu người dùng 2026-08-01, xem architecture.md mục 43) — ghi lại mỗi lần
-- người dùng xác nhận "chữ gõ X thực ra là thiết bị Y đã có" (qua gợi ý so
-- khớp lỏng ở ô "Thiết bị" trong PortTable.tsx), để lần sau gõ lại đúng chữ
-- X đó sẽ tự nhận ra ngay là thiết bị Y, không hỏi lại/không tạo trùng nữa.
create table if not exists device_aliases (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references devices(id) on delete cascade,
  alias_text text not null,
  -- normalizeDeviceNameKey(alias_text) (lib/deviceNotes.ts) — unique để 1
  -- cách gõ không bao giờ trỏ mơ hồ sang 2 thiết bị khác nhau.
  normalized_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists device_aliases_device_id_idx on device_aliases (device_id);
