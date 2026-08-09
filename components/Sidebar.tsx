"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { COMMAND_PALETTE_OPEN_EVENT } from "@/components/ui/CommandPalette";
import { supabase } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/roleLabel";
import { IconPin, IconPinOff } from "@/components/ui/icons";

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
//
// Đợt 4 audit mục 3.3 (2026-08-07) — người dùng XÁC NHẬN giữ "Hồ sơ ODF Thiết
// bị" và "Hồ sơ đấu nối" tách riêng (đề xuất gộp 2 mục này của audit ĐI NGƯỢC
// quyết định 2026-07-28 ở trên, hỏi lại và người dùng chọn giữ nguyên — xem
// architecture.md mục 73). Chỉ làm phần KHÔNG mâu thuẫn của đề xuất: gom "Chất
// lượng dữ liệu"/"Danh mục thiết bị"/"Thư viện vị trí thiết bị"/"Import Export"/
// "Cài đặt chung" (ít dùng hằng ngày hơn 3 mục Hồ sơ) vào 1 nhóm "Quản trị";
// bỏ "Tìm kiếm nhanh" khỏi sidebar — Cmd/Ctrl+K + nút 🔍 đã thay thế tốt hơn,
// trang /search vẫn còn, chỉ chuyển link vào trong CommandPalette (xem
// CommandPalette.tsx, dòng "Xem tất cả kết quả tìm kiếm").
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
    ],
  },
  {
    label: "Quản trị",
    items: [
      { href: "/data-quality", label: "Chất lượng dữ liệu" },
      { href: "/devices", label: "Danh mục thiết bị" },
      { href: "/odf-device/vi-tri-thiet-bi", label: "Thư viện vị trí thiết bị" },
      { href: "/import-export", label: "Import/Export dữ liệu" },
      { href: "/settings", label: "Cài đặt chung" },
    ],
  },
];

const PIN_STORAGE_KEY = "sidebar-pinned";

