# ARCHITECTURE.md — Hệ thống quản lý ODF Trung kế & ODF/DDF Thiết bị (trạm ADN1)

> Tài liệu này là nguồn sự thật (source of truth) về kiến trúc hệ thống. Mọi thay đổi kiến trúc lớn phải cập nhật lại file này.

---

## 1. Mục tiêu hệ thống

Thay thế 2 file Excel quản lý thủ công:
- `M3_CQ-3_HS_ODF_TRUNG_KE_TAI_TRAM_VT_ADN1` — hồ sơ ODF trung kế (cáp quang liên trạm).
- `M3_TD-1_2_HS_DAU_NOI_TAI_TRAM_VT_ADN1` — hồ sơ đấu nối ODF/DDF thiết bị (patch panel tại thiết bị).

Bằng một web app cho phép:
- Nhập/sửa/xóa dữ liệu port — sợi — luồng theo cấu trúc phân cấp Trạm → ODF/Rack → Sub-rack/Block → Port → Sợi.
- Di chuyển (move) dữ liệu 1 luồng từ tuyến cáp A sang tuyến cáp B, có xác nhận trước khi xóa dữ liệu cũ ở A.
- Tự động xây dựng "device registry" (danh mục thiết bị tại ADN1) từ dữ liệu nhập, liên kết 2 chiều giữa ODF trung kế ↔ ODF/DDF thiết bị.
- Tìm kiếm nhanh theo luồng / port / sợi trống / đường dự phòng.
- Dashboard tùy biến (table/card/column/pie...) thống kê % sợi đã phân bổ, đang dùng thật, dự phòng — theo phạm vi trạm ADN1.
- Import dữ liệu từ Excel hiện có (chuẩn hóa), và export lại để chỉnh sửa ngoài rồi import ngược (đồng bộ 2 chiều).

**Phạm vi quản lý chặt (đầy đủ, đảm bảo tính nhất quán):** chỉ trạm **ADN1**.
**Phạm vi tham chiếu (chỉ ghi nhận, không ràng buộc):** tất cả trạm đối phương khác — bao gồm cả **2T9** (dù xuất hiện dày đặc do có nhiều tuyến cáp trung kế nối ADN1↔2T9, nhưng không phải trạm được quản lý nội bộ), VMS.ADN, HHI, T2, HIN, TKY, PLC-HUE... — lưu dạng text/liên kết lỏng, không kiểm tra tính đầy đủ port của họ.

---

## 2. Stack công nghệ

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Frontend | **Next.js 14+ (App Router) + React + TypeScript** | Chạy local (`npm run dev` → `localhost:3000`) giống hệt production; deploy Vercel trong vài phút khi cần public, không đổi kiến trúc. |
| UI styling | **TailwindCSS** + component nhẹ (shadcn/ui khuyến nghị) | Giao diện tươi sáng, tông xanh dương giống ảnh mẫu "PTools", dễ tùy biến nhanh. |
| Backend/DB | **Supabase (PostgreSQL)** | Có sẵn Auth (dùng khi lên multi-user giai đoạn 2), Storage (file import/export), Row Level Security cho phân quyền sau này. Gọi trực tiếp qua `@supabase/supabase-js` từ Next.js — **không cần viết backend server riêng ở MVP**. |
| Charts | **Recharts** hoặc **Chart.js** | Dashboard tùy biến table/card/column/pie, chọn x-axis/y-axis/legend/sort linh hoạt. |
| Import/Export Excel | **SheetJS (xlsx)** chạy phía client hoặc script Node riêng (`scripts/import-legacy.ts`) | Đọc file `.xls` cũ (merge-cell đặc thù), chuẩn hóa, ghi vào Supabase; export lại theo cùng format để chỉnh tay rồi import ngược. |
| Auth (giai đoạn 2) | **Supabase Auth** (email/password hoặc Google) + RLS theo role Admin/Edit/Viewer | Không phải viết lại kiến trúc, chỉ bật thêm cấu hình + policy. |

**Giai đoạn 1 (MVP): single-user, không cần Supabase Auth — dùng Supabase anon key trực tiếp, RLS tắt hoặc mở toàn quyền.**
**Giai đoạn 2: bật Auth + RLS theo `user_roles`, thêm bảng `audit_log`.**

---

## 3. Mô hình dữ liệu (Database Schema)

### Nguyên tắc thiết kế
1. **1 dòng dữ liệu = 1 port/sợi** (giữ đúng logic Excel gốc), không gộp Tx/Rx vào 1 dòng — để linh hoạt xử lý sợi lẻ, sợi không liền kề, hoặc chỉ dùng 1 sợi.
2. **"Luồng" (circuit) là 1 entity riêng**, được **liên kết** tới 1 hoặc nhiều port qua bảng nối `port_circuit_links`. Việc "gộp hiển thị 2 sợi thành 1 dòng khi liền kề" là xử lý ở **tầng UI/view** (SQL view hoặc logic frontend), KHÔNG gộp ở tầng lưu trữ — đảm bảo không bao giờ sót dữ liệu khi sợi không liền kề hoặc bị xóa 1 sợi.
3. **ODF trung kế và ODF/DDF thiết bị dùng chung schema `racks`/`ports`**, phân biệt bằng cột `domain`. Điều này cho phép liên kết trực tiếp (transit) từ 1 port bên trung kế sang 1 port bên thiết bị mà không cần bảng thứ 3.
4. Loại ODF (`welded` hàn nối / `distribution` phân phối) gắn ở cấp **rack hoặc block**, vì 1 rack hàn nối vẫn có thể chứa 1 block con kiểu phân phối (Block ƯC).

### 3.1. `stations` — Trạm
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| code | text unique | `ADN1`, `2T9`, `VMS.ADN`, `HHI`... |
| name | text | Tên đầy đủ |
| is_managed | boolean | `true` chỉ cho ADN1. `false` = trạm đối phương (kể cả 2T9), chỉ tham chiếu. |

### 3.2. `racks` — ODF/Rack/Block (dùng chung cho trung kế & thiết bị)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| station_id | uuid FK → stations | |
| code | text | `ODF1/1`, `ODF6/1 Block ƯC` |
| domain | enum(`trunk`,`device`) | trunk = ODF trung kế, device = ODF/DDF thiết bị |
| odf_type | enum(`welded`,`distribution`) | Loại vật lý của rack/block này |
| parent_rack_id | uuid FK → racks, nullable | Dùng khi rack này là **block con** gắn thêm vào 1 rack cha (vd Block ƯC gắn vào ODF1/3) |
| device_id | uuid FK → devices, nullable | Chỉ set khi `domain = device`: rack DDF này thuộc thiết bị nào |
| port_count | int | Số port cố định (24/48/96/144...) |
| cable_route_name | text, nullable | Tiêu đề tuyến cáp (chỉ trunk), vd "96FO#1 ADN1 - 2T9" |
| notes | text | |

### 3.3. `ports` — Port/Sợi vật lý
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| rack_id | uuid FK → racks | |
| port_number | int | Số port trong rack/block |
| fiber_number | int, nullable | Số sợi ngoài tuyến cáp (chỉ có nghĩa với domain=trunk); null cho device domain nếu không áp dụng |
| medium | enum(`fiber`,`copper`) | |
| status | enum(`unused`,`in_use`,`standby`) | Tính toán/đặt tay — dùng cho Dashboard & tìm sợi trống |

Unique constraint: `(rack_id, port_number)`.

### 3.4. `circuits` — Luồng
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| name | text | Tên luồng, vd `100GE ADN1.P2(1/0/3) – 2T9.P1(4/0/3)` |
| interface_type | text | `100GE`,`10GE`,`40GE`,`1GE`,`STM1`,`STM4`,`STM16`,`STM64`,`DWDM`... |
| circuit_role | enum(`active`,`standby`) | Đang hoạt động hay dự phòng |
| counterpart_text | text, nullable | ODF đối phương dạng text (trạm khác, không quản lý chặt) |
| counterpart_port_id | uuid FK → ports, nullable | Nếu đối phương nằm trong ADN1/2T9 (đã quản lý) thì liên kết trực tiếp |
| response_plan_text | text, nullable | Phương án ứng cứu — luôn cho nhập text tự do |
| response_plan_port_id | uuid FK → ports, nullable | **Tùy chọn**: liên kết bán cấu trúc tới port dự phòng cụ thể — KHÔNG bắt buộc nhập, để trống vẫn hợp lệ, điền dần khi rảnh |
| execution_station_text | text, nullable | "Trạm thực hiện" |
| trib_text | text, nullable | Cột "Trib" trong file M3.TD-1_2 (ODF/DDF thiết bị) — vị trí cổng vật lý ngay tại thiết bị, vd "1/1/1". Chỉ có nghĩa khi luồng thuộc domain=device. Thêm ngày 2026-07-20 sau khi khảo sát dữ liệu thật (xem mục 7 bên dưới). |
| device_id | uuid FK → devices, nullable | Chỉ có nghĩa khi luồng thuộc domain=device (chưa gán port nào). Gán qua UI chuẩn hóa `/odf-device/chuan-hoa`. Thêm 2026-07-22 (xem mục 8). |
| device_position_own | text, nullable | Vị trí ODF/DDF CHÍNH thiết bị này đấu cáp ra. Chỉ có nghĩa khi domain=device. Thêm 2026-07-26 (xem mục 8), thay cho việc trước đó nhét trong `notes`. |
| device_position_next | text, nullable | Vị trí ODF tiếp theo / nhảy lên ODF trung kế đi ra ngoài. Chỉ có nghĩa khi domain=device. Thêm 2026-07-26 (xem mục 8). |
| notes | text, nullable | |

### 3.5. `port_circuit_links` — Nối Port ↔ Luồng
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| port_id | uuid FK → ports (unique — 1 port chỉ thuộc 1 luồng tại 1 thời điểm) | |
| circuit_id | uuid FK → circuits | |
| link_role | enum(`tx`,`rx`,`single`) | `single` khi luồng chỉ dùng 1 sợi |

> **Xử lý hiển thị gộp (merge) giống Excel:** ở tầng UI, khi 2 port liên tiếp cùng trỏ về 1 `circuit_id` và `port_number` chênh nhau đúng 1 → hiển thị gộp thành 1 dòng (rowspan) và chỉ ghi tên luồng 1 lần. Khi không liền kề (vd port 19 & 24) hoặc chỉ 1 sợi → luôn hiển thị tên luồng trên **từng dòng port** để không gây sót dữ liệu. Đây là rule bắt buộc khi build UI bảng.

### 3.6. `transit_links` — Chuyển tiếp (liên kết ODF trung kế ↔ ODF/DDF thiết bị ↔ thiết bị)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| source_port_id | uuid FK → ports | Port đang xét (bên trung kế hoặc bên thiết bị) |
| target_type | enum(`port`,`device_direct`,`cable_out`,`text_only`) | `port`: trỏ tới port khác đã có trong hệ thống (dùng để nối trung kế ↔ thiết bị hoặc thiết bị A ↔ thiết bị B); `device_direct`: cáp trực tiếp từ thiết bị, không qua ODF; `cable_out`: đi thẳng ra ngoài trạm (không có tọa độ thiết bị); `text_only`: dữ liệu cũ/legacy chưa chuẩn hóa được, giữ nguyên text |
| target_port_id | uuid FK → ports, nullable | Bắt buộc nếu `target_type = port` |
| target_device_id | uuid FK → devices, nullable | Bắt buộc nếu `target_type = device_direct` |
| raw_text | text, nullable | Text gốc từ Excel — luôn lưu lại để đối chiếu & không mất dữ liệu khi chưa kịp chuẩn hóa liên kết |

> Cho phép **để trống liên kết** (`target_type = text_only`, chỉ có `raw_text`) khi mới nhập — sửa thành liên kết chuẩn (`port`/`device_direct`) sau này bất cứ lúc nào, theo đúng yêu cầu "ban đầu chưa liên kết, sau edit vẫn liên kết được, hoặc ngược lại".

### 3.7. `devices` — Danh mục thiết bị (chỉ trạm ADN1, tự sinh)
| Cột | Kiểu | Ghi chú |
|---|---|---|
| id | uuid PK | |
| station_id | uuid FK → stations | |
| name | text | Tên thiết bị, vd `OTS2`, `OMS3240` |
| coordinate_text | text | Tọa độ dạng chuẩn hóa từ text gốc, vd `(1-3-3)` |
| full_label | text | Ghép sẵn `STATION.DEVICE(COORD)` để hiển thị, vd `ADN1.OTS2(1-3-3)` |
| source | enum(`auto`,`manual`) | `auto` nếu được hệ thống tự tạo khi nhập transit_link, `manual` nếu người dùng tạo tay |

> Quy tắc tự sinh: khi nhập 1 `transit_link` có nhắc tới tên thiết bị + tọa độ thuộc ADN1, hệ thống parse chuỗi `STATION.DEVICE(COORD)`, kiểm tra `devices` đã có chưa — nếu chưa, **hỏi xác nhận tạo mới** trước khi lưu (theo đúng yêu cầu gốc). Nếu tọa độ thuộc trạm khác (kể cả 2T9) → không tạo `devices`, chỉ lưu `raw_text`.

### 3.8. Bảng hỗ trợ giai đoạn 2 (multi-user) — thiết kế sẵn, chưa bật ở MVP
- `user_roles(user_id, role enum(admin,edit,viewer))`
- `audit_log(id, user_id, action, table_name, record_id, old_value jsonb, new_value jsonb, created_at)`
- `edit_locks` hoặc cột `locked_by`/`locked_table` nếu cần khóa theo bảng khi 1 user đang edit (theo ảnh mẫu "cấp quyền Edit sẽ hỏi chọn bảng được sửa").

### 3.9. Import/Export
- `import_batches(id, file_name, imported_at, imported_by, row_count, status, error_log jsonb)` — log mỗi lần import để truy vết.
- Format export **giữ nguyên cấu trúc cột Excel gốc** (Rack-sub ODF | Port | Sợi | Tên luồng | Giao tiếp | Chuyển tiếp | Đối phương | Phương án ứng cứu | Trạm thực hiện | Ghi chú — **bỏ cột "Mức độ ưu tiên"**) để người dùng chỉnh sửa quen tay ngoài Excel rồi import ngược.

---

## 4. Luồng nghiệp vụ chính (Flows)

### 4.1. Nhập liệu 1 luồng mới
1. Chọn rack/ODF + port + sợi (hệ thống gợi ý port trống theo trạng thái `unused`).
2. Nhập tên luồng, giao tiếp → tạo `circuits` row.
3. Nếu dùng 2 sợi liền kề → tự động liên kết cả 2 port vào cùng `circuit_id` (`tx`/`rx`), UI hiển thị gộp.
4. Nhập "Chuyển tiếp" → parse text, nếu match được tọa độ thiết bị **ADN1** → hỏi tạo/liên kết `devices` + `transit_links`; nếu không rõ ràng hoặc thuộc trạm khác (kể cả 2T9) → lưu `text_only`.
5. "Đối phương" & "Phương án ứng cứu" → nhập text tự do, có thể để trống, liên kết port sau này qua UI riêng ("gán liên kết ứng cứu").

### 4.2. Di chuyển luồng từ tuyến A sang tuyến B
1. Chọn `circuit_id` nguồn (tuyến A).
2. Chọn port đích (tuyến B) — kiểm tra port đích đang `unused`.
3. Cập nhật `port_circuit_links` trỏ sang port mới, cập nhật `status` 2 bên port (A → `unused`, B → `in_use`).
4. **Hỏi xác nhận trước khi xóa dữ liệu port A** (theo đúng yêu cầu gốc) — nếu đồng ý, xóa link cũ; nếu không, giữ nguyên (cho phép 1 luồng gán tạm cả 2 nơi trong lúc chuyển đổi ứng cứu).

### 4.3. Tìm kiếm & tài nguyên
- Tìm theo tên luồng / port / sợi → full-text search trên `circuits.name` + join `ports`.
- Tìm port/sợi trống theo tuyến cáp → filter `ports.status = unused` theo `rack.cable_route_name`.
- Tìm nhanh đường dự phòng → filter `circuits.circuit_role = standby`.

### 4.4. Dashboard (tùy biến)
- Nguồn dữ liệu: SQL view tổng hợp theo `station_id` (chỉ ADN1) — % sợi `in_use` (đã phân bổ thật), `standby` (dự phòng), `unused` trên tổng `port_count` theo từng `cable_route_name`.
- UI cho chọn loại biểu đồ (table/card/column/pie) + chọn trường làm x-axis/y-axis/legend/sort — lưu cấu hình dashboard tùy biến của user (bảng `dashboard_configs` — thiết kế thêm khi vào giai đoạn build UI này, không bắt buộc có ở schema ban đầu).

---

## 5. Việc KHÔNG làm ở MVP (để giai đoạn 2)
- Đăng nhập/phân quyền Admin-Edit-Viewer, nhật ký hoạt động (audit log).
- Khóa theo bảng khi đang edit.
- Ràng buộc tính nhất quán cho thiết bị/port của bất kỳ trạm đối phương nào (kể cả 2T9) — chỉ ADN1 được quản lý đầy đủ, đã xác nhận với người dùng.

---

