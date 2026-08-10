// Định dạng ngày giờ dùng chung — tách ra từ DeviceCategoryClient.tsx
// (2026-07-27) khi DeviceCircuitList.tsx cũng cần hiển thị "Cập nhật lần
// cuối" cho từng luồng, tránh định nghĩa lặp 2 nơi.
export function formatLastUpdated(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// So sánh theo NGÀY (giờ máy người dùng, đủ dùng vì đây là app single-user tại
// VN) — dùng để tô màu/lọc các dòng vừa thêm/sửa HÔM NAY (yêu cầu người dùng
// 2026-07-31, xem DeviceCircuitList.tsx). Thuần dựa vào updated_at thật trong
// DB (tự cập nhật qua trigger, xem migration circuits_updated_at) — không cần
// state/timer riêng, nên tự "hết hạn" đúng lúc sang ngày mới, không cần code
// dọn dẹp gì thêm.
export function isUpdatedToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// Cùng cách so sánh trên nhưng cho "hôm qua" (ngày liền trước) — dùng để mặc
// định vẫn hiện các luồng vừa cập nhật hôm qua/hôm nay ở "Hồ sơ đấu nối" dù
// CHƯA chọn lĩnh vực/thiết bị nào (yêu cầu người dùng 2026-08-10: tránh phải
// tìm thiết bị + gõ tọa độ mới thấy lại luồng vừa cập nhật gần đây — xem
// DeviceCircuitList.tsx).
export function isUpdatedYesterday(iso: string): boolean {
  const d = new Date(iso);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
}
