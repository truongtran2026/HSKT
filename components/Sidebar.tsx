"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// "Xem" và "Sửa" từng tách riêng ở giai đoạn skeleton (khi CRUD thật chưa
// tồn tại) nhưng nay cả 2 trang ODF trung kế/thiết bị đều xem+sửa ngay tại
// chỗ (PortTable/DeviceCircuitList có sẵn nút Sửa), nên gộp lại 1 nhóm cho
// đỡ trùng lặp — không còn lý do để tách "Xem" và "Sửa" ra 2 mục giống hệt
// nhau nữa. Dashboard (thống kê tổng quan) tách nhóm riêng lên đầu, phần
// hồ sơ/chi tiết số liệu để nhóm dưới cho đỡ rối.
const menuGroups = [
  {
    label: "Thống kê",
    items: [{ href: "/dashboard", label: "Dashboard ADN1" }],
  },
  {
    label: "Hồ sơ",
    items: [
      { href: "/odf-trunk", label: "Hồ sơ ODF Trung kế" },
      { href: "/odf-device", label: "Hồ sơ ODF Thiết bị" },
      { href: "/odf-device/vi-tri-thiet-bi", label: "Vị trí thiết bị → ODF/DDF" },
      { href: "/odf-device/odf-ddf-noi-bo", label: "ODF/DDF nội bộ" },
      { href: "/search", label: "Tìm kiếm nhanh" },
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

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 bg-primary-700 text-white min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-primary-600">
        <span className="text-xl font-bold tracking-wide">Hồ sơ kỹ thuật</span>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {menuGroups.map((group) => (
          <div key={group.label} className="mb-4">
            <div className="px-5 py-1 text-xs font-semibold uppercase tracking-wider text-primary-200">
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
    </aside>
  );
}