## 6. Cấu trúc thư mục dự kiến (Next.js)
```
/app
  /odf-trunk          # Quản lý ODF trung kế
  /odf-device         # Quản lý ODF/DDF thiết bị
  /devices            # Danh mục thiết bị (auto-generated)
  /search              # Tìm kiếm nhanh
  /dashboard           # Dashboard tùy biến
  /import-export        # Import/export Excel
/lib
  /supabase.ts         # Client Supabase
  /parsers             # Parser cho text "Chuyển tiếp" → transit_links
/scripts
  /import-legacy.ts     # Import 2 file .xls gốc (1 lần, có log)
/supabase
  /migrations           # SQL migration theo schema mục 3
/data
  # 2 file .xls gốc của trạm ADN1 (không đưa lên git chung, xem .gitignore)
```

---

## 7. Ghi chú khảo sát dữ liệu thật (2026-07-20, trước khi viết import-legacy.ts)

Sau khi có 2 file `.xls` thật của ADN1, khảo sát cho thấy dữ liệu thực tế lệch
khá nhiều so với giả định ban đầu ở mục 3 (do 6 năm nhiều người nhập tay).
Các quyết định dưới đây đã hỏi và được người dùng xác nhận, áp dụng cho
`scripts/import-legacy.ts`:

1. **File ODF trung kế (M3.CQ-3)**: mỗi sheet (trừ `INDEX`) = đúng 1 rack
   (không có sheet nào chứa nhiều "ML..." section chồng nhau — đã kiểm tra
   các sheet bất thường về số dòng/cột, chỉ là padding dòng trống hoặc dữ
   liệu trùng port cần cảnh báo, không phải nhiều rack).
   - `rack.code` suy ra từ tiêu đề section (regex tìm `: <a>-<b>` ngay trước
     dấu `(` hoặc cuối chuỗi) → `ODF{a}/{b}`, KHÔNG dùng ô "Rack-sub ODF" làm
     nguồn chính vì ô này có lỗi copy-paste thực tế (vd tiêu đề ghi "6-15"
     nhưng ô lại ghi "2-5"). Ô "Rack-sub ODF" chỉ dùng làm fallback.
   - `rack.odf_type`: **welded** nếu mã rack là `ODF1/x` (trừ `ODF1/14`),
     `ODF2/x`, `ODF2/x.y`, hoặc `ODF6/x`; còn lại **distribution**. Quy tắc
     này người dùng cung cấp trực tiếp (không suy ra được từ cột nào trong
     Excel). Trường hợp rack vừa hàn nối vừa có Block ƯC (phân phối) sẽ do
     người dùng thêm tay sau qua `parent_rack_id`, import không tự xử lý.
   - Cột "Chuyển tiếp" (transit) có định dạng tự do, không khớp mẫu
     `STATION.DEVICE(COORD)` giả định ở mục 3.7. Import ban đầu lưu
     **toàn bộ dạng `transit_links.target_type='text_only'` + `raw_text`
     nguyên văn**, KHÔNG tự đoán/tạo `devices` lúc import. Việc chuẩn hóa
     (nhận diện + hỏi xác nhận tạo `devices`/`transit_links` kiểu `port`)
     để dành cho UI ở giai đoạn 7, làm sau khi thiết bị/port bên ODF/DDF đã
     chuẩn hóa.
   - Cột "Mức Độ ưu tiên" (mọi biến thể chính tả) — bỏ, đúng theo mục 3.9.
   - Gộp Tx/Rx: 2 port liên tiếp (lẻ, chẵn) được gộp vào 1 `circuit_id` khi
     port chẵn trống hoàn toàn, HOẶC khi cả 2 có cùng "Tên luồng". Vẫn lưu
     2 dòng `ports` riêng biệt (không vi phạm nguyên tắc 1 dòng = 1 port),
     chỉ `port_circuit_links` trỏ chung `circuit_id` (link_role tx/rx).
   - Port trùng số trong cùng rack (dữ liệu lỗi có thật, vd port 13 xuất
     hiện 2 lần ở 1 sheet) → giữ lần xuất hiện SAU CÙNG, cảnh báo trong log
     import để người dùng tự kiểm tra lại.

2. **File ODF/DDF thiết bị (M3.TD-1_2)**: cấu trúc cột **khác hẳn** mô tả ở
   mục 3.9 (không phải "Rack-sub ODF|Port|Sợi|..." như file trung kế) — có
   thêm cột "Trib"/"Agg" và tối đa 2 cột tọa độ DDF/ODF + 1 cột tọa độ
   truyền dẫn, với **nhiều định dạng khác nhau tùy loại thiết bị** (`DDF:n/
   tên`, `n/Cáp ...`, `ODF: a/b/c,d`...).
   - "Trib" → cột mới `circuits.trib_text` (xem mục 3.4, migration
     `20260720000002`).
   - "Agg", "Ký hiệu", 2 cột tọa độ DDF/ODF, cột tọa độ truyền dẫn → gộp
     hết vào `circuits.notes` dạng text có nhãn rõ ràng (không mất dữ liệu),
     theo xác nhận của người dùng.
   - **Quyết định phạm vi**: vì định dạng tọa độ DDF/ODF quá đa dạng giữa
     các loại thiết bị (rủi ro tạo sai `racks`/`ports`/`transit_links` nếu
     tự suy đoán), import lần đầu **CHỈ tạo `circuits`** cho file thiết bị
     (không tạo `racks`/`ports`/`transit_links` domain=device). Việc chuẩn
     hóa rack/port cho ODF/DDF thiết bị sẽ làm ở **giai đoạn 7** cùng lúc
     xây UI ODF/DDF thiết bị, khi có thể vừa parse vừa cho người dùng xác
     nhận từng trường hợp thay vì đoán hàng loạt.
   - Các sheet mẫu/template (`M3.TD-1_Kenh trong nuoc`, `M3.TD-2_Kenh Quoc
     te`, `M3.TD-1_E1 ADX#mau`), sheet điều hướng (`INDEX`), sheet ánh xạ
     tổng đài không thuộc phạm vi ODF/DDF (`Bảng ánh xạ`) → bỏ qua, không
     import.

