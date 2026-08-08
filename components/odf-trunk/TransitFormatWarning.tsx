"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { NonConformingTransitLink } from "@/lib/transitLinks";
import RoleGate from "@/components/ui/RoleGate";
import { IconCheck } from "@/components/ui/icons";
import { compareRackCode } from "@/lib/rackCode";
import { useCollapsed } from "@/lib/useCollapsed";

// Danh sách "Chuyển tiếp chưa đúng chuẩn form" (yêu cầu người dùng 2026-07-28)
// — cùng kiểu UI với khung "positionConflicts" đã có ở DeviceCircuitList.tsx
// (tìm/phân trang, KHÔNG tự sửa). Bấm 1 dòng nhảy sang đúng port ở trang rack
// đó (`/odf-trunk/<rackId>#port-<portId>`, xem PortTable.tsx phần đọc hash).
// Nút "Ack" (yêu cầu người dùng 2026-07-29) cho dòng thực chất PHẢI ghi khác
// chuẩn (không phải lỗi) — ghi transit_links.format_ack=true rồi
// router.refresh() để Server Component (fetchNonConformingTransitLinks) tải
// lại danh sách mới KHÔNG còn dòng đó (lib/transitLinks.ts đã lọc format_ack).
// openInNewTab (yêu cầu người dùng 2026-08-02, riêng khi dùng TRONG trang
// "Chất lượng dữ liệu") — bấm 1 dòng ở đó mở tab trình duyệt MỚI để sửa, sửa
// xong đóng tab là quay lại NGUYÊN trạng thái tab "Chất lượng dữ liệu" (đang
// lọc/đang ở tab con nào vẫn giữ nguyên, không phải bấm lại "← Danh sách rack"
// rồi chuyển tab thủ công như trước). CHỈ bật ở nơi gọi từ DataQualityClient —
// 2 nơi gọi còn lại (`/odf-trunk`, `/odf-trunk/[rackId]`) giữ hành vi cũ
// (điều hướng cùng tab) vì ở đó bấm vào là đang xem ĐÚNG rack/danh sách liên
// quan, mở thêm tab mới không cần thiết.
export default function TransitFormatWarning({
  items,
  openInNewTab,
}: {
  items: NonConformingTransitLink[];
  openInNewTab?: boolean;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [page, setPage] = useState(0);
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const { collapsed, toggle } = useCollapsed("hskt:collapsed:transitFormatWarning");

  async function ack(id: string) {
    setAckingId(id);
    setAckError(null);
    const { error } = await supabase.from("transit_links").update({ format_ack: true }).eq("id", id);
    setAckingId(null);
    if (error) {
      setAckError(error.message);
      return;
    }
    router.refresh();
  }

  const sorted = useMemo(
    () => [...items].sort((a, b) => compareRackCode(a.rackCode, b.rackCode) || a.portNumber - b.portNumber),
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((it) => it.rawText.toLowerCase().includes(q) || it.rackCode.toLowerCase().includes(q));
  }, [sorted, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageClamped = Math.min(page, pageCount - 1);
  const paged = filtered.slice(pageClamped * pageSize, pageClamped * pageSize + pageSize);

  function changeSearch(v: string) {
    setSearch(v);
    setPage(0);
  }

  function changePageSize(v: number) {
    setPageSize(v);
    setPage(0);
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-amber-800">Phát hiện {items.length} "Chuyển tiếp" chưa đúng chuẩn form</h2>
        <button
          type="button"
          onClick={toggle}
          className="shrink-0 rounded border border-amber-300 px-2 py-0.5 text-sm font-bold text-amber-700 hover:bg-amber-100"
          title={collapsed ? "Mở rộng" : "Thu gọn"}
          aria-label={collapsed ? "Mở rộng" : "Thu gọn"}
        >
          {collapsed ? "+" : "−"}
        </button>
      </div>
      {collapsed ? null : (
        <>
          <p className="mt-1 text-xs text-amber-700">
            Chuẩn form hợp lệ: (1) &quot;ODF x/y (a,b) - ADN1.thiết bị (port)&quot;, hoặc (2) &quot;ODF x/y (a,b) - Tên ODF
            Trung kế&quot; (trỏ thẳng sang rack trung kế khác, không qua thiết bị). Không tự sửa — nhiều trường hợp khác
            vẫn có thể đúng (vd đi thẳng ra trạm khác không qua thiết bị/ODF ADN1 nào). Bấm vào 1 dòng để nhảy tới đúng
            port rồi tự sửa tay, hoặc bấm &quot;Ack&quot; nếu dòng đó vốn dĩ phải ghi khác 2 form trên (không phải lỗi) —
            Ack rồi sẽ không hiện lại nữa.
          </p>
          {ackError && <p className="mt-1 text-xs text-red-600">Lỗi khi Ack: {ackError}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              className="input w-auto max-w-[260px] border-amber-300"
              placeholder="Lọc theo rack / nội dung..."
              value={search}
              onChange={(e) => changeSearch(e.target.value)}
            />
            <span className="text-xs text-amber-600">
              {filtered.length}/{items.length} dòng
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-amber-700">
              Số dòng/trang:
              <select className="input w-auto py-1" value={pageSize} onChange={(e) => changePageSize(Number(e.target.value))}>
                {[5, 10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-2 max-h-80 space-y-1 overflow-y-auto text-sm text-amber-800">
            {paged.map((it) => (
              <li key={it.id} className="flex items-start justify-between gap-2">
                <Link
                  href={`/odf-trunk/${it.rackId}#port-${it.portId}`}
                  target={openInNewTab ? "_blank" : undefined}
                  rel={openInNewTab ? "noopener noreferrer" : undefined}
                  className="min-w-0 flex-1 break-words hover:underline"
                >
                  <span className="font-medium">
                    {it.rackCode} port {it.portNumber}:
                  </span>{" "}
                  &quot;{it.rawText}&quot;
                </Link>
                <RoleGate allow={["operator", "admin"]}>
                  <button
                    type="button"
                    className="btn-secondary flex shrink-0 items-center gap-1 px-2 py-0.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => ack(it.id)}
                    disabled={ackingId === it.id}
                    title="Ack — xác nhận đã xem, dòng này vốn dĩ phải ghi khác form chuẩn, bỏ qua không hiện lại"
                    aria-label="Ack"
                  >
                    <IconCheck className="h-3.5 w-3.5" />
                    {ackingId === it.id ? "Đang..." : "Ack"}
                  </button>
                </RoleGate>
              </li>
            ))}
            {paged.length === 0 && <li className="text-amber-400">Không có dòng nào khớp bộ lọc.</li>}
          </ul>

          {pageCount > 1 && (
            <div className="mt-2 flex items-center gap-2 text-sm text-amber-700">
              <button
                className="btn-secondary px-2 py-1"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={pageClamped === 0}
              >
                ← Trước
              </button>
              <span>
                Trang {pageClamped + 1}/{pageCount}
              </span>
              <button
                className="btn-secondary px-2 py-1"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={pageClamped >= pageCount - 1}
              >
                Sau →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
