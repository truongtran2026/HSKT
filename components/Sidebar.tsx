"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/ui/CommandPalette";

// "Xem" và "Sửa" từng tách riêng ở giai đoạn skeleton (khi CRUD thật chưa
// tồn tại) nhưng ODF trung kế đã gộp xem+sửa ngay tại chỗ từ lâu (PortTable
// có sẵn nút Sửa) nên không tách riêng nữa. Riêng "Hồ sơ ODF Thiết bị" lại
// tách LẠI thành 2 mục (yêu cầu người dùng 2026-07-28): "Hồ sơ" giờ là danh
// sách rack/port xem theo cấu trúc giống trung kế (DeviceRackPortView, chỉ
// xem — không có port_circuit_links thật để sửa tại chỗ như trung kế, xem
// architecture.md), còn "Hồ sơ đấu nối" (DeviceCircuitList, đổi tên từ "Sửa
// luồng thiết bị" — yêu cầu người dùng 2026-07-28) mới là nơi duy nhất
// Thêm/Sửa/Xóa chi tiết luồng. Dashboard (thống kê tổng quan) tách nhóm riêng
// lên đầu, phần hồ sơ/chi tiết số liệu để nhóm dưới cho đỡ rối.
const menuGroups = [
  {
    label: "Thống kê",
    items: [{ href: "/dashboard", label: "Dashboard" }],
  },
  {
    label: "Hồ sơ",
    items: [
      { href: "/odf-trunk", label: "Hồ sơ ODF Trung kế" },
      { href: "/odf-device", label: "Hồ sơ ODF Thiết bị" },
      { href: "/odf-device/sua-luong", label: "Hồ sơ đấu nối" },
      { href: "/search", label: "Tìm kiếm nhanh" },
      { href: "/data-quality", label: "Chất lượng dữ liệu" },
    ],
  },
  {
    label: "Cài đặt",
    items: [
      { href: "/import-export", label: "Import / Export Excel" },
      { href: "/devices", label: "Danh mục thiết bị" },
      { href: "/settings", label: "Cài đặt chung" },
    ],
  },
];

const PIN_STORAGE_KEY = "sidebar-pinned";

export default function Sidebar() {
  const pathname = usePathname();
  // Ghim/bỏ ghim (yêu cầu người dùng 2026-07-28: tăng bề rộng khung nhìn khi
  // cần cập nhật hồ sơ) — mặc định pinned=true (giữ đúng hành vi cũ cho lần
  // mở đầu tiên), đọc lại lựa chọn đã lưu ở useEffect (localStorage chỉ có ở
  // trình duyệt, không đọc được lúc component này render ở server) nên có thể
  // nháy 1 khung hình nếu trước đó đã bỏ ghim — chấp nhận được, không đáng
  // làm phức tạp hơn (vd cookie) chỉ để tránh 1 khung hình đó.
  const [pinned, setPinned] = useState(true);
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(PIN_STORAGE_KEY);
      if (saved !== null) setPinned(saved === "true");
    } catch {
      /* localStorage không dùng được (vd chế độ ẩn danh chặn) — giữ mặc định */
    }
  }, []);

  function togglePinned() {
    setPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PIN_STORAGE_KEY, String(next));
      } catch {
        /* bỏ qua nếu localStorage không dùng được */
      }
      if (next) setHovering(false);
      return next;
    });
  }

  const visible = pinned || hovering;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2 px-5 py-5 border-b border-primary-600">
        <span className="text-xl font-bold tracking-wide">Hồ sơ kỹ thuật</span>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Nút tìm kiếm luôn hiện (yêu cầu người dùng: không được để tính
              năng Command Palette chỉ truy cập qua phím tắt Cmd/Ctrl+K, vd
              trên máy không có bàn phím vật lý/mobile) — bắn CustomEvent cho
              CommandPalette.tsx tự mở, xem giải thích ở file đó. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT))}
            className="rounded border border-primary-500 px-2 py-0.5 text-xs text-primary-100 hover:bg-primary-600/60 hover:text-white"
            title="Tìm kiếm nhanh (Cmd/Ctrl + K)"
          >
            🔍
          </button>
          <button
            type="button"
            onClick={togglePinned}
            className="rounded border border-primary-500 px-2 py-0.5 text-xs text-primary-100 hover:bg-primary-600/60 hover:text-white"
            title={
              pinned
                ? "Bỏ ghim — ẩn bớt khung này để tăng bề rộng cho nội dung chính, đưa chuột sát mép trái để hiện lại tạm thời"
                : "Ghim cố định — luôn hiện khung này"
            }
          >
            {pinned ? "Bỏ ghim" : "Ghim"}
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {menuGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {/* text-sm (trước text-xs) — yêu cầu người dùng 2026-07-28: tiêu
                đề nhóm (THỐNG KÊ/HỒ SƠ/CÀI ĐẶT) cần to hơn để dễ phân biệt với
                danh sách mục bên dưới. */}
            <div className="px-5 py-1 text-sm font-semibold uppercase tracking-wider text-primary-200">
              {group.label}
            </div>
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={`${group.label}-${item.href}`}
                  href={item.href}
                  className={
                    "block px-5 py-2 text-sm transition-colors " +
                    (active
                      ? "bg-primary-600 text-white font-medium"
                      : "text-primary-100 hover:bg-primary-600/60")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="px-5 py-3 border-t border-primary-600 text-xs text-primary-200">
        Giai đoạn MVP · single-user
      </div>
    </>
  );

  if (pinned) {
    // sticky (KHÔNG chỉ min-h-screen như trước) — yêu cầu người dùng
    // 2026-07-28: "Khi scroll thanh ngoài cùng thì sidebar bên trái này cũng
    // scroll theo xuống luôn. đúng ra nó phải cố định chứ". Trang không có
    // khung cuộn riêng cho <main> (xem app/layout.tsx) — cả <body> cuộn
    // chung, nên sidebar cũ (chỉ min-h-screen, không sticky/fixed) bị trôi
    // lên theo khi cuộn sâu. sticky top-0 h-screen giữ nó luôn nằm yên trong
    // khung nhìn, mà vẫn chiếm đúng chỗ trong flex layout — không cần main tự
    // bù lề như khi dùng position:fixed.
    return (
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-primary-700 text-white">
        {body}
      </aside>
    );
  }

  // Bỏ ghim: KHÔNG chiếm chỗ trong layout nữa (main tự giãn full-width) —
  // hiện lại dạng overlay đè lên khi rê chuột sát mép trái, tự ẩn khi rê
  // chuột ra khỏi khung (yêu cầu người dùng 2026-07-28). Dải mỏng bên trái
  // luôn tồn tại (kể cả lúc overlay đang hiện, nằm dưới overlay) làm nơi hover
  // lại nếu chuột rời khung rồi quay lại ngay.
  return (
    <>
      <div
        className="fixed left-0 top-0 z-40 h-screen w-3"
        onMouseEnter={() => setHovering(true)}
        title="Đưa chuột vào đây để hiện lại Hồ sơ kỹ thuật"
      >
        <div className="h-full w-1 bg-primary-700/40" />
      </div>
      <aside
        onMouseLeave={() => setHovering(false)}
        className={
          "fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-primary-700 text-white shadow-xl transition-transform duration-200 " +
          (visible ? "translate-x-0" : "-translate-x-full")
        }
      >
        {body}
      </aside>
    </>
  );
}