3. **Supabase đổi hệ API key** (phát hiện 2026-07-20, không có trong mục 2
   ban đầu): dự án mới tạo trên Supabase dùng hệ key **Publishable/Secret**
   thay cho **anon/service_role** cũ.
   - `Publishable key` → dùng làm `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   - `Secret key` → dùng làm `SUPABASE_SERVICE_ROLE_KEY`.
   - **Khác biệt quan trọng**: với hệ key cũ, "RLS tắt" nghĩa là anon key đọc
     được toàn bộ dữ liệu (đúng như mục 2 giả định cho MVP). Với hệ key mới,
     nếu RLS tắt thì Publishable key trả về **mảng rỗng** (200 OK, không lỗi
     — rất dễ nhầm là bug code chứ không phải quyền truy cập).
   - **Cách xử lý** (migration `20260720000003`): **bật RLS + tạo 1 policy
     "cho phép tất cả"** trên mọi bảng — về hiệu quả vẫn là "mở toàn quyền"
     như mục 2 dự định cho giai đoạn 1 single-user, chỉ khác cách triển khai
     để tương thích hệ key mới. Giai đoạn 2 (multi-user) sẽ **thay** policy
     này bằng policy theo `user_roles`, không phải bật RLS từ đầu (đã bật
     sẵn từ giai đoạn 1).

---

## 8. Chuẩn hóa ODF/DDF thiết bị — bổ sung schema (giai đoạn 7, chưa cập nhật kịp ở mục 3)

1. **`circuits.device_id`** (migration `20260722000001`) — liên kết chuẩn hóa
   tới `devices` cho luồng thuộc domain=device (nhận diện: luồng chưa gán
   `port_circuit_links` nào — xem `lib/deviceCircuits.ts`). Gán qua UI
   `/odf-device/chuan-hoa`.

2. **`device_position_map`** (bảng mới, migration `20260724000001`) — danh
   mục tra cứu độc lập `device_name / device_position / odf_position`, KHÔNG
   sửa schema `circuits`/`devices` vì 1 thiết bị có thể có nhiều vị trí ra
   ODF/DDF khác nhau. Dùng để gợi ý/tự điền khi nhập/sửa luồng thiết bị
   (xem `components/odf-device/DeviceCircuitList.tsx`), và quản lý trực tiếp
   qua `/odf-device/vi-tri-thiet-bi`.

3. **`devices.category`** (migration `20260725000001`) — lĩnh vực thiết bị
   (IP/Server/Truyền Dẫn/Tổng Đài/VN2/Vô tuyến...), suy từ tên thư mục lúc
   import lô 126 file 2026-07-25. Nullable — thiết bị chuẩn hóa từ trước lô
   này không có lĩnh vực, hiển thị "Chưa phân loại".

4. **`circuits.device_position_own` / `device_position_next`** (migration
   `20260726000001`) — tách ra cột riêng từ `notes` (nhãn cũ "Tọa độ
   DDF/ODF:", xem `lib/deviceNotes.ts` `extractDevicePositions()`), theo yêu
   cầu người dùng 2026-07-26: form sửa/nhập luồng thiết bị cần ô riêng để
   gợi ý/tự điền từ `device_position_map` thay vì phải sửa tay trong Ghi
   chú. `device_position_own` đổi tên từ `device_position_text` (cột tạo sẵn
   ở migration `20260722000001` nhưng chưa từng được dùng). Dữ liệu cũ được
   chuyển 1 lần bằng `scripts/migrate-notes-to-position-columns.ts`, các
   nhãn khác trong `notes` ("Thiết bị chuyển tiếp:", "TBi đầu cuối:", ghi
   chú gốc, "ID gốc:") giữ nguyên.

5. **`devices.updated_at`** (migration `20260727000001`) / **`circuits.updated_at`**
   (migration `20260727000002`) — mốc "lần cuối sửa", tự cập nhật qua trigger
   Postgres dùng chung `set_updated_at()` (định nghĩa 1 lần ở migration đầu,
   tái dùng ở migration sau), KHÔNG cần code tự set tay ở bất kỳ chỗ nào. Hiện
   ở UI dạng chữ nhỏ dưới tên thiết bị/tên luồng (`lib/format.ts`
   `formatLastUpdated`), KHÔNG thêm cột bảng mới — theo đúng yêu cầu người
   dùng 2026-07-27, tránh làm rối bảng.

6. **"Vị trí ODF (tiếp theo)" tách 3 ô khi sửa/nhập luồng thiết bị** (yêu cầu
   người dùng 2026-07-27, KHÔNG đổi schema — vẫn 1 cột
   `circuits.device_position_next`): UI tách thành Ô1 (tọa độ ODF), Ô2 (thiết
   bị local ADN1 HOẶC tên tuyến cáp trung kế), Ô3 (Trib/sợi), ghép lại đúng 1
   chuỗi qua `combinePositionNext()` (`lib/parsers/transit-text.ts`) khi lưu —
   cùng cơ chế đã dùng cho "Chuyển tiếp" bên ODF trung kế
   (`splitOdfDeviceStructure`/`PortTable.tsx`). Ô2/Ô3 KHÔNG chọn tay qua
   toggle — Ô1 gõ tới đâu tự dò khớp rack trung kế THẬT tới đó qua
   `matchTrunkPosition()` (`lib/trunkPorts.ts`): khớp được → chắc chắn đấu
   thẳng ra trung kế (rack/port bên ODF/DDF thiết bị chưa được tạo thật trong
   hệ thống, xem mục 7), tự khóa Ô2 = tên tuyến cáp (không cho sửa tay) + suy
   2 chiều Port(Ô1)<->Sợi(Ô3); không khớp được rack nào → Ô2 quay lại
   free-text "Thiết bị (tiếp theo)" như trước. Port/sợi gõ không có thật
   trong rack → báo lỗi chặn lưu; port đã có luồng khác → chỉ cảnh báo, vẫn
   cho lưu (luồng cũ tự rà lại sau, không tự động can thiệp).
   Tương tự, ô "Đối phương" từng bị nhầm lẫn giữa thiết bị ADN1 nội bộ và
   trạm/thực thể khác thật (lỗi gõ "AĐN1" có dấu Đ khiến parser cũ bỏ sót —
   đã sửa `parseTransitText`/`isManagedStationCode` dùng `normalizeVN`); dữ
   liệu cũ đã di chuyển 1 lần bằng
   `scripts/migrate-counterpart-to-position-next.ts`.

7. **Tự chuẩn hóa chữ gõ ở ô "Vị trí ODF"** (yêu cầu người dùng 2026-07-27,
   hàm `formatCanonicalOdfPosition()` — chuyển sang dùng CHUNG ở
   `lib/trunkPorts.ts` vì áp dụng cho CẢ 2 nơi) — lúc rời khỏi ô (blur), NẾU
   đã khớp đúng 1 rack trung kế thật và không có port/sợi sai (mục 6), tự
   viết lại đúng chuẩn ban hành `ODF x/y (a,b)`. Áp dụng ở:
   - Ô1 "Vị trí ODF (tiếp theo)" bên luồng thiết bị (`DeviceCircuitList.tsx`).
   - Ô "Vị trí ODF" khi "Chuyển tiếp" bên ODF trung kế đã tách cấu trúc 2
     (`PortTable.tsx`, `EditRow`) — CHỈ ô tách riêng này, không áp dụng khi
     "Chuyển tiếp" còn ở dạng 1 ô gộp tự do (cấu trúc 1), vì lúc đó không chắc
     toàn bộ nội dung ô chỉ là tọa độ ODF (có thể có chữ tự do khác), viết đè
     cả ô sẽ mất dữ liệu.
   - Chuỗi hiển thị được DỰNG LẠI từ `rackCode` + port đã xác nhận thật trong
     DB (không giữ nguyên chữ gõ tay), nên "ODF" tự động thành chữ hoa dù gõ
     tắt chữ thường, và luôn có khoảng cách trước "x/y" — kể cả khi
     `racks.code` thật trong DB không có khoảng cách (đã khảo sát toàn bộ 41
     rack trung kế: tất cả đều kiểu "ODF1/1", "ODF2/7.1"... không dòng nào có
     khoảng cách sẵn). Khoảng cách được chèn thêm CHỈ lúc hiển thị ở đây,
     KHÔNG sửa `racks.code` gốc trong DB.
   - Đúng 2 port (cặp Tx/Rx) → đệm 2 chữ số (vd "(05,06)"); CHỈ 1 port (dùng
     1 sợi) → không đệm số 0 (vd "(5)") — 2 kiểu viết khác nhau có chủ đích
     theo yêu cầu người dùng, không phải thiếu sót.
   - Không tự sửa khi đang gõ dở (chưa blur) hoặc khi port/sợi gõ sai — để
     nguyên chữ gõ cho người dùng tự sửa theo đúng lỗi đã báo (mục 6), tránh
     sửa đè lên chỗ đang cần sửa.

8. **`racks`/`ports` THẬT cho ODF/DDF nội bộ** (domain='device', yêu cầu
   người dùng 2026-07-28, `scripts/import-internal-odf-racks.ts`) — trước đây
   mục 6/7 ghi "rack/port bên ODF/DDF thiết bị KHÔNG được tạo thật trong hệ
   thống" (đúng lúc viết, giai đoạn 7 chưa làm); nay đã tạo thật **112 rack ×
   48 port = 5.376 port** cho ODF/DDF đấu chéo thiết bị-thiết bị tại ADN1
   (7 block: 3,4,5,7,8,9,11 — phát hiện qua quét toàn bộ
   `device_position_own`/`device_position_next`/`device_position_map.odf_position`
   tìm "ODF x/y" chưa có rack, xác nhận với người dùng đây là ODF/DDF nội bộ
   thật, không phải tuyến cáp thiếu). Mỗi rack: `odf_type='distribution'`,
   `cable_route_name=null` (không có ý nghĩa ngoài domain=trunk),
   `device_id=null` (panel DÙNG CHUNG nhiều thiết bị đấu tới, không thuộc
   riêng 1 thiết bị), 48 port mặc định `status='unused'`, `fiber_number=null`
   (không có ý nghĩa ngoài domain=trunk). Script idempotent (rack code đã có
   thì bỏ qua) + quét SỐNG từ DB (không hardcode danh sách) nên chạy lại an
   toàn nếu phát hiện thêm block mới sau này.
   - **Giới hạn đã biết**: port mới tạo đều `status='unused'` vì dữ liệu text
     hiện có (vd "ODF 3/6 (35,36)") CHƯA được nối thật qua `port_circuit_links`
     — cảnh báo "port đang có luồng khác" (mục 6) sẽ CHƯA chính xác 100% cho
     các rack này (nhiều port thực ra đã dùng nhưng hệ thống chưa biết). Nối
     thật từng luồng vào đúng port là việc lớn hơn, chưa làm ở đây.
   - **Khớp cả 2 domain**: `lib/trunkPorts.ts` thêm `fetchAllOdfPorts()`
     (cạnh `fetchAllTrunkPorts()` cũ, giữ nguyên cho Tìm kiếm nhanh/Dashboard
     — không đụng 2 nơi đó) lấy CẢ rack trung kế lẫn ODF/DDF nội bộ, dùng cho
     `DeviceCircuitList.tsx` + `PortTable.tsx`. `TrunkPortRow`/
     `TrunkPositionMatch` thêm field `rackDomain`/`domain`. Khớp được rack
     ODF/DDF nội bộ vẫn CHUẨN HÓA + VALIDATE port ở Ô1 y hệt trung kế (mục 7),
     nhưng **KHÔNG chuyển "chế độ Cáp quang"** (Ô2 khóa hiện tên tuyến) — vẫn
     giữ "chế độ Thiết bị" (Ô2 tự do gõ tên thiết bị) vì đây là đấu chéo tại
     chỗ, không phải tuyến cáp ra trạm khác. Cũng áp dụng chuẩn hóa này cho ô
     "Vị trí ODF (thiết bị)" (`positionOwn`) — trước đây hoàn toàn tự do vì
     chưa có dữ liệu thật để đối chiếu, nay khớp được thì tự chuẩn hóa (không
     có chế độ gì để phân biệt vì ô này không có Ô2/Ô3 đi kèm).
   - **Trang xem/sửa**: `/odf-device/odf-ddf-noi-bo` (mới, menu "ODF/DDF nội
     bộ") liệt kê 112 rack này bằng lại `RackListTable` — bấm vào 1 rack dùng
     lại NGUYÊN trang `/odf-trunk/[rackId]` (không tạo trang riêng, đúng yêu
     cầu người dùng "dùng lại đúng bảng/nút bấm đã có") vì trang đó vốn không
     lọc theo domain khi tra rack theo id — chỉ khác link "quay lại" tự trỏ
     đúng danh sách theo `rack.domain`.

9. **Sửa lỗi biên trong `matchTrunkPosition()` + rà lại dữ liệu ODF cũ đã lưu
   sai** (phát hiện + xử lý 2026-07-28) — sau khi mục 8 tạo rack ODF/DDF nội
   bộ thật, người dùng kiểm tra lại đúng luồng test ban đầu
   ("ADN1.ASBR#2-MX2020 (7/0/3)") thì thấy Ô "Vị trí ODF" vẫn ghi sai cú pháp
   (`"ODF3/6/(39,40)"`, `"ODF 11/5/(13,14)"` — thiếu khoảng cách, còn dấu "/"
   thay vì " (" trước danh sách port). Nguyên nhân: `formatCanonicalOdfPosition()`
   CHỈ chạy khi người dùng gõ+rời khỏi ô (onBlur) — dữ liệu lưu TRƯỚC KHI rack
   thật tồn tại (test ở mục 8) không tự động chuẩn hóa lại chỉ vì rack đã được
   tạo sau đó, phải gõ lại + rời ô thì mới kích hoạt.
   - **Rà soát dữ liệu cũ**: 2 script DRY RUN/`--commit` mới —
     `scripts/normalize-odf-positions.ts` (rà lại toàn bộ
     `circuits.device_position_own`/`device_position_next` +
     `device_position_map.odf_position`, dùng lại ĐÚNG thuật toán
     `matchTrunkPosition`/`formatCanonicalOdfPosition` đang chạy live — script
     chỉ sửa đúng những gì UI sẽ tự sửa nếu gõ lại + rời ô hôm nay, không có
     rủi ro sai khác; `device_position_next` dùng `splitOdfDeviceStructure`/
     `combinePositionNext` để chỉ chuẩn hóa phần ODF, giữ nguyên phần thiết
     bị/trib ghép kèm) — đã chạy `--commit`, sửa 62 circuits + 32
     device_position_map. Không import trực tiếp `lib/trunkPorts.ts` được vào
     script (file đó `import { supabase } from "@/lib/supabase"`, đọc
     `process.env` NGAY lúc import module — không tương thích khi chạy qua
     `tsx` vì `.env.local` chỉ nạp được SAU khi import đã chạy xong) nên 2 hàm
     match/format được copy nguyên văn vào script; **sửa thuật toán gốc thì
     phải sửa lại y hệt ở bản copy trong script**.
   - **Lỗi biên phát hiện được nhờ rà dữ liệu cũ** (nghiêm trọng hơn — ảnh
     hưởng cả đường live, không chỉ dữ liệu cũ): `matchTrunkPosition()` so
     khớp bằng `string.startsWith()` sau khi bỏ khoảng trắng, không kiểm tra
     ranh giới số — vd rack "ODF1/16" KHÔNG tồn tại thật (block 1 chỉ có
     "ODF1/1".."ODF1/14"), nhưng do "ODF1/16..." vẫn khớp tiền tố ký tự với mã
     rack ngắn hơn "ODF1/1" (thật), số "6" còn dư bị hiểu nhầm thành 1 port,
     sinh dữ liệu SAI kiểu `"ODF 1/1 (06,05,06)"` từ input đúng
     `"ODF 1/16 (05,06)"`. Đã sửa: chặn khớp khi điểm cắt nằm GIỮA 1 dãy số
     liền nhau (mã rack kết thúc bằng chữ số VÀ phần còn lại bắt đầu bằng chữ
     số) — coi như không khớp, thử mã ngắn hơn tiếp theo, cuối cùng trả về
     "không khớp" đúng bản chất (rack đó chưa tồn tại thật, không đoán đại).
     Áp dụng ở CẢ `lib/trunkPorts.ts` (đường live) lẫn bản copy trong script.
     Đã kiểm chứng lại bằng Playwright: gõ "ODF1/16 (5,6)" (rack không tồn
     tại) → giữ nguyên, không tự sửa sai; gõ "odf1/14/3,4" (rack 2 chữ số có
     thật, dễ nhầm với "ODF1/1") → vẫn khớp đúng "ODF 1/14 (03,04)".
   - **Thêm chuẩn hóa cho ô thứ 3 còn thiếu**: `DevicePositionMapClient.tsx`
     (trang `/odf-device/vi-tri-thiet-bi`, cả khung "Thêm dòng mới" lẫn Sửa)
     trước đó KHÔNG có onBlur chuẩn hóa cho ô "Vị trí ODF/DDF" (chỉ
     `DeviceCircuitList.tsx`/`PortTable.tsx` có) — nay thêm cho đủ 3 nơi, nhận
     `trunkPorts` qua prop mới (`fetchAllOdfPorts()`, page.tsx truyền vào).

10. **"100G" → "100GE"** (yêu cầu người dùng 2026-07-28) — dữ liệu import gốc
    còn sót nhãn tốc độ giao tiếp thiếu chữ "E" (`circuits.interface_type` và
    cả tiền tố trong `circuits.name` tự do, vd `"100G AĐN1.P2 (...) - ..."`) —
    "100GE" vốn đã là giá trị đúng dùng phổ biến sẵn (placeholder ô "Giao
    tiếp", comment cột `interface_type` trong migration gốc), "100G" chỉ là
    thiếu sót còn sót lại, không phải 1 giá trị hợp lệ khác. Script
    `scripts/fix-100g-label.ts` (DRY RUN/`--commit`, regex `/100G(?!E)/gi` —
    bỏ qua cụm đã đúng "100GE" sẵn) đã sửa 328 circuits. Đây là sửa DỮ LIỆU
    (chạy 1 lần), KHÔNG phải sửa schema hay thêm validation — nếu sau này lại
    gõ "100G" thiếu chữ E thì vẫn lưu được bình thường (ô "Giao tiếp" là
    free-text/datalist gợi ý, không ép buộc theo danh sách cố định).

11. **Nút "Xóa bộ lọc"** (yêu cầu người dùng 2026-07-28) — mỗi bảng dữ liệu có
    nhiều ô lọc theo cột (`FilterInput`, xem mục lọc kiểu Excel ở
    `lib/tableFilter.ts`) nay có thêm 1 nút xóa TOÀN BỘ ô lọc của bảng đó về
    rỗng cùng lúc, thay vì phải xóa tay từng ô — chỉ hiện khi có ít nhất 1 ô
    đang lọc (tránh rối khi không cần). Áp dụng cho cả 5 bảng có ô lọc:
    `DeviceCircuitList.tsx`, `PortTable.tsx`, `RackListTable.tsx`,
    `SearchClient.tsx`, `DevicePositionMapClient.tsx`. Không tạo hook/component
    dùng chung cho việc này — mỗi bảng tự quản lý state `filters` riêng từ
    trước (không có 1 hook lọc chung để móc vào), nút chỉ gọi thẳng
    `setFilters(...)` với object rỗng đúng shape từng bảng, đủ đơn giản để
    không cần trừu tượng hóa thêm. `SearchClient.tsx` CHỈ xóa các ô lọc tự do
    theo cột (route/port/fiber/name/counterpart) — KHÔNG đụng tới bộ lọc
    "Trạng thái" (nút bấm)/"chọn rack" (dropdown) vì đó là control khác, bấm 1
    lần đã xong, không phải nỗi đau "gõ nhiều ô" mà người dùng phản ánh.

12. **Rack "ODF1/15" thiếu thật** (phát hiện khi rà lỗi biên mục 9 — người
    dùng xác nhận 2026-07-28: block 1 chỉ có thật tới "ODF1/15", "ODF1/16"
    xuất hiện 5 lần trong dữ liệu chỉ là lỗi gõ/nhầm, KHÔNG tạo rack cho nó).
    `scripts/add-missing-rack-odf1-15.ts` (DRY RUN/`--commit`) tạo rack +
    48 port. **Lưu ý quan trọng — thử SAI trước khi ra đúng**: lần đầu nhân
    bản theo rack liền trước "ODF1/14" (`domain='trunk'`, `odf_type=
    'distribution'`) vì tưởng cùng bản chất "phân phối/dự phòng" trong 1 block
    trung kế thật; kiểm thử Playwright ngay sau đó lộ ra 2 vấn đề:
    - "ODF1/14" hóa ra là rack trung kế THẬT SỰ, có luồng gắn qua
      `port_circuit_links` (Tx/Rx) — KHÔNG hề được tham chiếu qua
      `device_position_own/next` như "ODF1/15". Số block giống nhau không có
      nghĩa cùng bản chất domain.
    - `domain='trunk'` khiến UI tự khóa Ô2 "tiếp theo" vào `cable_route_name`
      (chế độ Cáp quang) + bắt Ô3 phải là SỐ SỢI — nhưng dữ liệu thật ghép
      kèm "ODF 1/15" lại là TÊN THIẾT BỊ (OME-TK#1/#2) + trib dạng "S10-2"
      (không phải số sợi), sinh lỗi sai "Sợi 'S10-2' không tồn tại trong
      tuyến cáp 'ODF1/15'" và Ô2 hiện rỗng dù dữ liệu thật có tên thiết bị.
    → Đã sửa lại **`domain='device'`** (cable_route_name=null, fiber_number=
    null mọi port — đúng quy ước 112 rack "ODF/DDF nội bộ" mục 8, vì bản chất
    dùng giống hệt: chỉ tồn tại qua text tự do, chưa từng có `port_circuit_links`
    thật). Bài học: **quyết định domain='trunk'/'device' phải dựa vào CÁCH
    RACK ĐƯỢC THAM CHIẾU THẬT trong dữ liệu (qua `port_circuit_links` thật hay
    chỉ qua text tự do `device_position_*`), KHÔNG dựa vào số block hay rack
    liền kề nào** — 2 rack cùng nằm trong 1 block trung kế (cùng số "1") vẫn
    có thể khác domain nhau.

13. **"Hồ sơ ODF Thiết bị" đổi sang cấu trúc rack → port → luồng** (yêu cầu
    người dùng 2026-07-28) — gộp 2 trang "Vị trí thiết bị → ODF/DDF" +
    "ODF/DDF nội bộ" thành 1, để xem ODF/DDF thiết bị theo đúng kiểu "Hồ sơ
    ODF Trung kế" (chọn rack → thấy port nào đang có luồng thật) thay vì danh
    sách luồng phẳng như trước.
    - **Định tuyến lại**: `/odf-device` (giữ nguyên tên/URL quen thuộc) nay
      là danh sách rack domain='device' (nội dung cũ ở
      `/odf-device/odf-ddf-noi-bo`, route này đã xóa). Danh sách luồng phẳng
      (Thêm/Sửa/Xóa, `DeviceCircuitList.tsx`) chuyển sang
      `/odf-device/sua-luong`, đổi tên "Sửa luồng thiết bị" — vẫn là nơi DUY
      NHẤT thao tác chi tiết luồng. `/odf-device/vi-tri-thiet-bi` (thư viện
      gợi ý, `DevicePositionMapClient.tsx`) giữ nguyên route/component, chỉ
      bỏ khỏi Sidebar, truy cập qua link ở trang `/odf-device` mới.
    - **Vì sao KHÔNG dùng `port_circuit_links` thật cho luồng thiết bị**:
      khảo sát code xác nhận "luồng thiết bị" được ĐỊNH NGHĨA trong toàn bộ
      hệ thống (kể cả 6+ script, xem `lib/deviceCircuits.ts`
      `fetchDeviceCircuits()`) là "circuit KHÔNG có `port_circuit_links`
      nào" — nếu gán luồng thiết bị vào bảng nối thật để hiện chặt như trung
      kế, nó sẽ tự động biến mất khỏi mọi nơi đang coi nó là luồng thiết bị.
      Đây là thay đổi kiến trúc lớn, không làm trong đợt này.
    - **`lib/deviceRackPorts.ts`** (mới) — `fetchDeviceRackPortRefs(rackCode,
      trunkPorts)`: quét toàn bộ `circuits`, đối chiếu
      `device_position_own`/`device_position_next` (tách phần ODF khỏi phần
      thiết bị/trib qua `splitOdfDeviceStructure()` trước khi so khớp — thiếu
      bước này từng gây đếm sai số liệu khi khảo sát, xem dưới) qua
      `matchTrunkPosition()` đã có, trả về map port → danh sách luồng
      own/next. Đây là ĐỐI CHIẾU TEXT một chiều (port → luồng), KHÔNG phải
      bảng nối thật.
    - **`components/odf-device/DeviceRackPortView.tsx`** (mới, Server
      Component thuần, không sửa tại chỗ được — yêu cầu người dùng: đợt này
      chỉ xem + link nhảy sang Sửa) — dùng ở `/odf-trunk/[rackId]/page.tsx`
      (route dùng chung cho cả 2 domain, y hệt trước) THAY CHO `PortTable`
      khi `rack.domain==='device'`. Mỗi port hiện tối đa 2 dòng: luồng có
      **own** = port này, luồng có **next** = port này (đầu xa của 1 luồng
      khác) — mỗi dòng link `/odf-device/sua-luong#dc-<id>`.
    - **`lib/deviceCircuitAnchor.ts`** (mới) — tách `rowAnchor()` ra khỏi
      `DeviceCircuitList.tsx` (file `"use client"`) thành file thuần không
      client/server gì, vì Next.js App Router **không cho Server Component
      dùng trực tiếp 1 export thường (không phải component) từ module
      `"use client"`** (gặp lỗi runtime "is not a function" khi thử — bài
      học chung: hàm tiện ích cần dùng ở CẢ Server lẫn Client Component phải
      nằm ở file không có `"use client"`). `DeviceCircuitList.tsx` vẫn
      `export { rowAnchor }` lại (import từ file mới) để nơi khác không phải
      đổi cách import.
    - **Khảo sát dữ liệu trước khi xây** (minh bạch: lần đầu tính sai) — quét
      thử ban đầu báo "696 port bị nhiều luồng mâu thuẫn" do BUG ở chính
      script khảo sát (quét nhầm cả chữ số trong tên thiết bị/trib phía sau
      `device_position_next`, chưa tách phần ODF trước khi so khớp — đúng lỗi
      đã tránh được ở `lib/deviceRackPorts.ts` nhờ dùng `splitOdfDeviceStructure()`
      trước). Sau khi sửa cách khảo sát, dữ liệu THẬT SẠCH: 3314/5424 port có
      tham chiếu, 2014 port có đủ own+next (đúng mô hình 2 chặng), chỉ **1
      xung đột thật** (2 luồng cùng nhận own="ODF 4/3 (43,44)") — đã xác nhận
      với người dùng luồng "TSSE3B (ETMOD-25-3)" sai (thiết bị đã tắt nguồn)
      và xóa `device_position_own` của đúng dòng đó (còn 1 dòng khác cùng tên
      nhưng own khác, không đụng tới).

