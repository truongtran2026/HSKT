import type { SupabaseClient } from "@supabase/supabase-js";

// Danh sách LĨNH VỰC thật (bảng `device_categories`, migration
// 20260818000001) — tách khỏi `devices.category` (yêu cầu người dùng
// 2026-08-18: "làm sao thêm lĩnh vực (ATBM), xóa lĩnh vực thì sao (xóa phải
// không còn thiết bị thuộc lĩnh vực đó mới xóa được)"). `devices.category`
// vẫn là cột TEXT như cũ, chỉ THÊM ràng buộc khóa ngoại tới bảng này (on
// delete restrict — Postgres tự chặn xóa khi còn thiết bị tham chiếu).
export async function fetchDeviceCategories(client: SupabaseClient): Promise<string[]> {
  const { data, error } = await client.from("device_categories").select("name").order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.name as string);
}
