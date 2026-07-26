import Link from "next/link";

const cards = [
  {
    href: "/odf-trunk",
    title: "Hồ sơ ODF Trung kế",
    desc: "Hồ sơ ODF trung kế liên trạm (M3.CQ-3).",
  },
  {
    href: "/odf-device",
    title: "Hồ sơ ODF Thiết bị",
    desc: "Hồ sơ đấu nối ODF/DDF tại thiết bị (M3.TD-1_2).",
  },
  {
    href: "/search",
    title: "Tìm kiếm nhanh",
    desc: "Tìm theo tên luồng, port, sợi trống, đường dự phòng.",
  },
  {
    href: "/dashboard",
    title: "Dashboard",
    desc: "Thống kê % sợi đã dùng / dự phòng / trống theo tuyến cáp.",
  },
];

export default function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">Hồ sơ kỹ thuật</h1>
      <p className="text-slate-500 mt-1">
        Giai đoạn MVP đang xây dựng theo từng bước — xem tiến độ trong CLAUDE.md.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-primary-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-primary-300 transition"
          >
            <h2 className="font-semibold text-primary-700">{c.title}</h2>
            <p className="text-sm text-slate-500 mt-1">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