// Nhãn hiển thị + màu cho từng role (mở rộng Đợt 3, 2026-08-06 — người dùng
// yêu cầu 3 cấp quyền viewer/operator/admin thay vì chỉ 1 tài khoản, xem
// migration 20260806000001_authenticated_rls.sql). Badge này CHỈ để hiển thị
// đang đăng nhập bằng tài khoản nào khi tự test đổi vai trò (đăng xuất/đăng
// nhập lại bằng tài khoản khác) — không phải chốt chặn quyền, RLS mới là nơi
// chặn thật.
export default function Sidebar({
  userEmail,
  userRole,
}: {
  userEmail: string | null;
  userRole: string | null;
}) {
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
      {/* Tiêu đề + icon CÙNG 1 hàng, canh giữa theo chiều dọc (yêu cầu người
          dùng 2026-08-09: "chữ tiêu đề với icon bị chênh nhau, xếp sao cho
          bằng nhau đi" — hàng 2 tầng trước đó (tiêu đề riêng 1 hàng, icon
          hàng dưới canh phải) khiến 2 khối nhìn lệch/rời nhau). Để không tái
          lặp lỗi CŨ HƠN (tiêu đề "Hồ sơ kỹ thuật" bị ngắt dòng giữa chừng khi
          đứng cùng hàng icon, xem bản sửa 2026-08-08): giảm cỡ chữ xl->lg, bỏ
          tracking-wide (bớt giãn chữ), giảm padding ngang 5->4 — đủ chỗ cho
          cả tiêu đề (`whitespace-nowrap`, không bao giờ tự ngắt dòng) VÀ 2
          icon trên cùng 1 hàng ở bề rộng sidebar 256px (w-64). */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-primary-600">
        <span className="whitespace-nowrap text-lg font-bold">Hồ sơ kỹ thuật</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Nút tìm kiếm luôn hiện (yêu cầu người dùng: không được để tính
              năng Command Palette chỉ truy cập qua phím tắt Cmd/Ctrl+K, vd
              trên máy không có bàn phím vật lý/mobile) — bắn CustomEvent cho
              CommandPalette.tsx tự mở, xem giải thích ở file đó. */}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(COMMAND_PALETTE_OPEN_EVENT))}
            className="rounded p-1.5 text-primary-100 hover:bg-primary-600/60 hover:text-white"
            title="Tìm kiếm nhanh (Cmd/Ctrl + K)"
            aria-label="Tìm kiếm nhanh"
          >
            🔍
          </button>
          <button
            type="button"
            onClick={togglePinned}
            className="rounded p-1.5 text-primary-100 hover:bg-primary-600/60 hover:text-white"
            title={
              pinned
                ? "Bỏ ghim — ẩn bớt khung này để tăng bề rộng cho nội dung chính, đưa chuột sát mép trái để hiện lại tạm thời"
                : "Ghim cố định — luôn hiện khung này"
            }
            aria-label={pinned ? "Bỏ ghim menu" : "Ghim menu"}
          >
            {pinned ? <IconPinOff className="h-3.5 w-3.5" /> : <IconPin className="h-3.5 w-3.5" />}
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
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" title={userEmail ?? ""}>
            {userEmail ?? "—"}
            {userRole && (
              <span className="ml-1.5 rounded bg-primary-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {ROLE_LABEL[userRole] ?? userRole}
              </span>
            )}
            {userEmail && !userRole && (
              <span className="ml-1.5 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                chưa gán quyền
              </span>
            )}
          </span>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              // window.location thay vì router.push() (cùng lý do đã sửa ở
              // app/login/page.tsx, 2026-08-07) — đảm bảo layout gốc render
              // lại từ đầu với cookie phiên đã xóa, không để sót email cũ.
              window.location.href = "/login";
            }}
            className="shrink-0 rounded border border-primary-500 px-2 py-0.5 text-primary-100 hover:bg-primary-600/60 hover:text-white"
          >
            Đăng xuất
          </button>
        </div>
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
  //
  // SỬA LỖI KHÓA MENU trên thiết bị cảm ứng (rà soát 2026-08-03, người dùng
  // xác nhận CÓ dùng điện thoại tra cứu tại hiện trường — BB-2): trước đây
  // cách DUY NHẤT mở lại menu khi đã bỏ ghim là onMouseEnter — cảm ứng không
  // có sự kiện hover, và nút 🔍 để mở Command Palette nằm TRONG chính menu
  // đang ẩn, nên bỏ ghim trên máy tính rồi mở app trên điện thoại (localStorage
  // khôi phục lại trạng thái bỏ ghim) là kẹt hoàn toàn, chỉ còn cách gõ URL tay
  // hoặc xóa dữ liệu trình duyệt. Thêm 3 lối thoát: (a) dải mép trái bấm/Enter
  // được, không chỉ hover; (b) nút ☰ luôn hiện khi đang ẩn; (c) lớp nền mờ bấm
  // ra ngoài để đóng — onMouseLeave không bao giờ kích hoạt trên cảm ứng nên
  // trước đây mở overlay ra rồi không có cách đóng lại bằng tay.
  return (
    <>
      {!visible && (
        <button
          type="button"
          onClick={() => setHovering(true)}
          aria-label="Mở menu điều hướng"
          title="Mở menu điều hướng"
          className="fixed left-2 top-2 z-30 rounded-md bg-primary-700 px-3 py-2 text-white shadow-lg hover:bg-primary-600"
        >
          ☰
        </button>
      )}
      <div
        className="fixed left-0 top-0 z-40 h-screen w-3 cursor-pointer"
        onMouseEnter={() => setHovering(true)}
        onClick={() => setHovering(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setHovering(true);
        }}
        role="button"
        tabIndex={0}
        aria-label="Hiện menu điều hướng"
        title="Chạm hoặc đưa chuột vào đây để hiện lại Hồ sơ kỹ thuật"
      >
        <div className="h-full w-1 bg-primary-700/40" />
      </div>
      {visible && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/20"
          onClick={() => setHovering(false)}
          aria-hidden="true"
        />
      )}
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
