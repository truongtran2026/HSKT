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
   bị HOẶC tên tuyến cáp trung kế nếu thiết bị đấu thẳng ra trung kế — chọn
   qua toggle, xem `PositionNextMode` trong `DeviceCircuitList.tsx`), Ô3
   (Trib/sợi), ghép lại đúng 1 chuỗi qua `combinePositionNext()`
   (`lib/parsers/transit-text.ts`) khi lưu — cùng cơ chế đã dùng cho "Chuyển
   tiếp" bên ODF trung kế (`splitOdfDeviceStructure`/`PortTable.tsx`).
   Tương tự, ô "Đối phương" từng bị nhầm lẫn giữa thiết bị ADN1 nội bộ và
   trạm/thực thể khác thật (lỗi gõ "AĐN1" có dấu Đ khiến parser cũ bỏ sót —
   đã sửa `parseTransitText`/`isManagedStationCode` dùng `normalizeVN`); dữ
   liệu cũ đã di chuyển 1 lần bằng
   `scripts/migrate-counterpart-to-position-next.ts`.
