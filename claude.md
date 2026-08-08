# CLAUDE.md — Hướng dẫn cho Claude Code khi làm việc trên project này

## Bối cảnh dự án
Đây là hệ thống web thay thế 2 file Excel quản lý hồ sơ **ODF trung kế** và **ODF/DDF thiết bị** tại trạm viễn thông ADN1 (VNPT). Chi tiết kiến trúc & schema đầy đủ nằm trong `architecture.md` — **luôn đọc file đó trước khi code**, đây là nguồn sự thật duy nhất về data model.

Người dùng là kỹ sư Điện tử Viễn thông (ETE), không phải lập trình viên chuyên nghiệp — code cần **rõ ràng, có comment giải thích tại sao (không chỉ cái gì)**, tránh trừu tượng hóa quá mức không cần thiết.

## Môi trường làm việc (đa máy: nhà + cơ quan)
- **Từ 2026-07-26**, thư mục làm việc chính của project là:
  `F:\OneDrive - 602m3f\Cong Viec\Dai DNG\Kiem tra HSKT\CODE\HSKT` (đồng bộ qua OneDrive giữa máy nhà và laptop cơ quan). Thư mục cũ `H:\CLAUDE_CODE\HSKT` là bản sao gốc trước khi chuyển, không còn cập nhật — có thể xóa khi rảnh.
- **Git remote**: `https://github.com/truongtran2026/HSKT` (repo **riêng tư**). Quy trình: `git pull` trước khi bắt đầu 1 buổi làm việc, `git push` sau khi xong — tránh làm lệch code giữa 2 máy (OneDrive đồng bộ file thô real-time, nhưng vẫn nên coi Git là nguồn đúng cho code, phòng trường hợp OneDrive sync trễ hoặc đang mở IDE ở cả 2 máy cùng lúc).
- **`.env.local`** (chứa Supabase Secret key) — **không** đưa lên Git (đã chặn trong `.gitignore`), nhưng có mặt ở cả 2 máy nhờ OneDrive đồng bộ nguyên thư mục. Không cần setup lại tay.
- **`data/`** (file Excel gốc thật của trạm, nhiều file .xlsx/.xls) — cũng không đưa lên Git, chỉ tồn tại qua OneDrive.
- Lưu ý: `node_modules/` và `.next/` cũng đang nằm trong thư mục OneDrive-sync (không đưa lên Git) — nếu thấy OneDrive đồng bộ chậm/nặng do 2 thư mục này (hàng chục nghìn file nhỏ), có thể loại trừ khỏi đồng bộ OneDrive và chạy `npm install` riêng ở mỗi máy thay vì đồng bộ qua cloud.

## Stack bắt buộc
- Next.js 14+ (App Router), TypeScript, TailwindCSS.
- Supabase (Postgres) qua `@supabase/supabase-js`. KHÔNG viết backend Express/FastAPI riêng — Supabase client gọi thẳng từ Next.js Server Components/Route Handlers.
- Charts: Recharts.
- Import Excel: SheetJS (xlsx).

## Nguyên tắc dữ liệu quan trọng (đọc kỹ trước khi động vào bảng nào)
1. **1 dòng UI/DB row = 1 port/sợi**, KHÔNG BAO GIỜ gộp Tx/Rx thành 1 dòng ở tầng lưu trữ. Gộp chỉ được làm ở tầng hiển thị (rowspan) khi 2 port liên tiếp cùng `circuit_id`.
2. Khi 2 sợi không liền kề nhau (vd port 19 và port 24) hoặc chỉ dùng 1 sợi cho 1 luồng → **luôn hiển thị đầy đủ tên luồng trên từng dòng**, không được để trống tên luồng ở dòng thứ 2 chỉ vì "đã hiện ở dòng trên" — đây là lỗi hay gặp nhất khi mô phỏng lại kiểu Excel, PHẢI tránh.
3. Tất cả liên kết "bán cấu trúc" (transit_links, response_plan_port_id, counterpart_port_id) đều là **optional** — không được bắt buộc nhập khi lưu form. Cho phép lưu dạng text-only trước, chuẩn hóa thành liên kết thật sau.
4. `racks` dùng chung cho cả ODF trung kế (`domain='trunk'`) và ODF/DDF thiết bị (`domain='device'`) — không tạo bảng riêng biệt cho 2 domain này.
5. Cột "Mức độ ưu tiên" trong file Excel gốc **KHÔNG đưa vào schema** — đã xác nhận với người dùng là bỏ.
6. Phạm vi quản lý chặt: **chỉ trạm ADN1**. Tất cả trạm đối phương khác — kể cả **2T9** dù xuất hiện rất nhiều trong INDEX (do nhiều tuyến cáp trung kế nối ADN1↔2T9) — chỉ lưu tham chiếu dạng text/liên kết lỏng, không quản lý nội bộ, không validate tính đầy đủ port của họ.

## Quy trình làm việc mong muốn
- Luôn làm theo từng giai đoạn nhỏ, có thể chạy/test được ngay (vertical slice), không viết toàn bộ hệ thống cùng lúc.
- **Thứ tự ưu tiên MVP:**
  1. Setup Supabase schema (migration SQL theo `architecture.md` mục 3) + Next.js project skeleton.
  2. Script import dữ liệu từ 2 file `.xls` gốc vào Supabase (mục 3.9 + parser cho `transit_links`).
  3. UI xem/sửa/xóa dữ liệu ODF trung kế theo cấu trúc phân cấp (Trạm → Rack/Block → Port).
  4. UI move luồng từ tuyến A sang tuyến B (có confirm trước khi xóa dữ liệu cũ).
  5. Tìm kiếm nhanh (luồng / port trống / đường dự phòng).
  6. Dashboard tùy biến (table/card/column/pie) theo trạm ADN1.
  7. UI ODF/DDF thiết bị + liên kết 2 chiều với ODF trung kế qua `devices`/`transit_links`.