14. **Xóa hàng loạt: xóa hẳn 1 thiết bị + tick chọn nhiều luồng để xóa cùng
    lúc** (yêu cầu người dùng 2026-07-28: "bổ sung thêm chức năng xóa luôn
    một thiết bị và xóa nhiều luồng cùng lúc (tick chọn rồi bấm xóa)", kèm yêu
    cầu đồng bộ dữ liệu giữa các Hồ sơ liên quan).
    - **Khảo sát trước khi làm**: kiểm tra thật trên DB (không đoán) xem những
      bảng nào tham chiếu tới `devices(id)` để biết cần dọn gì khi xóa 1 thiết
      bị — `racks.device_id IS NOT NULL`: 0 dòng; `transit_links.target_device_id
      IS NOT NULL`: 0 dòng (dù `transit_links` có 503 dòng, toàn bộ đều
      `target_type='text_only'`, đúng như mục 8 đã ghi) — 2 cột này AN TOÀN,
      không cần xử lý gì thêm khi xóa devices. Ngược lại `circuits.device_id`
      có 1647 dòng đang tham chiếu — đây là quan hệ DUY NHẤT cần xử lý thật.
    - **`/odf-device/sua-luong` (`DeviceCircuitList.tsx`) — tick chọn nhiều
      luồng để xóa cùng lúc**: thêm cột checkbox đầu bảng (giống hệt cơ chế
      tick đã có sẵn ở `DeviceCategoryClient.tsx` — tập `selected: Set<string>`
      độc lập với bộ lọc/sắp xếp đang hiển thị, không bị xóa khi đổi bộ lọc),
      nút "Chọn tất cả đang hiện"/"Bỏ chọn đang hiện"/"Bỏ chọn tất cả (N)", và
      nút xóa hàng loạt "Xóa N luồng đã chọn" (nền đỏ, chỉ hiện khi có tick).
      `deleteSelectedCircuits()` xóa theo lô 200 id/lần qua
      `circuits.delete().in("id", batch)` — an toàn vì luồng thiết bị KHÔNG
      bao giờ có `port_circuit_links` (cùng lý do `deleteCircuit()` đơn dòng
      đã dùng từ trước), không cần dọn gì khác ngoài chính bảng `circuits`.
    - **`/devices` (`DeviceCategoryClient.tsx`) — xóa hẳn 1/nhiều thiết bị**:
      tái dùng NGUYÊN cơ chế tick chọn đã có sẵn (trước đây chỉ dùng cho
      gán/đổi lĩnh vực và đổi tên/gộp) — thêm 1 nút "Xóa" (nền đỏ) trong khung
      thao tác hàng loạt hiện có, hiện rõ số luồng sẽ bị xóa kèm theo
      (`selectedCircuitCount`, tính từ prop `circuits` đã có sẵn) ngay trong
      hộp thoại xác nhận, để không xóa nhầm hàng loạt luồng mà không biết
      trước. **Khác "gộp" (`applyBulkRename`)**: gộp giữ lại 1 thiết bị đích
      và chuyển luồng sang đó; xóa thì KHÔNG giữ gì lại — toàn bộ luồng đang
      gán cho (các) thiết bị bị tick cũng bị xóa theo, vì 1 luồng thiết bị
      không có ý nghĩa khi không còn thiết bị sở hữu.
      `deleteSelectedDevices()` làm theo lô 200 id/lần, đúng thứ tự: (1) xóa
      `circuits` theo `device_id in (...)`, (2) dọn `device_position_map` theo
      tên thiết bị (xem dưới), (3) xóa `devices` theo `id in (...)` — thứ tự
      này bắt buộc vì `circuits.device_id`/để rỗng thư viện trước, xóa
      `devices` sau cùng mới không vướng gì.
    - **`lib/devicePositionMap.ts` — thêm `deleteDevicePositionMapForNames(names)`**:
      dọn các dòng thư viện "Vị trí thiết bị" khớp tên (các biến thể chuẩn hóa
      qua `normalizeDeviceNameKey`) của (các) thiết bị VỪA bị xóa hẳn — đây
      chính là phần "đồng bộ dữ liệu với Hồ sơ khác" người dùng yêu cầu:
      `device_position_map` không có FK thật tới `devices` (khớp bằng tên,
      xem đầu file mục 8.2), nên xóa thiết bị không tự dọn thư viện nếu không
      gọi hàm này — nếu bỏ qua, thư viện sẽ còn sót gợi ý (tên thiết bị + vị
      trí ODF) cho 1 thiết bị không còn tồn tại. Cùng cấu trúc
      fetch-toàn-bộ-rồi-lọc-theo-key-chuẩn-hóa như `syncDevicePositionMapNames()`
      đã có (chỉ khác là xóa hẳn thay vì đổi tên), đặt cạnh nhau trong cùng
      file cho dễ đối chiếu.
    - **Không đụng `/odf-trunk/[rackId]` (`DeviceRackPortView.tsx`)**: view
      rack/port của "Hồ sơ ODF Thiết bị" (mục 13) tính lại HOÀN TOÀN từ
      `circuits.device_position_own/next` mỗi lần render (đối chiếu text, xem
      `lib/deviceRackPorts.ts`) — không lưu trạng thái riêng, nên xóa luồng ở
      trên tự động biến mất khỏi view này ngay lần render sau, không cần đồng
      bộ gì thêm.
    - **Kiểm chứng**: `tsc --noEmit` sạch; 2 trang `/odf-device/sua-luong` và
      `/devices` vẫn trả 200 sau khi sửa (kiểm tra qua curl vì môi trường lần
      này không có sẵn công cụ điều khiển trình duyệt/Playwright — không click
      tay qua UI được, đã nói rõ với người dùng). Bù lại, đã chạy 1 script
      kiểm chứng tạm (`scripts/_tmp-verify-delete.ts`, xóa ngay sau khi chạy
      xong) gọi THẲNG các hàm/thao tác Supabase thật y hệt 2 hàm mới sẽ chạy
      khi bấm nút (kể cả `deleteDevicePositionMapForNames()` thật, không phải
      bản sao) trên 1 thiết bị test + 2 luồng gắn kèm + 1 dòng thư viện test +
      3 luồng standalone test (tự tạo, tự xóa, tự dọn nếu lỗi giữa chừng) —
      toàn bộ các bước PASS: xóa thiết bị kéo theo đúng 2 luồng + 1 dòng thư
      viện liên quan, xóa 3 luồng standalone theo lô đúng cả 3.

