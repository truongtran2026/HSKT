import { supabase } from "@/lib/supabase";

export interface DeviceRow {
  id: string;
  name: string;
  source: "auto" | "manual";
  category: string | null;
  updatedAt: string;
}

interface RawDeviceRow {
  id: string;
  name: string;
  source: "auto" | "manual";
  category: string | null;
  updated_at: string;
}

export async function fetchDevices(): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id, name, source, category, updated_at")
    .order("name", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as RawDeviceRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    source: r.source,
    category: r.category,
    updatedAt: r.updated_at,
  }));
}

// Nhãn hiển thị khi thiết bị chưa có lĩnh vực (thiết bị chuẩn hóa từ trước
// lô import 126 file 2026-07-25, xem migration devices.category).
export const UNCATEGORIZED_LABEL = "Chưa phân loại";

export function deviceCategoryLabel(category: string | null): string {
  return category ?? UNCATEGORIZED_LABEL;
}

// Theo mục 1/7.2: devices chỉ tự sinh cho trạm ADN1 — dùng chung 1 station_id
// cho mọi lần tạo devices mới từ UI chuẩn hóa.
export async function getAdn1StationId(): Promise<string> {
  const { data, error } = await supabase.from("stations").select("id").eq("code", "ADN1").single();
  if (error) throw error;
  return data.id as string;
}