- Sau mỗi giai đoạn, tóm tắt ngắn gọn đã làm gì, còn thiếu gì, để người dùng xác nhận trước khi qua bước tiếp theo.
- Không tự ý đổi schema trong `architecture.md` mà không hỏi trước — nếu phát hiện vấn đề khi code thực tế, dừng lại và đề xuất thay đổi, chờ xác nhận.
- **Cập nhật file `.md` ngay sau mỗi việc/tính năng làm xong** (yêu cầu người dùng 2026-07-28, không đợi dồn tới cuối buổi): chi tiết schema/tính năng/lỗi đã sửa → ghi vào `architecture.md` (nguồn sự thật về data model, xem đầu file). Còn thay đổi về CHÍNH quy trình/nguyên tắc làm việc chung (như dòng này) → ghi thẳng vào `CLAUDE.md`. Tránh chép trùng chi tiết kỹ thuật vào đây — `CLAUDE.md` chỉ giữ nguyên tắc/quy trình cấp cao, chi tiết luôn ở `architecture.md`.

## Giao diện / UX
- Tông màu xanh dương sáng, layout sidebar trái (menu: Xem / Sửa / Dashboard / Cài đặt — xem ảnh mẫu người dùng cung cấp, tên app tham khảo "PTools").
- Giao diện nhập liệu phải cho phép edit/copy/delete nhanh theo dòng, và hỗ trợ "đẩy dữ liệu từ tuyến A sang tuyến B" như 1 thao tác riêng (không phải copy-paste tay).
- Đăng nhập đã có (2026-08-06). Từ 2026-08-06 (cùng ngày, theo yêu cầu người dùng) RLS có **3 cấp quyền** qua `app_metadata.role`: `viewer` (chỉ xem), `operator` (xem/sửa/xóa TỪNG luồng, không xóa cả rack/thiết bị), `admin` (mọi quyền) — xem migration `20260806000001`. Sidebar hiện badge role đang đăng nhập (`components/Sidebar.tsx`) để tự test đổi vai trò (đăng xuất/đăng nhập lại bằng tài khoản khác qua `npm run create-role-accounts`, hoặc tạo/đổi vai trò trực tiếp ở trang `/settings` nếu đang đăng nhập bằng tài khoản admin). Từ 2026-08-08: UI đã tự ẩn nút Thêm/Sửa/Xóa theo role qua `components/RoleProvider.tsx` + `components/ui/RoleGate.tsx` (xem architecture.md mục 79) — RLS ở CSDL vẫn là nơi chặn thật, `RoleGate` chỉ là lớp thuận tiện UI. **Chưa làm**: nhật ký hoạt động — thêm khi thật sự cần, thiết kế component sao cho dễ thêm sau (không hardcode kiểu single-user sâu vào logic UI).

## Công cụ phụ trợ (tùy chọn, không bắt buộc)
- **Deep Research skill** (bên thứ ba, không phải của Anthropic): https://github.com/Weizhena/Deep-Research-skills — skill cho Claude Code hỗ trợ nghiên cứu sâu có cấu trúc (outline → research song song → report markdown) qua các lệnh `/research`, `/research-deep`, `/research-report`. Cài bằng cách copy vào `~/.claude/skills/` theo hướng dẫn trong README của repo.
  - **Dùng khi**: cần khảo sát/so sánh sâu 1 công nghệ hoặc pattern kiến trúc trước khi quyết định (vd đối chiếu cách các hệ thống OSS/inventory viễn thông khác mô hình hóa ODF/cáp quang, hoặc so sánh pattern Next.js+Supabase cho 1 tính năng khó).
  - **Không dùng cho**: viết code CRUD, import Excel, hay UI thông thường của app — các việc này làm trực tiếp theo `architecture.md`/mục tiêu MVP ở trên, không cần qua research skill.


- ~~Không tự thêm authentication ở giai đoạn MVP~~ — **đổi 2026-08-06**: đã bật
  Supabase Auth thật (email+password, 1 tài khoản), vì rà soát bảo mật
  (`HSKT-audit-2026-08-03.md`) phát hiện anon key public + RLS `mvp_allow_all`
  cho phép BẤT KỲ AI mở `hskt.vercel.app` đọc/ghi/xóa toàn bộ CSDL qua REST
  API, không cần qua app. Người dùng xác nhận chấp nhận đổi nguyên tắc MVP
  này vì lỗ hổng bảo mật thật quan trọng hơn. Chi tiết triển khai: xem
  `architecture.md` (mục ghi đợt Auth, 2026-08-06) — `lib/supabase.ts` (client
  trình duyệt), `lib/supabase-server.ts` (client Server Component/middleware),
  `scripts/lib/supabaseAdmin.ts` (client script CLI), `middleware.ts` (chặn
  route chưa đăng nhập). Vẫn giữ tinh thần "không viết backend riêng" —
  Supabase Auth là tính năng gốc của Supabase, không phải backend thứ hai.
- Không tự thêm cột/bảng ngoài `architecture.md`.
- Không tối ưu hóa/refactor lớn khi chưa có yêu cầu — ưu tiên chạy đúng, dễ hiểu, dễ sửa.
