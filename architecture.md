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
