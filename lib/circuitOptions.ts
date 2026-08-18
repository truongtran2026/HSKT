import type { SupabaseClient } from "@supabase/supabase-js";

// Gợi ý "vừa chọn vừa gõ tay" cho form nhập/sửa luồng ODF trung kế — lấy từ
// chính dữ liệu đã có (không phải danh sách cứng), để luôn khớp thực tế và
// tránh mỗi người gõ 1 kiểu khác nhau (vd "ODF1/2/(1,2)" vs "ODF 1/2(1,2)")
// làm hỏng khả năng tìm kiếm sau này.
export interface CircuitOptions {
  interfaceTypes: string[];
  executionStations: string[];
  transitTexts: string[];
}

// Đợt 3 (2026-08-06): tham số `client` BẮT BUỘC — xem giải thích đầy đủ ở
// lib/devices.ts / lib/trunkPorts.ts (không lặp lại toàn bộ đoạn ở đây).
async function fetchDistinctNonNull(
  client: SupabaseClient,
  table: "circuits" | "transit_links",
  column: "interface_type" | "execution_station_text" | "raw_text"
): Promise<string[]> {
  const supabase = client;
  const values = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .not(column, "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, string | null>[];
    for (const row of rows) {
      const v = row[column];
      if (v && v.trim()) values.add(v.trim());
    }
    if (rows.length < pageSize) break;
  }
  return [...values];
}

export async function fetchCircuitOptions(client: SupabaseClient): Promise<CircuitOptions> {
  const [interfaceTypes, stationRaw, transitTexts] = await Promise.all([
    fetchDistinctNonNull(client, "circuits", "interface_type"),
    fetchDistinctNonNull(client, "circuits", "execution_station_text"),
    fetchDistinctNonNull(client, "transit_links", "raw_text"),
  ]);

  // "Trạm thực hiện" cho phép chọn NHIỀU trạm cùng lúc (nối bằng dấu phẩy) —
  // tách từng token đã lưu trước đó ra thành danh sách trạm đơn lẻ để làm
  // gợi ý chọn, thay vì để nguyên cả cụm đã ghép.
  const stations = new Set<string>();
  for (const raw of stationRaw) {
    for (const token of raw.split(/[,;]/)) {
      const t = token.trim();
      if (t) stations.add(t);
    }
  }

  return {
    interfaceTypes: [...interfaceTypes].sort((a, b) => a.localeCompare(b)),
    executionStations: [...stations].sort((a, b) => a.localeCompare(b)),
    transitTexts: [...transitTexts].sort((a, b) => a.localeCompare(b)),
  };
}

// Phát hiện gõ THIẾU hậu tố chuẩn ở ô "Giao tiếp" (yêu cầu người dùng
// 2026-08-18: "100GE thì lại gõ là 100, 10GE thì gõ là 10" — lỗi hay gặp
// nhất khi sửa nhanh, tay lỡ xóa mất hậu tố). Chỉ gợi ý khi giá trị gõ hoàn
// toàn là SỐ (an toàn — "STM1"/"FE" không phải lỗi thiếu hậu tố, không nên
// gợi ý lung tung) và ghép thêm đúng 1 hậu tố đã biết ("GE"/"G"/"M", đúng 3
// hậu tố xuất hiện trong dữ liệu thật: 10GE/100GE/1GE, 4G, 65M/90M) ra TRÙNG
// 1 giá trị ĐÃ TỪNG DÙNG thật trong hệ thống — không suy đoán mù, chỉ gợi ý
// khi chắc chắn khớp dữ liệu có sẵn.
export function suggestInterfaceTypeFix(value: string, knownTypes: readonly string[]): string | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const knownSet = new Set(knownTypes);
  for (const suffix of ["GE", "G", "M"]) {
    const candidate = `${trimmed}${suffix}`;
    if (knownSet.has(candidate)) return candidate;
  }
  return null;
}
