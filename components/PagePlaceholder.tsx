// Placeholder dùng chung cho các trang chưa xây UI thật (chỉ có route rỗng
// ở giai đoạn skeleton). Sẽ bị thay bằng UI thật khi tới đúng giai đoạn MVP
// tương ứng trong CLAUDE.md — không phải abstraction lâu dài.
export default function PagePlaceholder({
  title,
  stage,
  desc,
}: {
  title: string;
  stage: string;
  desc: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold text-primary-800">{title}</h1>
      <p className="text-slate-500 mt-1">{desc}</p>
      <div className="mt-6 rounded-lg border border-dashed border-primary-300 bg-primary-50 p-6 text-sm text-primary-700">
        Chưa xây dựng UI — sẽ làm ở <strong>{stage}</strong> theo thứ tự ưu
        tiên MVP trong CLAUDE.md.
      </div>
    </div>
  );
}
