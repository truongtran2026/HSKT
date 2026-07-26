import { normalizeVN } from "./text";

// Trích xuất "Thiết bị:" / "Tọa độ DDF/ODF:" từ circuits.notes — xem
// scripts/import-legacy.ts dòng ~398-402 để biết định dạng nhãn gốc lúc
// import (mỗi nhãn nằm riêng 1 dòng, có thể có nhiều dòng "Tọa độ DDF/ODF:"
// nếu luồng chuyển tiếp thêm 1 chặng trong trạm).

export function extractDeviceNameFromNotes(notes: string | null): string | null {
  if (!notes) return null;
  const m = notes.match(/Thiết bị:\s*(.+)/);
  return m ? m[1].trim() : null;
}

// Theo quy ước người dùng xác nhận: khi có 2 dòng "Tọa độ DDF/ODF" trong
// notes, dòng ĐẦU là vị trí ODF/DDF nơi cáp CHÍNH thiết bị này đấu ra, dòng
// THỨ HAI là vị trí ODF tiếp theo (thiết bị kế hoặc nhảy lên ODF trung kế đi
// ra ngoài đường) — 2 ý nghĩa khác nhau nên tách riêng, KHÔNG gộp chung 1
// chuỗi như trước (đã kiểm tra thực tế: tối đa 2 dòng/luồng, không có luồng
// nào có từ 3 dòng trở lên).
export interface DevicePositions {
  own: string | null;
  next: string | null;
}

export function extractDevicePositions(notes: string | null): DevicePositions {
  if (!notes) return { own: null, next: null };
  const positions = notes
    .split("\n")
    .filter((line) => line.startsWith("Tọa độ DDF/ODF:"))
    .map((line) => line.replace(/^Tọa độ DDF\/ODF:\s*/, "").trim())
    .filter((v) => v !== "");
  return { own: positions[0] ?? null, next: positions[1] ?? null };
}

// Khóa gộp nhóm tên thiết bị — bỏ dấu + khoảng trắng thừa, KHÔNG tự ý sửa
// tên hiển thị (chỉ dùng để gộp các biến thể chính tả của cùng 1 thiết bị
// thật, người dùng vẫn chọn tên chuẩn hiển thị ở UI chuẩn hóa).
//
// Bỏ luôn tiền tố "ADN1." nếu có (phát hiện thực tế 2026-07-26): bảng
// `devices` lưu tên CÓ tiền tố trạm (vd "ADN1.3650#1 IPCC"), trong khi
// device_position_map.device_name lại lưu tên KHÔNG có tiền tố (vd
// "3650#1 IPCC") — 2 cách viết cho CÙNG 1 thiết bị, nếu không bỏ tiền tố thì
// khóa so khớp sẽ không bao giờ trùng nhau, khiến tính năng tự điền Trib <->
// Vị trí ODF trong DeviceCircuitList không bao giờ tìm thấy thư viện đã có
// sẵn (luôn tưởng là "chưa có", rồi âm thầm ghi thêm dòng mới trùng lặp vào
// device_position_map mỗi lần lưu luồng). App chỉ quản lý đúng 1 trạm ADN1
// (xem CLAUDE.md) nên tiền tố này không có giá trị phân biệt, bỏ đi an toàn.
//
// Coi "/" như khoảng trắng (phát hiện thực tế 2026-07-26): dữ liệu thật có
// cả 2 cách viết cho cùng 1 thiết bị, vd "PSS24X#1/BB1" và "PSS24X#1 BB1" —
// không gộp thì tính năng "thiết bị này đã có chưa" (tự tạo devices từ ô
// Đối phương, tự điền thư viện vị trí) sẽ tưởng nhầm là chưa có, tạo trùng.
export function normalizeDeviceNameKey(name: string): string {
  return normalizeVN(name)
    .replace(/^adn1\.\s*/, "")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Khóa so khớp vị trí DDF/ODF khi kiểm tra 1 vị trí không bị gán cho 2
// thiết bị khác nhau — cùng cách chuẩn hóa với tên thiết bị để không lệch
// nhau vì hoa/thường hoặc khoảng trắng thừa.
export function normalizeDevicePositionKey(position: string): string {
  return normalizeVN(position).replace(/\s+/g, " ").trim();
}

// Một số dòng "Tọa độ DDF/ODF" trong file gốc ghi text cố định như "Kết nối
// trực tiếp" (nghĩa là cáp nối thẳng thiết bị, KHÔNG qua ODF/DDF nào cả —
// khái niệm device_direct ở architecture.md mục 3.6), không phải tọa độ vật
// lý thật. Rất nhiều thiết bị khác nhau dùng chung đúng câu chữ này nên nếu
// đưa vào kiểm tra "1 vị trí không bị 2 thiết bị dùng chung" sẽ báo sai hàng
// loạt. Chỉ coi là tọa độ thật khi có nhắc tới "ODF"/"DDF".
export function looksLikeRealPositionText(position: string): boolean {
  const n = normalizeVN(position);
  return n.includes("odf") || n.includes("ddf");
}

// scripts/import-legacy.ts tự sinh tên "(chưa đặt tên) <thiết bị> - Trib <n>"
// khi cột "Tên luồng" gốc để trống nhưng dòng vẫn có dữ liệu khác (Trib,
// tọa độ...) — đúng đặc thù bên thiết bị: đã kéo cáp ra ODF nhưng CHƯA có
// luồng dịch vụ nào chạy qua. Người dùng xác nhận: khi chưa có luồng thật
// (không có vị trí ODF tiếp theo — xem extractDevicePositions().next), tên
// tự sinh này không cần hiện ra, để trống cho hồ sơ gọn — KHÔNG sửa cột
// name gốc trong DB (vẫn giữ nguyên để không mất dấu vết import), chỉ ẩn
// lúc hiển thị.
export function isPlaceholderCircuitName(name: string): boolean {
  return name.startsWith("(chưa đặt tên)");
}
