import { supabase } from "@/lib/supabase";

// Gợi ý "vừa chọn vừa gõ tay" cho form nhập/sửa luồng ODF trung kế — lấy từ
// chính dữ liệu đã có (không phải danh sách cứng), để luôn khớp thực tế và
// tránh mỗi người gõ 1 kiểu khác nhau (vd "ODF1/2/(1,2)" vs "ODF 1/2(1,2)")
// làm hỏng khả năng tìm kiếm sau này.
export interface CircuitOptions {
  interfaceTypes: string[];
  executionStations: string[];
  transitTexts: string[];
}

async function fetchDistinctNonNull(
  table: "circuits" | "transit_links",
  column: "interface_type" | "execution_station_text" | "raw_text"
): Promise<string[]> {
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

export async function fetchCircuitOptions(): Promise<CircuitOptions> {
  const [interfaceTypes, stationRaw, transitTexts] = await Promise.all([
    fetchDistinctNonNull("circuits", "interface_type"),
    fetchDistinctNonNull("circuits", "execution_station_text"),
    fetchDistinctNonNull("transit_links", "raw_text"),
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
