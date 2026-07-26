import PagePlaceholder from "@/components/PagePlaceholder";

export default function ImportExportPage() {
  return (
    <PagePlaceholder
      title="Import / Export Excel"
      stage="giai đoạn 2 (script import) + UI sau khi có CRUD"
      desc="Import 2 file .xls gốc vào Supabase; export lại đúng cấu trúc cột Excel (đã bỏ cột 'Mức độ ưu tiên') để chỉnh tay rồi import ngược."
    />
  );
}
