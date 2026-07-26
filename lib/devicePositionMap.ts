import { supabase } from "@/lib/supabase";

// Tra cứu "thiết bị + vị trí thiết bị -> vị trí ODF/DDF" — xem migration
// 20260724000001_device_position_map.sql. Bảng độc lập, KHÔNG đụng
// circuits/devices, vì 1 thiết bị có thể có nhiều vị trí ra ODF/DDF khác nhau.
export interface DevicePositionMapRow {
  id: string;
  deviceName: string;
  devicePosition: string | null;
  odfPosition: string | null;
}

interface RawRow {
  id: string;
  device_name: string;
  device_position: string | null;
  odf_position: string | null;
}

export async function fetchDevicePositionMap(): Promise<DevicePositionMapRow[]> {
  const pageSize = 1000;
  const all: RawRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("device_position_map")
      .select("id, device_name, device_position, odf_position")
      .order("device_name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as RawRow[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all.map((r) => ({
    id: r.id,
    deviceName: r.device_name,
    devicePosition: r.device_position,
    odfPosition: r.odf_position,
  }));
}