15. **Phát hiện: dữ liệu "Vị trí ODF (tiếp theo)" bên luồng thiết bị có thể
    trỏ tới 1 port trung kế THẬT mà không hề có `port_circuit_links` thật ở
    đó** (người dùng phát hiện 2026-07-28 qua luồng "10GE AĐN1.P2 (17/0/3) -
    DNG.MPE.06 (1/2/1)": Ô "Vị trí ODF (tiếp theo)" ghi "ODF 1/5 (07,08)",
    rack `ODF1/5` là rack trung kế THẬT (`cable_route_name`="48FO#2 ADN1 -
    2T9"), nhưng port 7/8 ở đó vẫn `status='unused'`, không có
    `port_circuit_links` nào — Hồ sơ ODF Trung kế hiện "— trống —" dù bên
    "Sửa luồng thiết bị" đã ghi rõ đang dùng).
    - **Nguyên nhân gốc (không phải bug mới, là khoảng trống kiến trúc có từ
      đầu)**: `matchTrunkPosition()` (mục 8/9) chỉ dùng để VALIDATE (port có
      tồn tại không, có đang bị luồng khác chiếm không) khi gõ Ô "Vị trí ODF
      (tiếp theo)" — nó KHÔNG BAO GIỜ tạo `port_circuit_links` thật cho port
      trung kế đó. Vì vậy 1 luồng thiết bị có thể hợp lệ ghi "đấu ra trung kế
      tại port X" (Ô1 khớp đúng rack/port thật, không báo lỗi) nhưng phía Hồ
      sơ ODF Trung kế vẫn không biết gì về việc này trừ khi có người NHẬP
      RIÊNG 1 luồng trung kế thật (qua `/odf-trunk/[rackId]`, `PortTable.tsx`)
      cho đúng port đó — 2 "hồ sơ" ghi nhận độc lập, không tự đồng bộ.
    - **Đã kiểm tra bằng chứng trước khi kết luận**: `PortTable.tsx` dòng
      hiện "— trống —" dựa vào có/không có `circuit` suy từ join
      `port_circuit_links` (KHÔNG dựa vào cột `ports.status`) — nên chỉ tự
      sửa `ports.status` (không tạo `port_circuit_links` thật) sẽ KHÔNG thay
      đổi gì hiển thị, đã loại phương án này trước khi đề xuất hướng sửa.
    - **`scripts/audit-device-trunk-sync.ts`** (mới, chỉ đọc/không sửa gì,
      `npm run audit-device-trunk-sync`) — quét TOÀN BỘ luồng thiết bị (2224+
      luồng), đối chiếu cả `device_position_own` lẫn phần ODF của
      `device_position_next` (tách qua `splitOdfDeviceStructure`, tránh lại
      đúng lỗi "696 port mâu thuẫn" đã tự sửa ở mục 13) qua `matchTrunkPosition()`
      thật — với MỖI port khớp được 1 rack trung kế thật, kiểm tra
      `resolvedPorts[].inUse` (đúng field UI dùng để hiện cảnh báo "port đang
      có luồng khác") để tìm port nào TRỐNG dù văn bản nói đã dùng.
      **Kỹ thuật mới** (tốt hơn 2 script trước `normalize-odf-positions.ts`/
      `fix-100g-label.ts` phải chép nguyên văn thuật toán vì `lib/trunkPorts.ts`
      `import "@/lib/supabase"` đọc `process.env` ngay lúc import, không tương
      thích thứ tự chạy qua `tsx`): gọi `loadEnv()` xong rồi mới
      `await import("../lib/trunkPorts")` **ĐỘNG** (dynamic import không bị
      hoist như import tĩnh) — nhờ vậy dùng THẲNG được hàm live thật, không
      cần chép lại thuật toán, không cần cờ/biến môi trường phụ nào khi gọi
      `npm run`, có thể áp dụng lại cho các script sau này cần tình huống
      tương tự.
    - **Kết quả rà soát (2026-07-28)**: 0 trường hợp port/sợi gõ sai (không có
      lỗi chính tả kiểu số port không tồn tại thật). **64 lượt "chưa đồng bộ"
      thật**: luồng thiết bị khớp đúng 1 rack/port trung kế thật nhưng port đó
      đang trống trên Hồ sơ ODF Trung kế — đây là phạm vi ĐÚNG với báo cáo của
      người dùng (chỉ tính rack `domain='trunk'`, KHÔNG tính ~2600 lượt khớp
      rack ODF/DDF nội bộ `domain='device'` — phần đó là giới hạn ĐÃ biết/đã
      xác nhận từ mục 8, không phải lỗi mới, vì các rack nội bộ đó là panel
      dùng chung nhiều thiết bị, chưa từng có ý định nối `port_circuit_links`
      thật cho từng luồng).
    - **Báo cáo trực quan**: dựng 1 trang HTML tạm (bảng 64 dòng, lọc/sắp xếp
      theo tên luồng/thiết bị/rack/trường own-next, đánh dấu ★ đúng luồng
      người dùng báo cáo ban đầu) để người dùng rà trước khi quyết định hướng
      sửa — không lưu trong repo (chỉ là báo cáo 1 lần, không phải tài liệu
      sống).
    - **Đã hỏi & người dùng chọn hướng sửa**: "Tự động tạo luồng trung kế cho
      cả 64" — tạo thật `circuits`+`port_circuit_links` phía trung kế cho từng
      trường hợp, đúng pattern "2 dòng circuit mirror nhau cho 1 liên kết vật
      lý" đã có sẵn trong dữ liệu (không đụng luồng thiết bị gốc).
    - **`scripts/sync-missing-trunk-circuits.ts`** (mới, DRY RUN/`--commit`,
      `npm run sync-missing-trunk-circuits`) — với mỗi trường hợp: tạo 1
      `circuits` MỚI (copy `name`/`interface_type`/`counterpart_text` từ luồng
      thiết bị gốc, `notes` ghi rõ "tự tạo từ luồng thiết bị ... + id gốc" để
      truy vết sau này), `port_circuit_links` (2 port -> `tx`/`rx`, 1 port ->
      `single`, đúng quy ước `PortTable.tsx` đã dùng), cập nhật
      `ports.status='in_use'`. Rà soát lại SỐNG (không dùng lại ảnh chụp audit
      cũ) ngay trước khi ghi từng dòng, để tự phát hiện + bỏ qua đúng các cặp
      "luồng mirror cùng trỏ 1 port" (xử lý xong 1 luồng thì luồng kia tự
      nhiên "hết trống", không tạo trùng) thay vì tạo lặp.
    - **Bug tự phát hiện lúc chạy `--commit` thật (2026-07-28, đã sửa ngay)**:
      bước rà soát sống dùng sai kiểu dữ liệu — `port_circuit_links` có ràng
      buộc `unique(port_id)` nên PostgREST trả về quan hệ này dạng **1 OBJECT
      đơn (hoặc null), KHÔNG PHẢI mảng**; code ban đầu coi nhầm là mảng rồi
      lọc `.length > 0` (`undefined > 0` luôn `false`) nên bước rà soát sống
      KHÔNG BAO GIỜ phát hiện được xung đột thật. Hậu quả thực tế: 4/64 lượt cố
      ghi trùng port bị chính **ràng buộc `unique` thật của Postgres** chặn lại
      ở bước insert (đúng vai trò lưới an toàn cuối cùng) — code đã tự động
      xóa lại `circuits` vừa tạo khi insert `port_circuit_links` lỗi, xác nhận
      lại bằng truy vấn trực tiếp: **0 dòng `circuits` mồ côi** (không link nào)
      bị bỏ sót. Đã sửa lại đúng kiểu (dùng chung cách `firstOf()` xử lý cả 2
      dạng như `lib/trunkPorts.ts`), chạy lại xác nhận bước rà soát sống hoạt
      động đúng (hiện "[BỎ QUA]" thay vì cố ghi rồi lỗi).
    - **Kết quả cuối (2026-07-28)**: từ 64 trường hợp — **60 luồng trung kế
      mới tạo thành công**; **3 trường hợp là cặp mirror trùng port** (2 luồng
      thiết bị khác nhau cùng mô tả đúng 1 cặp port trung kế — vd
      "10GE AĐN1.PE#2 (11/3/0)..." có cả 2 dòng own/next đều trỏ "ODF2/10
      (21,22)") nên chỉ cần 1 luồng trung kế thật, dòng còn lại tự nhận diện
      "đã đủ" và không tạo trùng; **1 trường hợp xung đột THẬT cần rà tay**:
      "100GE AĐN1.BNG#1 (7/0/0) - Đài Phát.VNPT ĐNG" ghi dùng "ODF 6/5
      (61,68)" nhưng port 61 tại đó đã có SẴN 1 luồng trung kế khác từ trước
      ("ADN1.PE2(5/3/1) - SW.MEDIA(40LL)") — có thể 1 trong 2 ghi sai port,
      chưa rõ bên nào đúng, KHÔNG tự đoán, để người dùng đối chiếu hồ sơ giấy
      rồi sửa tay. Chạy lại `scripts/audit-device-trunk-sync.ts` xác nhận số
      "chưa đồng bộ" giảm đúng từ 64 xuống còn 1 (trường hợp trên).
    - **Kiểm chứng**: `tsc --noEmit` sạch; curl lại `/odf-trunk`, `/odf-device`,
      `/odf-device/sua-luong`, `/dashboard`, `/search` đều 200 sau khi ghi dữ
      liệu.

16. **Bug: xóa luồng ở Hồ sơ ODF Trung kế không xóa "Chuyển tiếp" của port**
    (người dùng phát hiện 2026-07-28, `PortTable.tsx`) — `deleteGroup()` (nút
    "Xóa" 1 luồng) chỉ xóa `port_circuit_links` + `circuits` + đưa
    `ports.status` về `unused`, KHÔNG đụng gì tới `transit_links` (bảng RIÊNG,
    khóa theo `source_port_id` — xem mục 3.6). Vì vậy sau khi xóa, port về
    trạng thái trống nhưng cột "Chuyển tiếp" vẫn hiện text cũ — sai vì port đó
    không còn luồng nào để "chuyển tiếp" đi đâu nữa. `saveEdit()` đã làm ĐÚNG
    việc này ở nhánh tách 1 port ra khỏi cặp (`removedPortIds`, có từ trước) —
    chỉ riêng `deleteGroup()` (xóa hẳn cả luồng) bị sót.
    - **Đã tìm thêm 1 chỗ lỗi giống hệt khi rà theo cùng logic**: nhánh
      "Chuyển tuyến" (`confirmMove()`) — khi chọn "Xóa dữ liệu ở port nguồn"
      sau khi chuyển luồng sang port mới, cũng chỉ xóa `port_circuit_links` +
      đưa port nguồn về `unused`, không xóa `transit_links` của port nguồn.
      Cùng nguyên nhân, cùng cách sửa — sửa cả 2 chỗ trong 1 lượt cho nhất
      quán thay vì chỉ sửa đúng chỗ người dùng báo.
    - **Cách sửa**: cả 2 nơi đều lấy `transitLinkId` có sẵn trên `PortView`
      (đã tải kèm dữ liệu port từ đầu, không cần query thêm) của các port
      SẮP được giải phóng, xóa các dòng `transit_links` đó cùng lúc sau khi
      xóa `port_circuit_links`/cập nhật `status`. `deleteGroup()` còn cập nhật
      lại câu hỏi xác nhận, thêm rõ "...và dữ liệu Chuyển tiếp của các port
      đó" khi có transit_links sẽ bị xóa kèm, để người dùng biết trước hậu quả
      đầy đủ trước khi bấm Xóa.
    - **Dữ liệu cũ đã bị ảnh hưởng do bug này (trước khi sửa) — đã xóa**: rà
      soát ban đầu thấy **2 dòng `transit_links`** đang nằm trên port
      `status=unused` (rack `ODF6/5` port 61 và 72) trong tổng 503 dòng
      `transit_links`. Lúc đầu định KHÔNG tự xóa (lý do ban đầu: 1 port trống
      vẫn được phép có "Chuyển tiếp" nhập trực tiếp có chủ đích — nhánh
      `isNew && !hasCircuitData` trong `saveEdit()` — không có cách nào phân
      biệt chắc chắn "rác do bug" và "nhập tay có chủ đích" chỉ từ trạng thái
      hiện tại). **Người dùng chỉnh lại đúng**: `ODF6/5` là rack `odf_type=
      'welded'` (hàn nối) — loại này KHÔNG có chuyện thiết bị đấu cáp trực
      tiếp ra rồi khai "Chuyển tiếp" trước khi tạo luồng (đó là tình huống chỉ
      hợp lý với rack `distribution`); 1 port trống trên rack hàn nối không có
      lý do chính đáng nào để mang "Chuyển tiếp", nên 2 dòng này CHẮC CHẮN là
      rác từ bug trên → đã xóa thẳng. **Bài học**: khi cân nhắc dữ liệu "có
      thể là rác" nhưng không chắc, phải xét thêm ràng buộc VẬT LÝ/nghiệp vụ
      cụ thể (ở đây là loại rack) trước khi kết luận "không đủ căn cứ để xóa"
      — người dùng nắm rõ hiện trạng thiết bị thật hơn suy luận trừu tượng từ
      dữ liệu. Không mở rộng thành rule tự động "rack hàn nối thì chặn nhập
      Chuyển tiếp khi port trống" trong đợt này (thay đổi hành vi UI, chưa được
      yêu cầu) — chỉ xóa đúng 2 dòng rác cụ thể đã xác nhận.
    - **Kiểm chứng**: `tsc --noEmit` sạch.

17. **Danh sách "Chuyển tiếp chưa đúng chuẩn form" ở `/odf-trunk`** (yêu cầu
    người dùng 2026-07-28: "cột chuyển tiếp vẫn chưa được chuẩn form ODF x/y
    (a,b) - ADN1.thiết bị (port)... thông báo... như kiểu trùng port ấy").
    - **`lib/transitLinks.ts`** (mới) — `fetchNonConformingTransitLinks()`
      quét TOÀN BỘ `transit_links` (chỉ tính port thuộc rack `domain='trunk'`
      — ODF/DDF nội bộ không dùng bảng này), dùng lại `splitOdfDeviceStructure()`
      thật (đã có, `lib/parsers/transit-text.ts`) để lọc ra dòng KHÔNG khớp
      "cấu trúc 2" đã ban hành. **CHỈ liệt kê, KHÔNG tự sửa** — cùng triết lý
      `positionConflicts` ở `DeviceCircuitList.tsx`: rất nhiều cách "không khớp
      cấu trúc 2" vẫn có thể là dữ liệu ĐÚNG (đi thẳng ra trạm khác không qua
      thiết bị ADN1 nào, hoặc mới chỉ có tọa độ ODF chưa rõ thiết bị đích) —
      chỉ người dùng đủ bối cảnh thực tế để phân biệt.
    - **Bug PostgREST gặp khi viết hàm này**: `transit_links` có 2 FK khác
      nhau cùng trỏ tới `ports` (`source_port_id` và `target_port_id`) — embed
      trơn `ports(...)` bị lỗi `PGRST201` ("more than one relationship was
      found") vì PostgREST không tự biết dùng FK nào. Phải chỉ đích danh tên
      ràng buộc: `ports:ports!transit_links_source_port_id_fkey(...)`.
    - **`components/odf-trunk/TransitFormatWarning.tsx`** (mới) — khung cảnh
      báo màu vàng (khác màu đỏ của `positionConflicts` — đây là "cần rà lại",
      không hẳn là lỗi/xung đột chắc chắn), có tìm + phân trang, đặt ở
      `/odf-trunk` (trang danh sách rack — nơi tổng hợp toàn trạm, vì ODF
      trung kế không có 1 trang "toàn bộ luồng" như bên thiết bị). Mỗi dòng
      là link `/odf-trunk/<rackId>#port-<portId>`.
    - **`PortTable.tsx`** — thêm cơ chế nhảy tới + tô sáng tạm 1 port qua hash
      `#port-<id>` (id gắn trên `<tr>` mỗi port, `useEffect` đọc
      `window.location.hash` lúc mount + khi đổi hash) — cùng cơ chế
      `rowAnchor`/`highlightId` đã có ở `DeviceCircuitList.tsx`, áp dụng cho
      ĐÚNG 1 port thay vì cả nhóm/luồng.
    - **Kết quả rà soát (2026-07-28)**: 223/503 dòng `transit_links` chưa khớp
      "cấu trúc 2" — số liệu SỐNG (đổi so với mốc "297/503 khớp" ghi ở
      `lib/parsers/transit-text.ts` từ 2026-07-27, do dữ liệu đã thay đổi qua
      các lần sửa/thêm luồng từ đó tới nay), không phải sai số/lỗi đếm.
    - **Sự cố ngoài ý muốn khi kiểm thử**: `.next` cache hỏng lần nữa (cùng
      loại lỗi `EBUSY: resource busy or locked` đã gặp trước đó trong phiên
      này, do OneDrive đồng bộ đè lên thư mục cache trong lúc dev server đang
      ghi) — xử lý lại đúng quy trình đã lập: dừng tiến trình node, xóa
      `.next`, khởi động lại.
    - **Kiểm chứng**: `tsc --noEmit` sạch; kiểm tra trực tiếp qua hàm thật
      (không phải bản chép) xác nhận đúng 223 dòng; curl toàn bộ route chính
      (`/`, `/odf-trunk`, `/odf-trunk/<rackId>`, `/odf-device`,
      `/odf-device/sua-luong`, `/odf-device/vi-tri-thiet-bi`, `/dashboard`,
      `/search`, `/devices`, `/import-export`, `/settings`) đều 200; đếm
      `id="port-..."` trên 1 trang rack cụ thể khớp đúng số port thật của
      rack đó (96), xác nhận mọi dòng port đều có anchor.

18. **Danh sách cột liên kết giữa các bảng (tổng hợp cho người dùng rà lại,
    2026-07-28)** — xem bảng đầy đủ trong hội thoại; tóm tắt: FK THẬT (Postgres
    ép buộc, không lệch được) gồm `racks.station_id/parent_rack_id/device_id`,
    `ports.rack_id`, `port_circuit_links.port_id/circuit_id`,
    `circuits.counterpart_port_id/response_plan_port_id/device_id`,
    `transit_links.source_port_id/target_port_id/target_device_id`,
    `devices.station_id`. Liên kết TEXT (khớp lúc chạy qua chuẩn hóa tên/vị
    trí, KHÔNG có ràng buộc DB, dễ lệch âm thầm — đây chính là nguồn gốc của
    cả mục 15/16/17 phía trên) gồm `device_position_map.device_name` ↔
    `devices.name`, `circuits.device_position_own/next` ↔ `racks.code`+
    `ports.port_number` (qua `matchTrunkPosition()`), `transit_links.raw_text`
    (khi `target_type='text_only'`, hiện 100% dòng), `circuits.counterpart_text`/
    `response_plan_text`/`execution_station_text` (tự do, không đối chiếu gì).

19. **Theo dõi mục 17 — người dùng tự test UI thật, phát hiện thêm 3 việc
    (2026-07-28, cùng ngày)**:
    - **(a) Form "Sửa luồng" lúc 1 ô lúc 2 ô cho "Chuyển tiếp" — xác nhận
      KHÔNG phải bug**: `EditRow` trong `PortTable.tsx` chạy
      `splitOdfDeviceStructure()` một lần lúc mở form — khớp "cấu trúc 2" thì
      tách hiện 2 ô riêng (Vị trí ODF / Thiết bị+port), không khớp thì rơi về
      1 ô thô. Test lại bằng dữ liệu thật rack ODF1/1: port 17 (raw_text
      `"ODF 2/11 (15,16) - 48FO#2 ADN1 - VNPT DATA"`) không khớp vì chuỗi
      không kết thúc bằng "(port)" — đây là dạng "đi tiếp ra tuyến cáp/trạm
      khác, không qua thiết bị ADN1" hợp lệ, đúng 1 trong các dòng đã bị mục
      17 phát hiện, không phải lỗi riêng.
    - **(b) Mở rộng `fetchNonConformingTransitLinks()` bắt thêm lỗi định dạng
      BÊN TRONG phần ODF** — lỗ hổng người dùng phát hiện qua dữ liệu thật:
      port 23 rack ODF1/1 có `raw_text = "ODF2/10/33,34 - VNPT.DATA.SW.ZTE01
      (1/1)"` — khớp cấu trúc NGOÀI (có " - " và "(port)" cuối) nên KHÔNG bị
      mục 17 phát hiện, dù phần `"ODF2/10/33,34"` rõ ràng sai chuẩn "ODF x/y
      (a,b)" (thiếu khoảng trắng, dùng thêm dấu "/" thay vì ngoặc). Nguyên
      nhân: `splitOdfDeviceStructure()` chỉ validate cấu trúc 3 phần ngoài,
      không đệ quy kiểm tra định dạng phần ODF tách được. Đã sửa
      `lib/transitLinks.ts`: sau khi tách được `odfPart`, chạy tiếp qua
      `matchTrunkPosition()` + `formatCanonicalOdfPosition()` (đúng cơ chế
      `PortTable.tsx` đã dùng để tự chuẩn hóa lúc rời ô "Vị trí ODF") — nếu
      khớp CHẮC CHẮN 1 rack/port trung kế thật và bản chuẩn hóa khác chữ đang
      lưu thì cũng liệt vào danh sách. Không báo khi không khớp được rack nào
      (tránh đoán/báo nhầm). Hàm đổi chữ ký, nhận thêm `trunkPorts:
      TrunkPortRow[]` (gọi nơi dùng phải tự fetch `fetchAllOdfPorts()` trước).
      **Kết quả**: số dòng "chưa chuẩn form" tăng từ 223 lên **452/503** — phần
      lớn dữ liệu lịch sử hóa ra dùng kiểu cũ "ODF x/y/a,b" (nối thêm dấu "/"
      thay vì ngoặc, không đệm số 0) thay vì chuẩn "ODF x/y (a,b)" đã ban hành
      2026-07-27 — số tăng mạnh vì áp dụng đúng chuẩn đó nghiêm ngặt hơn lên
      dữ liệu vốn phần lớn nhập TRƯỚC khi chuẩn này tồn tại, không phải lỗi
      đếm.
    - **(c) Khung cảnh báo hiện thêm ở trang chi tiết rack**: `TransitFormat
      Warning` giờ cũng render ở `/odf-trunk/[rackId]/page.tsx`, lọc xuống
      đúng rack đang xem (`.filter(item => item.rackId === rack.id)`) — tái
      dùng nguyên `fetchNonConformingTransitLinks()` (không tạo query lọc
      riêng, dữ liệu chỉ ~503 dòng nên lọc ở tầng ứng dụng là đủ). Rack
      `domain='device'` tự động ra mảng rỗng (transit_links chỉ ghi cho rack
      trung kế) — component tự ẩn khi rỗng, không cần nhánh điều kiện riêng.
    - **(d) Sticky header cho `PortTable.tsx`** — trước đó bảng port có 2 hàng
      `<thead>` riêng (tiêu đề+sắp xếp, rồi hàng lọc) — ĐÚNG cấu trúc từng gây
      lỗi chữ đè nhau khi cuộn ở `DeviceCircuitList.tsx` (hàng lọc phải tự
      tính "top" theo chiều cao hàng trên, dễ lệch). Đã gộp lại thành 1 hàng
      duy nhất (component `Th` cục bộ mới trong `PortTable.tsx`, không sửa
      `SortableTh`/`ResizableTh` dùng chung để tránh ảnh hưởng `RackListTable.
      tsx`/nơi khác — theo đúng tinh thần cục bộ mà `DeviceCircuitList.tsx` đã
      chọn, `ColumnResizeHandle` vốn đã ghi chú thiết kế sẵn cho ca này), mỗi
      `<th>` tự `sticky top-0 z-10 bg-primary-50`; bọc bảng trong
      `max-h-[70vh] overflow-auto` (bắt buộc — chỉ `overflow-x-auto` thì
      khung không tự cuộn, sticky vô tác dụng, cùng lý do đã ghi ở
      `DeviceCircuitList.tsx`).
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test bằng Playwright thật (cài tạm
      `npm install --no-save playwright`, gỡ lại sau khi xong — không phải
      dependency thật của dự án): xác nhận điều hướng list→chi tiết rack hoạt
      động, khung cảnh báo chi tiết rack lọc đúng (19 dòng riêng ODF1/1, không
      phải 452 toàn trạm), cuộn khung port 800px thì `<th>` đầu bảng cách mép
      trên khung cuộn đúng 1px (sticky hoạt động đúng), chụp ảnh xác nhận
      không có hiện tượng chữ đè. Dừng lại 2 tiến trình `next dev` (1 cái cũ
      từ trước đó trong phiên đã "chết" — trả 404 dù process còn sống, khả
      năng do đúng lỗi cache `.next`/OneDrive đã biết) sau khi test xong, để
      tránh 2 dev server cùng ghi `.next` một lúc (rủi ro tái diễn lỗi cache).

20. **Gợi ý chuẩn hóa "Vị trí ODF" ngay trong form Sửa** (yêu cầu người dùng
    2026-07-28, tiếp mục 19b: chấp nhận 452 dòng cảnh báo là đúng, nhưng khi
    sửa từng dòng thì muốn có gợi ý bấm-là-xong thay vì gõ tay) —
    `PortTable.tsx` (`EditRow`): khi ô "Vị trí ODF" (2 ô cấu trúc 2) đang gõ
    không khớp đúng chuẩn `formatCanonicalOdfPosition()`, hiện ngay 1 nút nhỏ
    "💡 Gợi ý: ODF x/y (a,b) — bấm để áp dụng" ngay dưới ô, bấm vào là điền
    thẳng giá trị chuẩn (tính bằng `useMemo` trên CHÍNH `matchTrunkPosition`/
    `formatCanonicalOdfPosition` đã dùng ở `onBlur` cũ — chỉ khác là hiện SẴN
    thay vì phải rời khỏi ô mới thấy). Chỉ áp dụng cho trường hợp đã tách được
    2 ô (cấu trúc 2 khớp) — trường hợp 1 ô thô (không tách được) KHÔNG có gợi
    ý vì không đủ căn cứ để biết phần nào là vị trí ODF, tránh đoán khi mơ hồ
    (cùng triết lý mục 17/19b).
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test bằng Playwright thật (cài
      tạm/gỡ lại `npm install --no-save playwright` như mục 19): mở Sửa port
      23 rack ODF1/1 (`raw_text` "ODF2/10/33,34 - ..."), nút gợi ý hiện đúng
      "ODF 2/10 (33,34)", bấm vào thì ô "Vị trí ODF" nhận đúng giá trị đó
      (không lưu xuống DB, chỉ test UI).
    - **Còn thiếu, CHƯA làm (chờ xác nhận trước khi đổi schema)**: nút
      "Acknowledge" (xác nhận đã xem, bỏ qua) cho từng dòng trong khung cảnh
      báo `TransitFormatWarning`, bật/tắt lại được — cần lưu trạng thái này
      xuống DB (không thể chỉ giữ ở state trình duyệt vì phải còn lại sau khi
      tải lại trang/đổi máy) → cần thêm 1 cột mới vào `transit_links`, tức là
      ĐỔI SCHEMA — theo đúng nguyên tắc ở đầu file (không tự ý đổi schema
      không hỏi trước), đã dừng lại hỏi ý kiến người dùng thay vì tự thêm.

21. **Bug: bấm Lưu ở `PortTable.tsx` xong bảng không cập nhật ngay, phải
    Ctrl+Shift+R mới thấy đúng** (người dùng phát hiện 2026-07-28 khi test
    tính năng gợi ý ở mục 20) — nguyên nhân GỐC: `const [ports] = useState
    (initialPorts)` chỉ chụp `initialPorts` MỘT LẦN lúc mount; `router.
    refresh()` (gọi sau mỗi Lưu/Xóa/Chuyển tuyến) theo ĐÚNG thiết kế của
    Next.js App Router sẽ giữ nguyên state cũ của Client Component (không tự
    reset useState) — nên dù server đã có dữ liệu mới, biến `ports` (không hề
    có setter nào dùng tới, chỉ đọc) không bao giờ tự cập nhật, chỉ full page
    reload (F5 cứng, xóa sạch cây React) mới thấy đúng. Đã sửa: bỏ hẳn
    `useState`, dùng thẳng `const ports = initialPorts;` (props mới tới đâu,
    biến này phản ánh đúng tới đó). Đã rà toàn bộ `components/` xác nhận đây
    là chỗ DUY NHẤT trong app có kiểu `useState(initialXxx)` không dùng
    setter — các bảng khác (`DeviceCircuitList.tsx`...) không mắc lỗi này.
    - **Phát hiện thêm khi đo bằng Playwright (KHÔNG phải bug, nhưng là
      nguyên nhân trực tiếp khiến người dùng tưởng phải F5 mới được)**: sau
      khi sửa lỗi trên, dữ liệu vẫn mất **~2.7 giây** mới hiện đúng (đã đo
      bằng `page.waitForFunction`, không phải đoán) — vì `router.refresh()`
      chạy lại TOÀN BỘ Server Component `RackDetailPage`, trong đó
      `fetchAllOdfPorts()` phải phân trang tải lại ~7000+ port CẢ TRẠM (không
      chỉ rack đang xem) qua nhiều lượt gọi Supabase, cộng thêm
      `fetchNonConformingTransitLinks()`/`fetchCircuitOptions()`/
      `fetchDevices()`. Trong lúc chờ, `saveEdit()` đã tắt `busy`/đóng form
      Sửa ngay (không đợi `router.refresh()` xong), nên người dùng thấy dòng
      vừa sửa "trông như cũ" mà không có dấu hiệu gì đang tải — dễ hiểu nhầm
      là lưu thất bại rồi tự bấm F5 cứng (lúc đó save đã xong thật dưới DB từ
      lâu, F5 chỉ tình cờ trùng thời điểm dữ liệu mới đã sẵn sàng). Đã thêm
      chỉ báo "Đang cập nhật..." cho phần này — xem mục 22.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test bằng Playwright thật nhắm
      ĐÚNG 1 dòng port qua `#port-<id>` (tránh nhầm dòng do khung cảnh báo
      phân trang thay đổi nội dung sau mỗi lần lưu — bài học rút ra giữa
      chừng khi 2 lần test đầu dùng chọn theo TEXT bị sai dòng/sai kết luận):
      sửa port 23 rack ODF1/1 (dữ liệu thật, đã trả lại đúng giá trị gốc
      "ODF2/10/33,34 - VNPT.DATA.SW.ZTE01 (1/1)" ngay sau mỗi lần test bằng
      script riêng, không để lại thay đổi thật nào) — xác nhận dữ liệu mới
      hiện đúng sau ~2.7s, KHÔNG cần reload trang.

22. **Chỉ báo "Đang cập nhật..." trong lúc chờ `router.refresh()`** (yêu cầu
    người dùng 2026-07-28, tiếp mục 21) — `PortTable.tsx`:
    - Đổi tên state `busy` → `saving` (chỉ phủ đúng lúc đang ghi Supabase),
      thêm `useTransition()` lấy `isRefreshing` (đúng API React để biết
      `router.refresh()` đã áp dụng xong dữ liệu mới hay chưa — bọc lệnh gọi
      trong `startTransition()`). `busy` (tên biến giữ nguyên, mọi
      `disabled={busy}` ở nơi khác trong file không cần sửa) giờ suy ra từ
      `saving || isRefreshing`.
    - Thêm hàm `refreshAndThen(afterRefresh?)` DÙNG THAY cho việc gọi thẳng
      `router.refresh()` ở cả 3 chỗ (`saveEdit()` 2 nhánh, `deleteGroup()`,
      `confirmMove()`): giữ `pendingAfterRefreshRef`, chỉ chạy `afterRefresh`
      (vd `() => setEdit(null)`) SAU KHI `isRefreshing` chuyển về `false` (1
      `useEffect` theo dõi) — thay vì đóng form NGAY rồi hiện dữ liệu cũ suốt
      quãng chờ như trước (mục 21). `deleteGroup()` không có form gì để đóng
      nên gọi `refreshAndThen()` không tham số — vẫn được lợi giữ `busy=true`
      (khóa mọi nút Sửa/Xóa/Copy/Chuyển tuyến TOÀN BẢNG) suốt quãng chờ, tránh
      thao tác chồng chéo trong lúc dữ liệu `ports` sắp đổi.
    - Nút "Lưu" (`EditRow`) và "Xác nhận chuyển" (`MoveRow`) đổi nhãn thành
      "Đang cập nhật..." khi `busy` — dùng chung 1 chữ cho cả 2 giai đoạn (ghi
      DB + chờ refresh), không tách "Đang lưu.../Đang cập nhật..." riêng cho
      đơn giản, đúng yêu cầu.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test Playwright thật (sửa+trả lại
      gốc port 23 ODF1/1 như mục 21): bấm Lưu thấy ngay nút đổi "Đang cập
      nhật..." + bị khóa, nút "Sửa" ở DÒNG KHÁC cũng bị khóa theo, form tự
      đóng và hiện đúng dữ liệu mới khi refresh xong (không cần F5).

23. **Bug: bấm vào 1 dòng trong khung cảnh báo "Chuyển tiếp chưa chuẩn form"
    nhảy tới port bị SAI — dòng đầu tiên thấy được lại là port kế tiếp, không
    phải port vừa bấm** (người dùng phát hiện 2026-07-28, vd bấm "ODF1/1 port
    7" nhưng dòng đầu hiện ra lại là port 9) — người dùng ghi nhận đã gặp
    đúng loại lỗi này 1 lần trước đây bên `DeviceCircuitList.tsx`.
    - **Nguyên nhân**: `scrollIntoView({ block: "center" })` (dùng để nhảy
      tới port qua hash `#port-<id>`, thêm ở mục 17) không biết gì về tiêu đề
      cột STICKY mới thêm ở mục 19d — với port nằm gần đầu danh sách (không
      đủ dòng phía trên để thật sự "căn giữa"), trình duyệt buộc phải cuộn
      gần sát đỉnh khung, nhưng tiêu đề sticky lại NẰM ĐÈ LÊN (z-10, nền đặc)
      che mất đúng dòng vừa cuộn tới — dòng ĐẦU TIÊN nhìn thấy được (không bị
      che) trở thành dòng kế tiếp. `DeviceCircuitList.tsx` có cùng tổ hợp
      (tiêu đề sticky + `scrollIntoView` nhảy dòng qua `rowAnchor()`) nên
      cũng mắc lỗi này, dù trước đó có thể chỉ được để ý/né tránh chứ chưa
      thật sự sửa tận gốc.
    - **Cách sửa (áp dụng ĐÚNG 1 cách cho cả 2 file, để không tái diễn lần
      3)**: thêm CSS `scroll-margin-top` (Tailwind `scroll-mt-24`, ước lượng
      dư so với chiều cao tiêu đề sticky đo được ~86px) vào chính `<tr>` là
      đích nhảy tới (`PortTable.tsx` dòng port, `DeviceCircuitList.tsx` dòng
      circuit qua `rowAnchor()`). Đây là thuộc tính CSS chuẩn, được MỌI thao
      tác cuộn-tới-phần-tử (kể cả cuộn gốc của trình duyệt, không chỉ lệnh
      JS `scrollIntoView()` tự viết) tôn trọng — chắc chắn hơn tự tính offset
      bằng JS, và tự động đúng dù sau này đổi chiều cao tiêu đề.
    - **Quy tắc chung rút ra (ghi lại để không vấp lần nữa)**: **bất kỳ bảng
      nào có tiêu đề cột `sticky` + tính năng nhảy-tới-dòng qua hash/anchor
      đều PHẢI đặt `scroll-margin-top` (khớp chiều cao tiêu đề) lên chính
      dòng đích** — thiếu bước này thì mọi dòng gần đầu danh sách đều có
      nguy cơ bị tiêu đề che sau khi nhảy tới.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test Playwright thật với port 7
      rack ODF1/1 (đúng port người dùng báo) ở nhiều kích thước cửa sổ khác
      nhau (1400×900 tới 1280×400) — đo trực tiếp toạ độ dòng port 7 so với
      mép dưới tiêu đề sticky sau khi nhảy hash, xác nhận không còn bị che ở
      kích thước nào. Không tái hiện được chính xác trạng thái LỖI trong môi
      trường test tự động (nghi do khác biệt cách trình duyệt/Next.js xử lý
      cuộn theo hash so với gọi `scrollIntoView()` trực tiếp bằng script) —
      nhưng `scroll-margin-top` là thuộc tính chuẩn bảo vệ được ở TẤT CẢ cơ
      chế cuộn-tới-phần-tử, không riêng cơ chế đã tự viết, nên vẫn áp dụng.

24. **Đợt yêu cầu lớn 2026-07-28 (sau khi mục 23 xong)** — 4 nhóm việc: (a)
    luồng mới thêm lên đầu bảng + tô màu, (b) bố cục lại Sidebar (ghim/bỏ
    ghim + đổi tên mục), (c) 2 bug nhỏ ở "Hồ sơ đấu nối", (d) tu sửa lớn "Hồ
    sơ ODF Thiết bị" (số liệu Đang dùng sai + chưa có thêm/xóa Rack + bảng
    port chưa đúng ý).

    **(a) Luồng mới thêm hiện lên ĐẦU bảng + tô màu highlight lần đầu**
    (`DeviceCircuitList.tsx`, "Hồ sơ đấu nối") — trước đây luồng mới thêm rơi
    vào đúng vị trí theo sắp xếp/lọc hiện tại (thường ở cuối hoặc lẫn giữa
    bảng), khó kiểm tra ngay. `submitCreate()` giờ `.select("id").single()`
    lấy lại id vừa tạo, tái dùng NGUYÊN `highlightId` (cơ chế tô `bg-amber-100`
    + tự tắt sau 5s đã có sẵn cho việc nhảy tới từ link `#dc-<id>`) — thêm 1
    `justCreatedIdRef` để phân biệt 2 nguồn gốc của `highlightId` (vừa thêm
    mới -> đẩy lên đầu bảng bất kể sort/filter; nhảy từ link ngoài -> chỉ tô
    sáng, giữ nguyên vị trí theo sắp xếp). Chỉ áp dụng cho `DeviceCircuitList`
    — `PortTable.tsx` (trung kế) không có form "thêm luồng rời" tương tự (chỉ
    gán tên vào port đã có sẵn), không cần sửa.

    **(b) Sidebar: ghim/bỏ ghim + sửa bug cuộn theo trang + đổi tên mục +
    cỡ chữ tiêu đề nhóm** (`components/Sidebar.tsx`, viết lại toàn bộ) —
    - **Bug cuộn theo trang** (có thật, không cần yêu cầu thêm để xác nhận):
      `<aside>` trước chỉ có `min-h-screen`, không `sticky`/`fixed` — trang
      không có khung cuộn riêng cho `<main>` (`app/layout.tsx` chỉ 1
      `<div className="flex min-h-screen">` cuộn chung qua `<body>`), nên
      sidebar trôi lên theo khi cuộn sâu. Sửa: `sticky top-0 h-screen` khi
      đang ghim — vẫn là flex item chiếm chỗ bình thường (không cần `<main>`
      tự bù lề), chỉ khác là "dính" lại trong khung nhìn khi cuộn.
    - **Ghim/bỏ ghim** (yêu cầu người dùng: tăng bề rộng khung nhìn khi cần).
      Nút "Ghim"/"Bỏ ghim" ở góc phải khung tiêu đề (chữ thường, KHÔNG dùng
      icon/emoji — theo quy tắc chung của dự án). Khi bỏ ghim: `<aside>`
      chuyển `fixed left-0 top-0` + `-translate-x-full` (ẩn hẳn, không chiếm
      chỗ layout — `<main flex-1>` tự giãn full-width), cộng 1 dải mỏng
      `fixed w-3` luôn có ở mép trái làm vùng hover để hiện lại (overlay đè
      lên, `transition-transform duration-200`), `onMouseLeave` trên chính
      `<aside>` để tự ẩn khi rê chuột ra khỏi. Trạng thái ghim lưu
      `localStorage["sidebar-pinned"]`, đọc lại ở `useEffect` (mặc định
      `pinned=true` lúc server-render vì `window` chưa có — có thể nháy 1
      khung hình nếu trước đó đã bỏ ghim, chấp nhận được).
    - **Đổi tên mục + cỡ chữ** (yêu cầu người dùng): "Dashboard ADN1" ->
      "Dashboard"; "Sửa luồng thiết bị" -> "Hồ sơ đấu nối" (đổi luôn `<h1>` ở
      `app/odf-device/sua-luong/page.tsx` cho khớp, KHÔNG đổi URL). Tiêu đề
      nhóm (THỐNG KÊ/HỒ SƠ/CÀI ĐẶT) `text-xs` -> `text-sm` để dễ phân biệt
      với danh sách mục bên dưới.

    **(c) 2 bug ở "Hồ sơ đấu nối" (`DeviceCircuitList.tsx`)**
    - **Bug: bấm quanh khung "Thêm luồng mới" bị tick nhầm ô "Thiết bị"/"Đối
      phương"** — nguyên nhân: khối bọc quanh 2 ô này là `<label>` bọc CẢ
      checkbox lẫn control lớn bên dưới (SearchableSelect/textarea) — HTML
      quy định bấm BẤT KỲ đâu trong `<label>` có bọc 1 checkbox (kể cả không
      trúng chính checkbox) đều toggle checkbox đó. Sửa: đổi `<label>` thành
      `<div>` (không có hành vi ngầm này) cho CẢ 2 khối "Thiết bị" và "Đối
      phương" — người dùng chỉ báo "Đối phương" nhưng "Thiết bị" bị lỗi y hệt
      (đã tự phát hiện khi đọc code, sửa luôn cho nhất quán). "Thiết bị (tiếp
      theo)" vốn đã dùng `<div>` từ đầu nên không bị lỗi này.
    - **Bug: "chưa bấm Sửa thì không thấy tên ODF Trung kế"** — cột "Vị trí
      ODF (tiếp theo)" trong bảng danh sách trước chỉ hiện đúng chữ đã lưu
      (`c.devicePositionNext`); với dữ liệu CŨ (trước form 3 ô 2026-07-27,
      chỉ lưu tọa độ ODF trơn, chưa có tên tuyến cáp gộp sẵn) thì tên tuyến
      cáp trung kế chỉ được TÍNH SỐNG (qua `matchTrunkPosition()`) và hiện ra
      bên trong form Sửa, không hiện ở bảng danh sách. Thêm hàm
      `positionNextDisplay()` (đối chiếu sống, CHỈ áp dụng khi
      `splitOdfDeviceStructure()` chưa khớp cấu trúc sẵn có — dòng đã lưu qua
      form mới thì giữ nguyên, không tính lại) + 1 map `positionNextDisplayById`
      tính 1 lần cho toàn bộ danh sách (tránh gọi `matchTrunkPosition()` lặp
      lại mỗi lần render dòng).

    **(d) "Hồ sơ ODF Thiết bị" — sửa số liệu sai + thêm/xóa Rack + đổi bảng
    port**
    - **Số liệu "Đang dùng" sai (luôn "0/48")** — nguyên nhân: `RackListTable`
      tính từ `ports.status`, nhưng luồng thiết bị (`device_position_own/next`
      dạng text tự do) KHÔNG BAO GIỜ cập nhật cột này (chỉ luồng trung kế thật
      qua `port_circuit_links` mới cập nhật `ports.status`, xem
      `lib/portStatus.ts` — cột này vốn được tài liệu hóa là "không đáng tin,
      suy đoán lúc import"). Sửa: `lib/deviceRackPorts.ts` thêm
      `fetchDeviceRackPortStatusCounts()` — quét TOÀN BỘ circuits 1 lần (dùng
      chung với `fetchDeviceRackPortRefs()` qua 1 hàm nền
      `fetchAllDeviceRackPortRefs()` mới), với MỖI port của MỌI rack thiết bị:
      không ai tham chiếu -> Trống; có luồng tham chiếu (own/next) mà TÊN khớp
      `isStandbyCircuitName()` ("DP..."/"dự phòng") -> Dự phòng; có luồng tham
      chiếu (tên khác) -> Đang dùng — đúng nguyên tắc `derivePortStatus()` đã
      dùng cho Search/Dashboard bên trung kế, áp lại cho thiết bị qua cơ chế
      đối chiếu text.
      **Nhân tiện đồng bộ luôn bên trung kế** (`app/odf-trunk/page.tsx`): trước
      cũng dùng `ports.status` (ít sai hơn vì CÓ được cập nhật qua Sửa/Xóa/
      Chuyển tuyến ở `PortTable.tsx`, nhưng vẫn không phải nguồn chuẩn theo
      đúng comment `lib/portStatus.ts`) — đổi sang join
      `port_circuit_links(circuits(name))` + `derivePortStatus()`, cùng 1
      nguồn chuẩn duy nhất cho cả 2 domain. `RackListTable` (dùng chung 2
      trang) đổi cột "Đang dùng" (1 cột "X/Y") thành 3 cột riêng: Đang dùng /
      Dự phòng / Trống (Trống tính tại chỗ = portCount - inUse - standby,
      không lưu field riêng).
    - **Format mã rack có khoảng trắng** ("ODF1/15" -> "ODF 1/15") —
      `lib/rackCode.ts` thêm `formatRackCodeDisplay()` (cùng quy tắc regex đã
      dùng ở `formatCanonicalOdfPosition()`), áp dụng CHỈ lúc hiển thị ở
      `RackListTable.tsx` + `RackHeader.tsx` — **KHÔNG sửa `racks.code` gốc
      trong DB** (giữ đúng quyết định đã ghi ở mục 7: toàn bộ rack thật trong
      DB không có khoảng cách).
    - **Thêm rack mới** (`components/odf-device/AddDeviceRackForm.tsx`, mới)
      — form nhỏ ở đầu trang `/odf-device`, LUÔN `domain='device'` (không
      dùng chung cho trung kế — thêm rack trung kế rủi ro hơn nhiều, đụng dữ
      liệu Excel gốc thật, ngoài phạm vi yêu cầu lần này, xem bài học domain ở
      mục 12). Nhập mã rack + loại ODF + số port ban đầu -> tạo `racks` +
      đúng N dòng `ports` (`fiber_number=null`, `status='unused'`, đúng quy
      ước 112 rack nội bộ ở mục 8) -> chuyển thẳng sang trang chi tiết rack
      vừa tạo.
      **Sửa số port sau khi tạo**: KHÔNG cần thêm gì — `RackAdminPanel.tsx`
      (đã có sẵn từ trước, KHÔNG phân biệt domain) đã cho tăng số port ngay ở
      trang chi tiết, và `/odf-device` đọc `port_count` mới nhất mỗi lần vào
      trang (route `force-dynamic`) nên tự đồng bộ, không cần code thêm.
    - **Xóa rack** (`components/odf-device/DeleteRackButton.tsx`, mới) — CHỈ
      hiện khi `rack.domain==='device'` (ở `app/odf-trunk/[rackId]/page.tsx`).
      **Đã kiểm chứng thật trên DB trước khi làm** (script tạm, xóa sau khi
      chạy): `port_circuit_links` và `transit_links` (qua `source_port_id`)
      đều **0 dòng** trỏ tới port của rack `domain='device'` (toàn bộ 507
      dòng `transit_links` đều trỏ rack `domain='trunk'`) — xác nhận xóa
      `ports` rồi `racks` là đủ, không cần dọn bảng nào khác. *Lưu ý kỹ thuật
      trong lúc khảo sát*: filter lồng nhiều cấp qua embed
      (`.eq("source_port.racks.domain", ...)`) bị PostgREST **âm thầm bỏ qua**
      nếu không ép `!inner` trên embed đó — 2 giá trị đối lập (`device`/
      `trunk`) trả về CÙNG 1 số bằng tổng không lọc, phải đối chiếu chéo mới
      phát hiện ra; thêm `!inner` vào embed thì filter mới áp dụng thật. Ghi
      lại làm bài học chung cho các script Supabase sau này.
    - **Bảng port trong trang chi tiết đổi từ "Port / Thiết bị này (own) / Đầu
      xa (next)" sang "Port / Tên luồng / Ghi chú"** (`DeviceRackPortView.tsx`
      viết lại, `lib/deviceRackPorts.ts` thêm field `portNumbers` vào
      `DeviceRackCircuitRef`) — gộp own+next thành 1 danh sách "luồng đang
      chiếm port này" (người dùng chỉ cần biết CÓ luồng gì, không cần phân
      biệt own/next); Ghi chú hiện "Luồng sử dụng sợi a,b" (từ chính
      `portNumbers` của luồng đó). **Gộp 2 port liền kề thành 1 dòng** khi
      CHÍNH XÁC cùng 1 tập luồng chiếm cả 2 (so theo id, không rỗng) — cùng
      tinh thần rowspan bên `PortTable.tsx` trung kế; không liền kề hoặc tập
      luồng khác nhau (vd 1 luồng khác cũng chen vào 1 trong 2 port) thì LUÔN
      tách dòng riêng, đúng nguyên tắc CLAUDE.md #2 (không giấu bớt thông
      tin dù trông có vẻ giống nhau).

    **Kiểm chứng**: `tsc --noEmit` sạch sau mỗi nhóm việc. Test Playwright
    thật (cài tạm, gỡ sau khi xong) cho toàn bộ các mục trên: sidebar ghim/bỏ
    ghim/hover-hiện lại/lưu trạng thái (xác nhận đúng cả 5 bước, kể cả sau
    reload); 2 bug checkbox (xác nhận tick KHÔNG còn bị đổi khi bấm quanh
    label); luồng mới thêm lên đầu bảng + `bg-amber-100`; cột "Vị trí ODF
    (tiếp theo)" hiện tên tuyến cáp trong danh sách; mã rack hiện có khoảng
    trắng + 3 cột Đang dùng/Dự phòng/Trống ra số thật (vd "ODF 3/13":
    48 port, 28 đang dùng, 0 dự phòng, 20 trống — không còn "0/48"); thêm rack
    test 4 port -> vào chi tiết thấy đúng bảng Port/Tên luồng/Ghi chú toàn
    "trống" -> xóa rack test thành công, biến mất khỏi danh sách.

    **Sự cố xảy ra khi test (đã xử lý, ghi lại minh bạch)**: script Playwright
    test tính năng "xóa luồng test vừa thêm" đọc số dòng bảng NGAY sau khi
    bấm "Thêm luồng" (chưa kịp đợi `router.refresh()` + chuỗi `await` tuần tự
    trong `submitCreate()` — gồm cả 1 hộp thoại `confirm()` xác nhận tạo
    thiết bị mới — chạy xong), tưởng lầm là luồng chưa được thêm, rồi bấm
    "Xóa" ở dòng ĐẦU BẢNG lúc đó — nhưng đây là 1 luồng CÓ THẬT (thiết bị
    "ADN1.ODF Y-Cable", Trib "2", Vị trí ODF "ODF 3/13 (41,42)"), không phải
    dòng test — và hộp thoại `confirm()` xác nhận xóa bị script auto-accept
    (chưa kiểm tra nội dung message trước khi bấm OK ở thời điểm đó). Phát
    hiện ngay sau đó qua đối chiếu nội dung hộp thoại xóa không khớp dữ liệu
    test đã nhập. **Đã khôi phục**: dựng lại đúng cấu trúc dựa theo 2 luồng
    "anh em" còn nguyên của CÙNG thiết bị (Trib 4 và 17, cùng mẫu tên
    `"(chưa đặt tên) ODF Y-Cable - <trib>"`) — khôi phục đủ
    name/trib_text/device_position_own/device_id/notes ("Thiết bị: ODF
    Y-Cable"), đã xác nhận độc lập qua truy vấn lại từ tiến trình mới. **1
    chi tiết KHÔNG khôi phục được**: dòng "ID gốc: &lt;số&gt;" trong `notes`
    (số thứ tự từ file Excel gốc lúc import — không suy ra được từ dữ liệu
    còn lại trong DB; 2 luồng anh em có "ID gốc: 7024" và "7037", không theo
    quy luật đoán được số của dòng đã mất) — người dùng có thể tự tra lại
    trong file Excel gốc (`data/`) nếu cần đúng số này. **Rút kinh nghiệm**:
    từ nay mọi test Playwright có thao tác xóa/hủy đều phải (1) kiểm tra
    đúng nội dung hộp thoại `confirm()` khớp dữ liệu test trước khi accept
    (không auto-accept mù), và (2) chờ/poll trạng thái thật (vd số dòng bảng
    đổi) thay vì `sleep` cố định trước khi đọc kết quả một thao tác có chuỗi
    `await` không cố định thời gian.

25. **Gợi ý chuẩn hóa "Chuyển tiếp" chưa áp dụng cho trường hợp "1 tọa độ ODF
    trơn, không qua thiết bị"** (người dùng phát hiện 2026-07-29, so sánh rack
    ODF1/1: port 5,6/9,10 có gợi ý vì "Chuyển tiếp" dạng
    `"ODF x/y (a,b) - <thiết bị>(<port>)"` — tách được cấu trúc 2 — nhưng port
    17,18 là `"ODF 2/11 (15,16)"` (trỏ THẲNG sang 1 rack trung kế khác, không
    qua thiết bị nào, nên KHÔNG có " - <thiết bị>(<port>)" để tách) lại không
    có gợi ý gì, dù vẫn là 1 tọa độ ODF thật đối chiếu/chuẩn hóa được).
    - **Sửa**: `PortTable.tsx` (`EditRow`) thêm `bareOdfSuggestion` — khi
      `transitSplit=false` (chưa tách được cấu trúc 2), thử chuẩn hóa trên
      TOÀN BỘ `edit.transitText` (thay vì bỏ qua hoàn toàn) qua
      `matchTrunkPosition()` + `formatCanonicalOdfPosition()`, cùng kiểu nút
      💡 và `onBlur` tự chuẩn hóa như nhánh cấu trúc 2 đã có.
    - **Phát hiện an toàn dữ liệu QUAN TRỌNG khi rà thật trước khi chốt cách
      làm** (script tạm, xóa sau khi chạy — KHÔNG lưu gì lên UI, chỉ đọc): với
      chuỗi có phần ĐUÔI free text sau tọa độ ODF mà không đúng cấu trúc 2
      (vd `"ODF2/12/17,18 - IDC Tầng 3 ADN1"`, `"ODF1/6/(5,6) - 48FO
      ADN1-HUE"`), `matchTrunkPosition()` vô tình "nuốt" các CHỮ SỐ nằm trong
      phần đuôi đó (vd "3" trong "Tầng 3", "48"/"01" trong "48FO...") vào
      danh sách port, sinh gợi ý SAI kiểu `"ODF 2/12 (17,18,03,01)"` — nếu áp
      dụng sẽ XÓA MẤT phần mô tả đuôi thật (tên thiết bị/tuyến cáp) mà không
      hề báo gì. **Chặn bằng 1 điều kiện**: chỉ gợi ý khi
      `trunkMatch.resolvedPorts` có ĐÚNG 1 hoặc 2 port (đúng nguyên tắc "1 sợi
      hoặc 1 cặp Tx/Rx", CLAUDE.md #1) — quá 2 port gần như chắc chắn đã nuốt
      nhầm số từ phần đuôi, không gợi ý. Quét thật toàn bộ transit_links xác
      nhận điều kiện này lọc đúng: **98 dòng được gợi ý hợp lệ** (toàn bộ đều
      là lỗi thiếu khoảng trắng/dùng dấu `/` thay `(...)`, vd `"ODF1/6
      (15,16)"` -> `"ODF 1/6 (15,16)"`, `"ODF2/3/35,36"` -> `"ODF 2/3
      (35,36)"`), **21 dòng bị chặn đúng** (toàn bộ đều thuộc dạng đuôi free
      text nguy hiểm nêu trên).
    - **Kiểm chứng**: `tsc --noEmit` sạch. Test Playwright CHỈ MỞ SỬA để quan
      sát (không bấm Lưu/Xóa gì) trên rack ODF1/1 thật: port 25
      (`"ODF1/6 (15,16)"`) hiện đúng nút "💡 Gợi ý: ODF 1/6 (15,16) — bấm để
      áp dụng"; port 17,18 (`"ODF 2/11 (15,16)"`, đã đúng chuẩn sẵn) không
      hiện gợi ý nào (đúng — không có gì để sửa).
    - **Theo dõi ngay sau đó (cùng ngày, người dùng bổ sung)**: "Chuyển tiếp"
      trỏ thẳng sang 1 rack trung kế khác (không qua thiết bị) về bản chất
      vẫn nên có "2 ô" như cấu trúc 2 — Ô1 = tọa độ ODF (đã làm ở trên), Ô2 =
      **tên ODF Trung kế đích** (thay vì tên thiết bị+port như cấu trúc 2) —
      đúng tinh thần Ô2 "Cáp quang (tiếp theo)" đã có ở
      `DeviceCircuitList.tsx` (isCableMode). Thêm:
      - `bareMatch` (đổi tên từ phép tính trong `bareOdfSuggestion`, dùng
        chung cho cả gợi ý chuẩn hóa lẫn nhận diện liên kết trung kế — vẫn
        qua đúng an toàn "<=2 port" ở trên) → nếu `rackDomain==='trunk'`, hiện
        thêm 1 ô CHỈ ĐỌC (nền xám) ngay dưới ô ODF, giá trị là
        `racks.cable_route_name` của rack đích (vd rack "ODF2/11" ->
        `"48FO#2 ADN1 - T2-T3"`) — KHÔNG lưu riêng, chỉ đọc để biết đang trỏ
        tới tuyến nào, `transitText` lưu DB vẫn chỉ là đúng tọa độ ODF (không
        ghép thêm gì, khác cấu trúc 2 vốn ghép cả 2 phần vào 1 chuỗi lưu).
      - **Sửa luôn 1 lỗ hổng phát hiện khi làm phần này**: `onBlur` của ô bare
        ODF (thêm lúc trước) tự tính lại `matchTrunkPosition` KHÔNG qua an
        toàn "<=2 port" — nghĩa là rời khỏi ô (kể cả không bấm nút gợi ý) vẫn
        có thể tự áp gợi ý SAI (ca nuốt nhầm số) mà không cảnh báo gì, còn
        nguy hiểm hơn nút gợi ý (phải bấm mới áp). Đổi `onBlur` dùng LẠI
        `bareOdfSuggestion` (đã qua an toàn) thay vì tự tính riêng.
      - **`PortTable.tsx` bảng danh sách (không chỉ form Sửa)**: thêm
        `transitDisplay()` + map `transitDisplayByPortId` (tính 1 lần, cùng
        cách `positionNextDisplayById` bên `DeviceCircuitList.tsx`) — cột
        "Chuyển tiếp" giờ hiện `"<tọa độ ODF> - <tên tuyến cáp>"` ngay trong
        bảng cho ca bare-trunk-link, không cần bấm Sửa mới thấy (cùng lý do
        đã sửa cho "Vị trí ODF (tiếp theo)" bên thiết bị).
      - **Kiểm chứng**: `tsc --noEmit` sạch. Playwright CHỈ ĐỌC (không Lưu/
        Xóa): bảng danh sách port 17,18 hiện đúng `"ODF 2/11 (15,16) - 48FO#2
        ADN1 - T2-T3"`; form Sửa hiện đúng nhãn "Tên ODF trung kế" + ô chỉ đọc
        `"48FO#2 ADN1 - T2-T3"` khớp 100% dữ liệu thật trong `racks`.

26. **Dạy khung `TransitFormatWarning` nhận 2 form hợp lệ + nút "Ack" + đổi
    mặc định phân trang 10→5** (yêu cầu người dùng 2026-07-29, tiếp mục 25) —
    trước đây `fetchNonConformingTransitLinks()` chỉ công nhận "form 1"
    (`splitOdfDeviceStructure`: `"ODF x/y (a,b) - ADN1.thiết bị (port)"`),
    nên mọi dòng "form 2" (tọa độ ODF trỏ thẳng sang rack trung kế khác,
    không qua thiết bị — vd port 17,18 rack ODF1/1 mục 25) đều bị liệt vào
    danh sách cảnh báo dù hoàn toàn hợp lệ (báo nhầm/false positive).
    - **`matchBareTrunkLink()` (mới, `lib/trunkPorts.ts`)** — tách rào an
      toàn "resolvedPorts đúng 1-2, không có port sai" (trước đó lặp lại y
      hệt ở `bareMatch` trong `PortTable.tsx`) thành 1 hàm dùng CHUNG, để
      `lib/transitLinks.ts` (không phải React, không dùng `useMemo` được)
      cũng áp dụng đúng rào này mà không copy logic lần 2 (tránh 2 nơi tự
      lệch nhau về sau). `PortTable.tsx` (`transitDisplay()` cấp bảng và
      `bareMatch` trong `EditRow`) đổi sang gọi hàm này, hành vi giữ nguyên
      100% (chỉ refactor, không đổi kết quả).
    - **`lib/transitLinks.ts`**: khi `splitOdfDeviceStructure()` không khớp
      (form 1), thử tiếp `matchBareTrunkLink()` — khớp VÀ `rackDomain==='trunk'`
      thì coi là form 2 hợp lệ, **không** liệt vào cảnh báo nữa. Domain
      `'device'` (bare match trỏ sang rack ODF/DDF nội bộ, không có tên
      thiết bị kèm theo) KHÔNG được tính là form hợp lệ nào cả — người dùng
      chỉ xác nhận đúng 2 form ở trên, giữ nguyên báo cho trường hợp còn mơ
      hồ này (đúng triết lý "không tự đoán thêm" của toàn khung này).
    - **Nút "Ack" (Acknowledge — xác nhận đã xem, bỏ qua)** — mục 20 trước đó
      đã dừng lại hỏi ý kiến vì cần đổi schema; **yêu cầu 2026-07-29 này chính
      là xác nhận đó**. Thêm cột `transit_links.format_ack boolean not null
      default false` (migration
      `supabase/migrations/20260729000001_transit_links_format_ack.sql`).
      `fetchNonConformingTransitLinks()` lọc `format_ack=true` ra khỏi kết
      quả ngay từ đầu vòng lặp. `TransitFormatWarning.tsx` thêm nút "Ack" mỗi
      dòng (`btn-secondary` nhỏ, disable + "Đang Ack..." lúc chờ, lỗi hiện
      chữ đỏ nhỏ dùng đúng pattern `error`/`busy` đã có ở `DeleteRackButton.
      tsx` — không dùng `alert()`) — bấm thì `update({format_ack:true})` rồi
      `router.refresh()` để Server Component tải lại danh sách mới (đúng
      pattern `router.refresh()` toàn bộ `PortTable.tsx` đã dùng). **Chưa có
      nút "un-Ack"** (bật lại hiển thị 1 dòng đã Ack) — không nằm trong yêu
      cầu lần này, để dành nếu cần sau.
    - **Mặc định "Số dòng/trang" đổi 10 → 5** (yêu cầu người dùng) — thêm `5`
      vào mảng lựa chọn (`[5, 10, 20, 50, 100]`, trước đó thiếu `5`).
    - **Sửa lại chữ mô tả khung cảnh báo** — tiêu đề bỏ bớt tên "form 1" cụ
      thể (giờ có 2 form), đoạn mô tả liệt kê rõ cả 2 form + hướng dẫn dùng
      nút Ack.
    - **QUAN TRỌNG — cần người dùng tự chạy migration**: môi trường này không
      có cách nào tự động áp DDL lên Supabase thật (không có Postgres
      connection string trong `.env.local`, không cài `pg`, không có
      Supabase CLI/Management API) — mọi migration trong dự án từ trước tới
      giờ đều phải chạy TAY qua Supabase Dashboard → SQL Editor. Đã báo rõ
      cho người dùng: trước khi chạy migration này, trang `/odf-trunk` sẽ
      lỗi 500 (`column transit_links.format_ack does not exist`, đã thấy
      thật trong log dev server) — đúng dự kiến, không phải bug code, hết
      ngay sau khi chạy xong SQL.
    - **Kiểm chứng (đầy đủ, sau khi người dùng chạy migration 2026-07-29)**:
      `tsc --noEmit` sạch. Playwright + supabase-js (cài/gỡ tạm như các lần
      trước) trên dữ liệu THẬT xác nhận toàn bộ:
      - Số dòng cảnh báo giảm từ 452 (mục 19b) xuống còn **359** — tức 93
        dòng "form 2" (bare-trunk-link) trước đây bị báo nhầm, giờ đã đúng.
      - Search "2/11 (15,16)" (rack ODF1/1 port 17,18, ví dụ gốc mục 25) →
        0 kết quả, xác nhận không còn bị liệt kê.
      - Dropdown "Số dòng/trang" mặc định đúng giá trị `5`.
      - Ack thật 1 dòng ("ODF1/1 port 7") → dòng biến mất ngay (359→358),
        F5 (reload cứng) vẫn không hiện lại → xác nhận Ack lưu THẬT trong DB
        (`format_ack`), không phải state trình duyệt.
      - Sau khi xác nhận xong, tự revert `format_ack` về `false` cho đúng
        dòng vừa test (qua `source_port_id` lấy từ href của dòng đó) — không
        để lại tác dụng phụ, vì người dùng chưa thật sự chọn Ack dòng dữ liệu
        này, chỉ là dòng dùng để kiểm thử.

27. **Tách ô "Thiết bị (port)" (cấu trúc 2) thành 2 ô riêng + gợi ý theo hồ sơ
    thiết bị thật** (yêu cầu người dùng 2026-07-29) — trước đây `PortTable.tsx`
    (`EditRow`) đã tách "Chuyển tiếp" cấu trúc 2 thành 2 ô (Vị trí ODF / Thiết
    bị+port GHÉP CHUNG 1 ô, vd "ADN1.OMEMSPP#01 (1/23/10)"). Giờ tách tiếp ô
    thứ 2 thành **Thiết bị** riêng và **Port** riêng — `splitOdfDeviceStructure()`
    (`lib/parsers/transit-text.ts`) vốn đã trả về `deviceName`/`port` tách sẵn
    2 field, chỉ là UI trước đây tự ghép lại thành 1 ô, nên phần lõi parser
    KHÔNG cần đổi gì.
    - **Ô "Thiết bị"**: `<datalist>` gợi ý toàn bộ tên trong `devices` (prop
      mới truyền vào `EditRow`), so khớp qua `normalizeDeviceNameKey()` (tự bỏ
      dấu/tiền tố "ADN1."/khoảng trắng thừa) — khớp được 1 thiết bị thật mà
      chữ gõ khác tên chuẩn đang lưu (hoa/thường, có/không tiền tố) thì hiện
      nút "💡 Gợi ý" + tự áp khi rời ô (onBlur), Y HỆT UX ô Vị trí ODF (yêu
      cầu người dùng: "đưa ra gợi ý như phần ODF trên"). Không khớp được thiết
      bị nào NHƯNG có tiền tố trạm ADN1 (`isManagedStationCode`) → hiện chữ
      "Chưa có trong hồ sơ thiết bị — sẽ hỏi tạo mới khi bấm Lưu." (đúng cơ chế
      `maybeStandardizeTransitDevice()` ĐÃ CÓ SẴN từ trước — hàm này vẫn y
      nguyên, chỉ là giờ người dùng THẤY TRƯỚC kết quả sẽ xảy ra thay vì chỉ
      biết qua `confirm()` sau khi bấm Lưu). Thiết bị thuộc trạm khác (không
      phải ADN1) → không hiện gì (đúng nguyên tắc CLAUDE.md #6, không tự tạo/
      không giả định gì về trạm ngoài phạm vi quản lý).
    - **Ô "Port"**: `distinctPositionsForDevice()` (mới, `lib/devicePositionMap.ts`)
      lọc `device_position_map` (đã tải sẵn 1 lần qua prop `devicePositionMap`,
      không query lại mỗi lần gõ) lấy toàn bộ `device_position` từng ghi nhận
      cho ĐÚNG thiết bị đang gõ ở ô Thiết bị — hiện làm `<datalist>` + 1 dòng
      chữ nhỏ liệt kê tối đa 6 mẫu ("Mẫu port đã dùng cho thiết bị này: ...").
      **CHỦ Ý KHÔNG tự động chuẩn hóa/chuyển đổi định dạng** (khác hẳn ô ODF) —
      khảo sát thật xác nhận đúng nỗi lo người dùng nêu: thiết bị "ADN1.
      OMS3255" có 163 mẫu port lịch sử, gồm CẢ 2 kiểu viết cho cùng khái niệm
      ("1-19-4", "1-6-1" kiểu gạch ngang lẫn "1/10/2", "1/11/11" kiểu gạch
      chéo) — không có 1 quy tắc chung an toàn nào để tự suy luận quy đổi giữa
      các kiểu này (khác ODF, nơi có bảng `racks`/`ports` thật làm "trọng tài"
      đúng/sai). Chỉ liệt kê để người dùng tự chọn/soi theo, đúng triết lý
      "không tự đoán" xuyên suốt dự án.
    - **"Cập nhật hồ sơ liên quan sau khi Lưu"**: cơ chế này THỰC RA đã có sẵn
      từ trước (không phải xây mới) — `saveEdit()` gọi
      `maybeStandardizeTransitDevice()` sau khi lưu `raw_text`, hàm này (a)
      hỏi tạo `devices` mới nếu chưa có (nay đã BÁO TRƯỚC qua hint ở trên,
      không còn bất ngờ), (b) gọi `growDevicePositionMapByTrib()` ghi nhận
      cặp thiết bị+port này vào `device_position_map` nếu chưa có — thư viện
      này CHÍNH LÀ nguồn dữ liệu nuôi gợi ý "mẫu port" ở trên cho lần sau, và
      cũng là thư viện autosuggest ODF khi tạo luồng thiết bị mới ở
      `DeviceCircuitList.tsx`. Vì vậy việc lưu 1 dòng "Chuyển tiếp" cấu trúc 2
      chuẩn ở đây sẽ tự động làm giàu gợi ý cho các hồ sơ liên quan khác, không
      cần thêm code đồng bộ nào mới.
    - **Không đổi**: `saveEdit()`, `maybeStandardizeTransitDevice()`, cách
      dựng lại `raw_text` cuối cùng (vẫn `"<ODF> - <Thiết bị> (<Port>)"`) —
      chỉ thêm 1 hàm `buildTransitText()` cục bộ trong `EditRow` để 5 nơi ghép
      chuỗi (ODF onChange/onBlur/gợi ý, Thiết bị onChange/gợi ý, Port
      onChange) dùng chung, tránh lặp lại cùng 1 mẫu ghép chuỗi.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Playwright CHỈ ĐỌC (mở Sửa quan
      sát + đổi giá trị ô input để test gợi ý, LUÔN bấm Hủy, không bấm Lưu)
      trên dữ liệu thật rack ODF1/1:
      - Port 31 (`"ADN1.OMEMSPP#01 (1/23/10)"`, thiết bị CHƯA có) — 3 ô hiện
        đúng giá trị tách rời, hint "Chưa có trong hồ sơ thiết bị" hiện đúng,
        KHÔNG hiện hint mẫu port (đúng, thiết bị mới không có lịch sử).
      - Port 41 (`"ADN1.OMS3255(1/9/2)"`, thiết bị ĐÃ có, 163 mẫu lịch sử) —
        KHÔNG hiện hint "chưa có"; hint mẫu port hiện đúng, thấy rõ cả 2 kiểu
        viết "1-19-4"/"1/10/2" cùng tồn tại (xác nhận đúng lo ngại ban đầu).
        Gõ thử "adn1.oms3255" (sai hoa/thường) → nút gợi ý hiện đúng
        "ADN1.OMS3255", rời ô (onBlur) tự áp đúng giá trị chuẩn.

28. **Trang mới `/data-quality` — "Chất lượng dữ liệu"** (yêu cầu người dùng
    2026-07-29, dựa theo 1 bản kế hoạch người dùng đã thảo luận trước với 1
    AI khác rồi dán nguyên văn vào đây để triển khai — đã đối chiếu lại với
    code thật, có vài điểm khác với bản kế hoạch gốc, ghi rõ bên dưới) — gộp
    3 khung rà soát trước đây rời rạc mỗi rack/mỗi trang thành 1 nơi rà hàng
    ngày duy nhất, có tab, truy cập từ Sidebar nhóm "Hồ sơ".
    - **Tab 1 "Chuyển tiếp chưa chuẩn"**: tái dùng NGUYÊN `TransitFormatWarning`
      (mục 26) không đổi gì — component tự vẽ nếu `items.length>0`.
    - **Tab 2 "Thiết bị trùng gần đúng" (hoàn toàn mới)**:
      - `lib/deviceDedup.ts` — `findFuzzyDuplicateDevices()` so khớp
        Levenshtein (`fastest-levenshtein`, thêm mới vào `package.json`, KHÔNG
        chỉ cài tạm như Playwright — đây là dependency thật của app) trên
        `normalizeDeviceNameKey()` của toàn bộ `devices.name` (150 dòng, O(N²)
        ~11k phép so sánh, không cần bật `pg_trgm`).
      - **Chạy thử trên dữ liệu thật TRƯỚC KHI xây UI (bắt buộc, vì merge là
        thao tác phá hủy) phát hiện ngưỡng distance≤2 riêng nó báo ra 199 cặp
        cho 150 thiết bị — ĐA SỐ là nhiễu**: thiết bị viễn thông rất hay đặt
        tên kiểu đánh số "TP5000#1".."TP5000#15" (15 thiết bị THẬT khác nhau),
        1 cặp số liền nhau luôn ra distance nhỏ dù là 2 thiết bị hoàn toàn
        khác nhau. Thêm bộ lọc `looksLikeNumberedSiblings()`: tách CHỮ SỐ CUỐI
        CÙNG bất kỳ đâu trong chuỗi ra riêng (vd "tp5000#3" -> chữ "tp5000#" +
        số 3); 2 tên cùng phần chữ nhưng KHÁC giá trị số -> chắc chắn là 2
        thiết bị đánh số khác nhau, loại bỏ. Cùng phần chữ VÀ cùng giá trị số
        (chỉ khác đệm số 0, vd "01" so "1") thì vẫn giữ (dấu hiệu thật của 1
        thiết bị ghi 2 kiểu). Giảm 199 -> **52 cặp** — vẫn còn vài trường hợp
        lọt lưới (vd "TP4100#2"/"TP5000#2" khác dòng máy nhưng trùng số thứ
        tự) nhưng chấp nhận được, xử lý bằng nút "Bỏ qua" thay vì cố hoàn
        thiện thuật toán thêm (rủi ro càng sửa càng dễ loại nhầm ca thật).
      - **`mergeDeviceInto(sourceId, targetId)`** (mới) — tách từ phần lõi rủi
        ro nhất của `applyBulkRename()` (`DeviceCategoryClient.tsx`): plan gốc
        giả định hàm này "đã có sẵn, dùng lại được ngay" nhưng thực tế nó là
        logic nằm sâu trong state của component đó (tick chọn, ô đổi tên),
        không phải hàm xuất dùng chung. Đã tách đúng 2 câu lệnh rủi ro nhất
        (chuyển `circuits.device_id` sang đích + xóa thiết bị nguồn) thành hàm
        chung, `applyBulkRename()` refactor lại gọi hàm này (hành vi giữ
        nguyên 100%, phần xử lý "đích đổi tên gì"/đồng bộ `device_position_map`
        vẫn ở lại mỗi nơi gọi vì 2 nơi cần khác nhau).
      - **Bảng mới `device_dedup_ignored`** (migration
        `20260729000002_device_dedup_ignored.sql`) — "Bỏ qua" 1 cặp nghi trùng
        (xác nhận là 2 thiết bị thật khác nhau), lưu DB để còn nguyên sau F5/
        đổi máy (cùng tinh thần `transit_links.format_ack` mục 26). **Khác
        gợi ý ban đầu của plan (lưu theo TÊN thiết bị)**: dùng
        `device_a_id`/`device_b_id` (uuid, FK thật `references devices(id) on
        delete cascade`) — vì tên có thể đổi sau (đổi tên/gộp ở "Danh mục
        thiết bị"), lưu theo tên sẽ tự lệch dần đúng kiểu vấn đề
        `device_position_map` từng gặp (phải có riêng
        `syncDevicePositionMapNames()` để chữa). `check (device_a_id <
        device_b_id)` + unique index — luôn insert/tra theo đúng 1 thứ tự cố
        định (sort trước) để 1 cặp chỉ có đúng 1 cách biểu diễn.
      - **Nút "Gộp vào ..." có `confirm()` nêu rõ hậu quả** (thiết bị nguồn bị
        xóa hẳn + số luồng sẽ chuyển) — cùng mức cảnh báo `DeleteRackButton.
        tsx`/`applyBulkRename` đã dùng. Nút "Bỏ qua" không cần confirm (không
        phá hủy gì, chỉ thêm 1 dòng).
    - **Tab 3 "Xung đột vị trí"**: `findDevicePositionConflicts()` (mới, tách
      từ `positionConflicts` trong `DeviceCircuitList.tsx` sang
      `lib/deviceCircuits.ts`, hành vi giữ nguyên) — **"port xung đột" theo
      plan gốc trích dẫn nhầm mục 15 (mục đó nói chuyện khác)**; đây thực ra
      là 1 vị trí ODF/DDF thiết bị bị gán cho ≥2 thiết bị khác nhau (mục 6).
      Trả về kiểu dữ liệu KHÔNG chứa `Set` (bản gốc trong component dùng
      `Set<string>` để đếm distinct — phải bỏ khi trả ra ngoài vì Server
      Component truyền props sang Client Component qua RSC không serialize
      được `Set`). UI ở tab này đơn giản hơn bản gốc trong
      `DeviceCircuitList.tsx` (bỏ phần bôi đỏ dòng trong bảng — chỉ có ý
      nghĩa tại chính bảng đó).
    - **Sidebar**: thêm mục "Chất lượng dữ liệu" vào nhóm "Hồ sơ". **Chưa làm
      badge số lượng chưa xử lý cạnh mục Sidebar** (có trong plan gốc) — cần
      fetch dữ liệu ở `app/layout.tsx` (bọc MỌI trang), tức mọi trang trong
      app đều tốn thêm vài query Supabase dù không liên quan gì tới chất
      lượng dữ liệu; đã tạm bỏ qua phần này để không thêm chi phí cho mọi
      trang, tổng số hiện đã thấy ngay khi mở `/data-quality` (dòng "Tổng:...").
    - **Kiểm chứng**: `tsc --noEmit` sạch. Migration cần chạy tay qua Supabase
      SQL Editor (không có cách tự động DDL trong môi trường này, xem mục 26)
      — `/data-quality` báo 500 đúng dự kiến trước khi chạy, hết ngay sau khi
      chạy xong. Playwright trên dữ liệu thật sau khi chạy migration:
      - Tổng đúng "357 chuyển tiếp chưa chuẩn · 52 thiết bị nghi trùng · 0 vị
        trí xung đột".
      - Tab thiết bị trùng hiện đúng cặp thật `"ADN1.PSS24X#2 BB1"` (11 luồng)
        ↔ `"ADN1.PSS24X#2/BB1"` (0 luồng), khoảng cách 0 — 1 thiết bị trùng
        thật 100% do lỗi nhập liệu cũ, đúng giá trị tính năng này nhắm tới.
      - Nút "Gộp vào..." bấm thử → dialog `confirm()` hiện đúng chữ cảnh báo
        → chủ động DISMISS (không Accept) → xác nhận cặp vẫn còn nguyên, KHÔNG
        gộp thật (đúng quy tắc an toàn Playwright đã lưu — không test thao tác
        phá hủy bằng cách bấm thật trên dữ liệu sản xuất).
      - Nút "Bỏ qua" bấm thật trên 1 cặp khác (`"ADN1.TP4100#2"`/`"ADN1.
        TP5000#2"`, đúng ca lọt lưới đã nói ở trên) → tổng giảm đúng 52->51,
        F5 vẫn giữ (lưu DB thật) → sau khi xác nhận xong, tự xóa dòng
        `device_dedup_ignored` vừa tạo để trả lại đúng trạng thái 52 ban đầu,
        không để lại tác dụng phụ ngoài ý muốn.
    - **Còn lại của bản kế hoạch gốc, CHƯA làm** (giai đoạn 2/3 theo đúng yêu
      cầu người dùng "làm theo thứ tự 1 → 2 → 3", báo lại trước khi làm tiếp):
      slide-over panel (tra cứu nhanh không rời trang đang sửa) và command
      palette (Cmd/Ctrl+K tìm xuyên hệ thống, nâng cấp từ trang Tìm kiếm
      nhanh hiện có).
