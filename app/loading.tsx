// Next.js tự hiện file này (Suspense boundary) trong lúc Server Component
// của route đang chờ dữ liệu (Đợt 4 audit — trước đây không có, màn hình
// trắng trong lúc chờ dễ gây hiểu lầm là app treo). Không cần "use client".
export default function Loading() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-slate-400">
      <p className="text-sm">Đang tải...</p>
    </div>
  );
}
