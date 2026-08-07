import type { SupabaseClient } from "@supabase/supabase-js";

// "Lịch sử tra cứu" — xem migration 20260808000001_report_history.sql. Dùng
// CHUNG cho cả Hồ sơ ODF trung kế lẫn Hồ sơ đấu nối (yêu cầu người dùng
// 2026-08-07), không tách riêng theo trang.
export interface ReportHistoryRow {
  id: string;
  circuitId: string;
  reportText: string;
  accessedAt: string;
}

interface RawRow {
  id: string;
  circuit_id: string;
  report_text: string;
  accessed_at: string;
}

export async function fetchReportHistory(client: SupabaseClient): Promise<ReportHistoryRow[]> {
  const { data, error } = await client
    .from("report_history")
    .select("id, circuit_id, report_text, accessed_at")
    .order("accessed_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as RawRow[]).map((r) => ({
    id: r.id,
    circuitId: r.circuit_id,
    reportText: r.report_text,
    accessedAt: r.accessed_at,
  }));
}

// "Lưu vào lịch sử" — cập nhật đè nếu luồng đã có dòng (unique(circuit_id)),
// không tạo dòng trùng — đúng quyết định người dùng 2026-08-07.
export async function upsertReportHistory(client: SupabaseClient, circuitId: string, reportText: string): Promise<void> {
  const { error } = await client
    .from("report_history")
    .upsert({ circuit_id: circuitId, report_text: reportText, accessed_at: new Date().toISOString() }, { onConflict: "circuit_id" });
  if (error) throw error;
}

export async function deleteReportHistoryEntry(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from("report_history").delete().eq("id", id);
  if (error) throw error;
}
