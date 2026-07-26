// Kiểu dữ liệu TypeScript viết tay, khớp 1-1 với migration
// supabase/migrations/20260720000001_init_schema.sql (= architecture.md mục 3).
//
// Khi schema thay đổi (sau khi hỏi & xác nhận với người dùng theo CLAUDE.md),
// PHẢI sửa file này cùng lúc để tránh lệch kiểu dữ liệu.
//
// Ghi chú: nếu sau này cài Supabase CLI, có thể thay file này bằng lệnh
// `supabase gen types typescript` để tự sinh — nhưng để tránh phụ thuộc CLI
// ngay từ đầu, MVP viết tay theo đúng migration.

export type RackDomain = "trunk" | "device";
export type OdfType = "welded" | "distribution";
export type PortMedium = "fiber" | "copper";
export type PortStatus = "unused" | "in_use" | "standby";
export type CircuitRole = "active" | "standby";
export type LinkRole = "tx" | "rx" | "single";
export type TransitTargetType = "port" | "device_direct" | "cable_out" | "text_only";
export type DeviceSource = "auto" | "manual";

export interface Station {
  id: string;
  code: string;
  name: string;
  is_managed: boolean;
}

export interface Device {
  id: string;
  station_id: string;
  name: string;
  coordinate_text: string | null;
  full_label: string | null;
  source: DeviceSource;
}

export interface Rack {
  id: string;
  station_id: string;
  code: string;
  domain: RackDomain;
  odf_type: OdfType;
  parent_rack_id: string | null;
  device_id: string | null;
  port_count: number;
  cable_route_name: string | null;
  notes: string | null;
}

export interface Port {
  id: string;
  rack_id: string;
  port_number: number;
  fiber_number: number | null;
  medium: PortMedium;
  status: PortStatus;
}

export interface Circuit {
  id: string;
  name: string;
  interface_type: string | null;
  circuit_role: CircuitRole;
  counterpart_text: string | null;
  counterpart_port_id: string | null;
  response_plan_text: string | null;
  response_plan_port_id: string | null;
  execution_station_text: string | null;
  /** Cột "Trib" (M3.TD-1_2, ODF/DDF thiết bị) — vị trí cổng vật lý tại thiết bị. */
  trib_text: string | null;
  /** Chỉ có nghĩa khi luồng thuộc domain=device (chưa gán port nào). */
  device_id: string | null;
  /** Vị trí ODF/DDF CHÍNH thiết bị đấu cáp ra (domain=device). */
  device_position_own: string | null;
  /** Vị trí ODF tiếp theo / nhảy lên ODF trung kế (domain=device). */
  device_position_next: string | null;
  notes: string | null;
}

export interface PortCircuitLink {
  id: string;
  port_id: string;
  circuit_id: string;
  link_role: LinkRole;
}

export interface TransitLink {
  id: string;
  source_port_id: string;
  target_type: TransitTargetType;
  target_port_id: string | null;
  target_device_id: string | null;
  raw_text: string | null;
}

export interface ImportBatch {
  id: string;
  file_name: string;
  imported_at: string;
  imported_by: string | null;
  row_count: number | null;
  status: string | null;
  error_log: Record<string, unknown> | null;
}

// Kiểu Database tổng hợp — mô tả lại đúng schema Postgres để tham khảo/khai
// báo tay (vd `const rows: Circuit[] = ...`). KHÔNG dùng làm generic cho
// createClient<Database>(...) — bản @supabase/postgrest-js hiện tại đòi hỏi
// khớp chính xác cơ chế suy luận kiểu nội bộ (select-query-parser theo từng
// chuỗi select), viết tay rất dễ lệch và khiến insert/select bị suy nhầm ra
// "never" (đã gặp lỗi này khi build thật). Nếu sau này cần client có kiểu
// chặt chẽ, dùng lệnh `supabase gen types typescript` để tự sinh thay vì viết
// tay file này.
export interface Database {
  public: {
    Tables: {
      stations: { Row: Station; Insert: Partial<Station> & Pick<Station, "code" | "name">; Update: Partial<Station>; Relationships: [] };
      devices: { Row: Device; Insert: Partial<Device> & Pick<Device, "station_id" | "name">; Update: Partial<Device>; Relationships: [] };
      racks: { Row: Rack; Insert: Partial<Rack> & Pick<Rack, "station_id" | "code" | "domain" | "odf_type" | "port_count">; Update: Partial<Rack>; Relationships: [] };
      ports: { Row: Port; Insert: Partial<Port> & Pick<Port, "rack_id" | "port_number">; Update: Partial<Port>; Relationships: [] };
      circuits: { Row: Circuit; Insert: Partial<Circuit> & Pick<Circuit, "name">; Update: Partial<Circuit>; Relationships: [] };
      port_circuit_links: { Row: PortCircuitLink; Insert: Partial<PortCircuitLink> & Pick<PortCircuitLink, "port_id" | "circuit_id">; Update: Partial<PortCircuitLink>; Relationships: [] };
      transit_links: { Row: TransitLink; Insert: Partial<TransitLink> & Pick<TransitLink, "source_port_id">; Update: Partial<TransitLink>; Relationships: [] };
      import_batches: { Row: ImportBatch; Insert: Partial<ImportBatch> & Pick<ImportBatch, "file_name">; Update: Partial<ImportBatch>; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}
