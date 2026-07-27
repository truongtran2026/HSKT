// Định dạng ngày giờ dùng chung — tách ra từ DeviceCategoryClient.tsx
// (2026-07-27) khi DeviceCircuitList.tsx cũng cần hiển thị "Cập nhật lần
// cuối" cho từng luồng, tránh định nghĩa lặp 2 nơi.
export function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
