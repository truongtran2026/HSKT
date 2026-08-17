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

29. **Giai đoạn 2 — Slide-over panel "xem nhanh"** (yêu cầu người dùng
    2026-07-29, tiếp mục 28) — panel trượt từ phải, xem nhanh 1 thứ liên quan
    (port trung kế đích / thiết bị đối phương) mà KHÔNG rời trang/dòng đang
    sửa (khác điều hướng `<Link>` full-page trước đây, mất context đang cuộn/
    đang sửa dở).
    - **`components/ui/SlideOverPanel.tsx`** (mới, dùng chung) — ESC hoặc bấm
      backdrop để đóng, `z-50` (cao hơn Sidebar lúc bỏ ghim, `z-40`). Portal
      thẳng vào `document.body` (`createPortal`) — **bắt buộc** vì nơi gọi
      đầu tiên (`PortTable.tsx EditRow`) trả về nguyên 1 `<tr>`; nếu không
      portal thì `<aside>` sẽ thành con trực tiếp của `<tbody>`, sai cấu trúc
      HTML bảng. `document.body` chỉ có ở client nên phải chờ `mounted`
      (set qua `useEffect`) mới portal, tránh lỗi khi Next.js render lần đầu
      ở server.
    - **`PortTable.tsx` (`EditRow`)** — 2 nút "Xem nhanh":
      - "Xem nhanh port đích" cạnh ô tên tuyến cáp trung kế (case bare-trunk-
        link, mục 25) — lấy thẳng port đích từ `trunkPorts` (đã tải sẵn TOÀN
        BỘ port + luồng hiện tại của mọi rack cho trang này, xem
        `bareMatchedTrunkPorts`) — **không fetch thêm gì**, hiện port/sợi/
        luồng/giao tiếp của port đích, kèm link "Mở đầy đủ" nếu vẫn muốn
        điều hướng thật.
      - "Xem nhanh thiết bị này" cạnh ô Thiết bị (cấu trúc 2, mục 27) — dùng
        lại `matchedDevice` (đã tính sẵn cho tính năng gợi ý tên) hiện lĩnh
        vực/nguồn/cập nhật lần cuối.
      - **Chỉ render `<SlideOverPanel>` khi thật sự có thể mở** (bọc
        `{bareTrunkCableRouteName && (...)}` / `{matchedDevice && (...)}`) —
        phát hiện khi tự kiểm bằng Playwright: ban đầu render KHÔNG ĐIỀU
        KIỆN ở mọi dòng đang sửa (chỉ ẩn qua CSS translate khi đóng) khiến
        MỖI dòng luôn có 2 `<aside>` trong DOM dù không liên quan gì — không
        phải bug hiển thị cho người dùng thật (panel đóng luôn vô hình), chỉ
        là DOM dư thừa + khó test tự động (2 `<aside>` cùng có `<h2>`, không
        phân biệt được đang mở cái nào bằng selector thường). Sửa xong mỗi
        dòng chỉ mount panel liên quan tới nó.
    - **`DeviceCircuitList.tsx`** — nút "Xem nhanh port đích" cạnh ô "Cáp
      quang (tiếp theo)" (chế độ `isCableMode`, mục 6/16) — cùng cơ chế, đọc
      từ `trunkPorts` có sẵn. Vì `renderCircuitFormFields()` dùng chung cho
      CẢ form Sửa lẫn form Thêm mới, state `quickViewTrunkMatch` đặt ở component
      cha (không lặp lại 2 nơi), lưu thẳng `TrunkPositionMatch` (không chỉ 1
      cờ boolean) vì mỗi lần bấm có thể là dòng/match khác nhau.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Playwright CHỈ ĐỌC (mở Sửa quan
      sát, LUÔN Hủy, không Lưu) trên dữ liệu thật:
      - Port 17,18 rack ODF1/1 (bare-trunk-link) → "Xem nhanh port đích" hiện
        đúng "ODF2/11 — xem nhanh", đúng Port 15/16 của rack đó.
      - Port 41 rack ODF1/1 (thiết bị `ADN1.OMS3255`) → "Xem nhanh thiết bị
        này" hiện đúng tên + "Lĩnh vực: Truyền Dẫn" + "Nguồn: Tự sinh" khớp
        dữ liệu thật trong `devices`.
      - 1 luồng thiết bị thật (`"100GE AĐN1.PE#2-MX2020..."`, Vị trí ODF tiếp
        theo = "ODF 1/5 (35,36)") → "Xem nhanh port đích" hiện đúng
        "ODF1/5 — xem nhanh", Port 35/36 kèm đúng luồng thật đang chiếm 2 port
        đó ("100GE ADN1.PE2 (et-11/0/0) - 2T9.P1 (et-1/0/1)").
      - Đóng bằng ESC và bằng bấm ra ngoài (backdrop) đều hoạt động đúng.
    - **Còn lại của bản kế hoạch gốc, CHƯA làm**: dùng slide-over cho "sửa
      nhanh 1 dòng" ở trang Chất lượng dữ liệu (mục 28) — phức tạp hơn (cần
      1 form sửa thật, không chỉ xem), để riêng cho đợt sau; Giai đoạn 3
      (command palette Cmd/Ctrl+K).

30. **Sửa lỗi "Thêm dòng mới" ở trang Vị trí thiết bị → ODF/DDF trông như
    không có tác dụng** (báo lỗi + sửa 2026-07-29, `DevicePositionMapClient.tsx`)
    — người dùng điền form "Thêm dòng mới" và bấm Thêm nhưng không thấy dòng
    mới xuất hiện trong bảng bên dưới, tưởng thao tác thất bại.
    - **Nguyên nhân thật** (xác nhận bằng Playwright chạy thật trên dev
      server, không chỉ đọc code): dòng mới VẪN được lưu đúng vào Supabase
      (POST 201, tổng số dòng ở "X/Y dòng" tăng đúng 1) — nhưng nếu đang có 1
      chip **Lĩnh vực** khác "Tất cả" đang chọn (hoặc 1 ô lọc cột đang gõ dở),
      dòng mới bị CHÍNH bộ lọc đó loại khỏi danh sách hiển thị ngay lập tức.
      Rõ nhất khi thêm 1 thiết bị chưa từng có trong `devices` — dòng mới rơi
      vào lĩnh vực "Chưa phân loại", nếu chip đang chọn không phải "Chưa phân
      loại"/"Tất cả" thì biến mất hoàn toàn khỏi bảng, chỉ còn dấu vết là số
      bên trái "X/Y dòng" không tăng dù số bên phải có tăng — rất dễ bỏ qua.
    - **Sửa**: thêm state `addHiddenNotice`. Ngay sau khi `addRow()` insert
      thành công, tính trước (dùng lại `matchesFilter()` + `categoryByDeviceKey`
      đã có sẵn) xem dòng vừa thêm có qua được cả bộ lọc cột lẫn chip Lĩnh vực
      **hiện tại** không — nếu không, hiện banner cảnh báo màu vàng ngay trong
      khung "Thêm dòng mới" kèm nút "Bỏ lọc để xem" (xóa cả 3 ô lọc cột VÀ
      reset chip Lĩnh vực về "Tất cả" cùng lúc). Có ý KHÔNG tự động xóa bộ lọc
      thay người dùng ngay khi thêm — vì họ có thể đang cố tình lọc theo 1
      lĩnh vực để thêm liên tiếp nhiều dòng cùng loại; chỉ báo rõ + để họ tự
      quyết định có xem ngay hay không. Banner tự ẩn khi người dùng tự đổi bộ
      lọc/chip sau đó (tránh còn sót lại thông báo đã cũ/sai ngữ cảnh).
    - **Kiểm chứng**: `tsc --noEmit` sạch. Playwright chạy thật (KHÔNG chỉ mô
      phỏng) trên dữ liệu thật, có dọn dữ liệu test qua script xóa trực tiếp
      sau khi xong: chọn chip "IP" → thêm 1 thiết bị lạ → banner hiện đúng,
      dòng đúng là ẩn (đếm "190/2034" không đổi phần lọc dù tổng tăng) → bấm
      "Bỏ lọc để xem" → dòng xuất hiện, banner biến mất, chip "Tất cả" sáng
      lại, đếm về "2035/2035". Trường hợp chip đang chọn SẴN LÀ "Chưa phân
      loại" (dòng mới lẽ ra vẫn lọt qua) → xác nhận banner KHÔNG hiện sai
      (không báo giả khi dòng thật ra vẫn nhìn thấy được).

31. **Tab "Thiết bị trùng gần đúng" thêm link nhảy thẳng tới từng luồng**
    (yêu cầu người dùng 2026-07-30, `lib/deviceDedup.ts` +
    `components/data-quality/DataQualityClient.tsx`) — trước đó chỉ hiện số
    đếm "X luồng" cho mỗi thiết bị trong cặp nghi trùng, không cho biết luồng
    NÀO. Người dùng gặp thật: cặp "ADN1.MSSE3C (0 luồng) ↔ ADN1.TSSE3B (2
    luồng)" — đã tưởng xóa hết luồng của TSSE3B (thiết bị tắt nguồn) ở "Hồ sơ
    đấu nối" nhưng vẫn còn 2, không biết tìm ở đâu, còn nghi ngờ nhầm có thể
    nằm trong 1 Rack ODF trung kế nào đó.
    - **Làm rõ 1 điểm dễ nhầm về data model**: luồng domain=device (có
      `device_id`, dùng để tính số đếm ở tab này) theo định nghĩa **KHÔNG bao
      giờ gán port nào** (mục 3.4) — nên **không thể** nằm trong bất kỳ Rack
      ODF trung kế nào, chỉ có thể tìm ở "Hồ sơ đấu nối" (`/odf-device/sua-luong`).
      Đi tìm ở Hồ sơ ODF trung kế theo từng Rack là sai hướng, tốn công vô ích.
    - **Nguyên nhân thật của ca cụ thể trên**: 2 luồng còn sót có
      `device_position_own`/`device_position_next` gắn `TSSE3B` (qua
      `device_id`) nhưng **tên luồng KHÔNG chứa chữ "TSSE3B"** (vd `"STM1
      AĐN1.OMS3255 (2/5/6) - HNI (W)"`) — nếu người dùng lọc/xóa hàng loạt
      bằng cách gõ "TSSE3B" vào ô lọc cột **Tên luồng** (thay vì cột/khung
      chọn **Thiết bị**) thì 2 dòng này không khớp, bị bỏ sót. Kết luận: khi
      dọn luồng theo 1 thiết bị, luôn lọc bằng cột/khung **Thiết bị** (khớp
      chính xác `device_id`), không dùng ô lọc Tên luồng (chỉ khớp chữ, không
      phản ánh đúng liên kết thật).
    - **Sửa tận gốc**: `DeviceDupCandidate.deviceA/deviceB` (trước chỉ có
      `circuitCount: number`) nay thêm `circuits: { id, name }[]` — build từ
      `circuitsByDevice` (Map deviceId -> danh sách luồng) trong
      `findFuzzyDuplicateDevices()`. `DataQualityClient.tsx` thêm component
      `CircuitLinkList` hiện tên từng luồng dưới mỗi cặp, mỗi tên là link
      `/odf-device/sua-luong#dc-<id>` (dùng lại `rowAnchor()` +
      cơ chế cuộn-tới-dòng/tô sáng đã có sẵn trong `DeviceCircuitList.tsx`,
      giống hệt cách tab "Xung đột vị trí" đã làm) — bấm vào tên luồng là
      nhảy thẳng tới đúng dòng, không cần tự lọc/tìm tay nữa.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Chưa chạy Playwright (chỉ đổi hiển
      thị + thêm field dữ liệu, không đổi logic ghi/xóa).

32. **Bug: xóa luồng thiết bị không dọn "mirror" trung kế tự sinh → port
    trung kế mồ côi báo "đang dùng" mãi** (người dùng phát hiện 2026-07-31,
    `DeviceCircuitList.tsx`) — mục 15 đã tự tạo 60 luồng "mirror" bên Hồ sơ
    ODF Trung kế (script `sync-missing-trunk-circuits.ts`, 2026-07-28) để
    phản ánh đúng port đang dùng thật, mỗi mirror chỉ nhận ra luồng thiết bị
    GỐC của nó qua text cố định trong `notes` ("...luồng gốc id `<uuid>`."),
    KHÔNG có FK thật nối 2 dòng `circuits` này (đúng nguyên tắc CLAUDE.md #3
    "liên kết bán cấu trúc"). Hệ quả: `deleteCircuit()`/`deleteSelectedCircuits()`
    (xóa luồng thiết bị) chỉ xóa đúng 1 dòng `circuits` phía thiết bị, không
    biết gì về mirror bên trung kế — xóa xong, port trung kế vẫn `in_use` +
    hiện tên luồng cũ mãi dù luồng gốc không còn tồn tại. Ca cụ thể người dùng
    báo: xóa luồng thiết bị `"10GE AĐN1.P2 (17/0/3) - DNG.MPE.06 (1/2/1)"`
    (id `e4abf816...`), port 7,8 rack `ODF1/5` bên trung kế vẫn báo đang dùng.
    - **Rà toàn hệ thống trước khi sửa**: quét cả 60 mirror hiện có (notes
      chứa "luồng gốc id"), đối chiếu id gốc với `circuits` hiện tại — CHỈ
      đúng 1 trường hợp orphan (ca người dùng báo), không có case tương tự
      khác đang tồn đọng.
    - **`lib/mirrorTrunkCircuits.ts`** (mới): `findMirrorTrunkCircuits(originIds)`
      — quét `circuits` có `notes ilike '%luồng gốc id%'`, parse regex lấy id
      gốc, trả `Map<originId, {circuitId, circuitName, portIds}>` (chỉ những
      id có trong tập truyền vào, không load thừa). `deleteMirrorTrunkCircuits(matches)`
      — xóa cascade đúng thứ tự: (1) `transit_links` của các port sắp giải
      phóng (cùng lý do mục 16 — port trống thì "Chuyển tiếp" cũ vô nghĩa),
      (2) xóa `circuits` mirror (tự cascade `port_circuit_links` qua FK
      `on delete cascade` có sẵn từ `init_schema.sql`, không cần xóa tay),
      (3) đưa `ports.status` các port đó về `unused`.
    - **`DeviceCircuitList.tsx` — `deleteCircuit()`/`deleteSelectedCircuits()`**:
      gọi `findMirrorTrunkCircuits()` TRƯỚC khi hỏi `confirm()` — nếu có
      mirror, thêm dòng cảnh báo rõ trong hộp thoại xác nhận (luồng mirror
      nào sẽ bị xóa theo, port nào sẽ về trống) để không bất ngờ; xóa xong
      luồng thiết bị mới gọi `deleteMirrorTrunkCircuits()`. Lỗi ở bước dọn
      mirror KHÔNG coi là lỗi toàn bộ thao tác (luồng thiết bị đã xóa xong
      thật) — chỉ báo riêng, cùng tinh thần các chỗ đồng bộ phụ khác
      (`syncDevicePositionMapNames`...).
    - **Dọn ca orphan đã phát hiện**: chạy trực tiếp `deleteMirrorTrunkCircuits()`
      qua script tạm 1 lần — xóa mirror `7d2c517b...`, port 7/8 rack `ODF1/5`
      về `unused`, xác nhận lại `port_circuit_links` rỗng.
    - **Kiểm chứng**: `tsc --noEmit` sạch; curl lại `/`, `/odf-trunk`,
      `/odf-device/sua-luong`, `/data-quality`, `/devices` đều 200.
    - **Người dùng phản biện đúng (2026-07-31)**: "hệ thống từng tự động tạo
      mirror thì phải có liên kết thật chứ nhỉ" — đúng, bản vá trên chỉ chặn
      2 hàm ở `DeviceCircuitList.tsx`. Rà lại phát hiện THÊM 1 cửa cũng xóa
      thẳng `circuits.device_id` mà không qua 2 hàm đó: nút "Xóa hẳn thiết
      bị" ở `/devices` (`DeviceCategoryClient.tsx` mục 14) — vá kiểu "nhớ gọi
      hàm dọn dẹp ở từng nơi" luôn có nguy cơ sót cửa mới sau này. Đã hỏi
      &amp; người dùng chọn hướng triệt để hơn: thêm ràng buộc THẬT ở tầng CSDL.

33. **`circuits.mirror_of_id` — thay liên kết mirror trung kế từ text sang FK
    thật `on delete cascade`** (yêu cầu người dùng 2026-07-31, tiếp nối mục
    32) — migration `20260731000001_circuits_mirror_of.sql`: thêm cột
    `mirror_of_id uuid references circuits(id) on delete cascade`, index kèm
    theo. Từ nay xóa luồng thiết bị gốc ở **BẤT KỲ đâu** (`DeviceCircuitList.tsx`,
    `DeviceCategoryClient.tsx`, hay 1 script quản trị nào đó sau này chưa
    viết) đều được Postgres **tự xóa mirror theo**, không phụ thuộc code nhớ
    gọi đúng hàm — đúng tinh thần "liên kết bán cấu trúc nên chuẩn hóa dần"
    (CLAUDE.md #3), ở đây đã đủ dữ liệu ổn định (60 mirror cố định, không còn
    tăng thêm qua UI sống) nên chuẩn hóa thành FK thật là hợp lý.
    - **`scripts/backfill-mirror-of-id.ts`** (mới, DRY RUN/`--commit`,
      `npm run backfill-mirror-of-id`) — chạy 1 LẦN sau khi migration được áp
      dụng: parse lại đúng cụm text "luồng gốc id `<uuid>`" trong `notes` của
      59 mirror còn lại (60 gốc trừ 1 đã dọn tay ở mục 32), điền vào
      `mirror_of_id`. Sau lần chạy này, code app KHÔNG còn đọc `notes` để
      nhận diện mirror nữa — chỉ còn script backfill này biết định dạng text
      cũ (giữ lại trong repo làm tài liệu/có thể chạy lại nếu cần đối chiếu).
    - **`lib/mirrorTrunkCircuits.ts` đổi cách nhận diện**: `findMirrorTrunkCircuits()`
      giờ query thẳng `circuits.mirror_of_id in (...)` (có index) thay vì
      quét + regex toàn bộ `notes` — nhanh và đáng tin cậy hơn. Đổi tên
      `deleteMirrorTrunkCircuits()` → **`cleanupAfterMirrorCascade()`**: KHÔNG
      còn tự xóa dòng `circuits` mirror nữa (đã tự cascade khi luồng gốc bị
      xóa, xong trước khi hàm này được gọi) — chỉ còn lo phần KHÔNG tự cascade
      được: xóa `transit_links` của các port giải phóng (cùng lý do mục 16) +
      đưa `ports.status` về `unused`.
    - **`DeviceCategoryClient.tsx` — `deleteSelectedDevices()` vá theo cùng
      cơ chế**: tra `findMirrorTrunkCircuits()` theo danh sách `circuit.id`
      của các thiết bị sắp xóa (từ prop `circuits` đã có sẵn) TRƯỚC `confirm()`
      để thêm dòng cảnh báo rõ số luồng mirror sẽ bị xóa theo (giống cách
      `DeviceCircuitList.tsx` đã làm) — xóa `circuits` xong (đã tự cascade
      mirror) mới gọi `cleanupAfterMirrorCascade()`.
    - **QUAN TRỌNG — cần người dùng tự chạy migration**: cùng lý do mục 25 —
      môi trường này không có Postgres connection string/Supabase CLI, phải
      copy nội dung `supabase/migrations/20260731000001_circuits_mirror_of.sql`
      chạy tay qua Supabase Dashboard → SQL Editor, RỒI mới chạy
      `npm run backfill-mirror-of-id -- --commit`. Trước khi làm xong cả 2
      bước, các luồng gọi `findMirrorTrunkCircuits()` (nút Xóa ở
      `/odf-device/sua-luong` và `/devices`) sẽ lỗi (cột `mirror_of_id` chưa
      tồn tại) — đúng dự kiến, không phải bug code.
    - **Kiểm chứng (đầy đủ, sau khi người dùng chạy migration 2026-07-31)**:
      `tsc --noEmit` sạch. `npm run backfill-mirror-of-id -- --commit` ghi
      đúng 59/59 dòng, chạy lại dry run xác nhận "0 cần cập nhật, 59 đã đúng
      sẵn". Test cascade thật (tạo 2 dòng `circuits` test độc lập —
      `__TEST_ORIGIN__`/`__TEST_MIRROR__` trỏ `mirror_of_id`, xóa origin, xác
      nhận mirror biến mất theo, không đụng dữ liệu thật, đã dọn sạch dữ liệu
      test ngay sau) → cascade hoạt động đúng ở tầng CSDL. Curl lại `/`,
      `/odf-trunk`, `/odf-device/sua-luong`, `/data-quality`, `/devices` đều
      200.

34. **Lớp "chưa đồng bộ" thứ 2: luồng TRUNG KẾ trỏ "Chuyển tiếp" sang 1 port
    trung kế KHÁC đang trống** (người dùng phát hiện 2026-07-31, ngay sau khi
    tự thêm luồng "IDC3 - CMC" ở `ODF2/10(28)`, Chuyển tiếp ghi "ODF 6/1 (4)"
    nhưng port 4 rack `ODF6/1` vẫn trống) — cùng LỚP vấn đề với mục 15
    (luồng thiết bị thiếu mirror trung kế) nhưng khác HƯỚNG: ở đây nguồn đã
    là 1 luồng trung kế thật (có `port_circuit_links`), "Chuyển tiếp" của nó
    lại trỏ thẳng sang 1 port trung kế khác (không qua thiết bị nào — "form
    2" đã công nhận ở `lib/transitLinks.ts`) nhưng port đích trống — thiếu
    đúng nửa còn lại của cặp "2 dòng circuit mirror nhau cho 1 liên kết vật
    lý" (jumper/patch nội bộ giữa 2 rack ODF).
    - **`scripts/audit-trunk-trunk-sync.ts`** (mới, chỉ đọc, `npm run
      audit-trunk-trunk-sync`) — quét toàn bộ `transit_links` có nguồn là
      rack `domain='trunk'`, dùng `matchBareTrunkLink()` (đã có sẵn từ mục
      29/`lib/trunkPorts.ts`) để nhận diện "form 2", kiểm tra
      `resolvedPorts[].inUse` của port đích. **Kết quả rà lần đầu**: 513 dòng
      `transit_links`, 91 dòng khớp "form 2", **25 port đích trống** thuộc
      **14 luồng nguồn** (đúng có ca "IDC3 - CMC" người dùng báo, đánh dấu
      trong danh sách trình bày cho người dùng xác nhận).
    - **Đã hỏi & người dùng chọn hướng xử lý**: "Tự động tạo mirror cho cả
      14" — giống hệt hướng đã chọn ở mục 15.
    - **`scripts/sync-missing-trunk-trunk-circuits.ts`** (mới, DRY RUN/
      `--commit`, `npm run sync-missing-trunk-trunk-circuits`) — cùng cấu
      trúc với `sync-missing-trunk-circuits.ts` (rà soát SỐNG ngay trước khi
      ghi từng dòng, tự bỏ qua cặp port đã "hết trống" do chính đợt chạy này
      xử lý, xử lý đúng dạng PostgREST trả `port_circuit_links` là OBJECT
      đơn không phải mảng) — nhưng **khác 1 điểm quan trọng**: gắn
      `circuits.mirror_of_id` NGAY LÚC TẠO (cột thật từ mục 33) thay vì chỉ
      ghi text "luồng gốc id..." vào `notes` — tránh lặp lại đúng bug mồ côi
      đã gặp ở mục 32 cho chính lô mirror mới tạo này.
    - **Kết quả (2026-07-31)**: **13/14 tạo thành công** (bao gồm đúng ca
      "IDC3 - CMC" → `ODF6/1` port 4); **1 trường hợp xung đột thật cần rà
      tay**: "3G BTS Vina" (`ODF6/4` port 1) ghi Chuyển tiếp "ODF 6/3/(6,7)"
      nhưng port 6 tại `ODF6/3` **đã có sẵn** 1 luồng khác **cùng tên** "3G
      BTS Vina" chiếm rồi (chỉ port 7 thật sự trống) — script tự phát hiện
      xung đột (chặn ghi cả cặp thay vì tự đoán tạo 1 luồng lẻ port 7), không
      tự đoán, để người dùng đối chiếu hồ sơ giấy rồi sửa tay. Chạy lại
      `audit-trunk-trunk-sync.ts` xác nhận số "chưa đồng bộ" giảm đúng từ 25
      xuống còn 1 (đúng trường hợp trên).
    - **Kiểm chứng**: `tsc --noEmit` sạch; curl lại `/`, `/odf-trunk`,
      `/odf-device/sua-luong`, `/data-quality`, `/devices`, `/search`,
      `/dashboard` đều 200.

35. **Lớp "chưa đồng bộ" thứ 3: luồng THIẾT BỊ ↔ THIẾT BỊ (cả 2 đầu đều local
    ADN1) thiếu nửa mirror** (người dùng phát hiện 2026-07-31, ngay sau mục
    34, khi tự thêm luồng "ADN1.ASBR#2-MX2020 (7/1/7) đi ADN1.P2 (16/1/9)" —
    bên "ADN1.P2" không có luồng nào ở Trib "16/1/9"). Trợ lý AI lúc đầu
    tưởng nhầm cần thêm dữ liệu vật lý bên ngoài mới tạo được mirror — **người
    dùng chỉ ra ĐÚNG**: đối chiếu các cặp ASBR#2-MX2020↔P2 đã có sẵn xác nhận
    quy luật cơ học — `device_position_own` của thiết bị B chính là PHẦN ODF
    trong `device_position_next` của thiết bị A, và ngược lại — không cần
    biết thêm gì về vật lý thật, suy được 100% từ dữ liệu đã có.
    - **`lib/deviceDeviceSync.ts`** (mới) — `findMissingDeviceMirrors(circuits, devices)`
      dùng chung cho cả audit lẫn sync (bài học mục 9 — không lặp thuật toán
      2 nơi). Trả về **2 nhóm** tách riêng:
      - `gaps`: thiết bị đích CHƯA có luồng nào khớp Trib mong đợi VÀ cũng
        chưa có luồng nào TRÙNG TÊN — an toàn để tự tạo.
      - `mismatches`: thiết bị đích ĐÃ CÓ 1 luồng **trùng tên hệt** luồng
        nguồn (mirror thật luôn giữ nguyên tên ở cả 2 phía, xác nhận qua dữ
        liệu) nhưng Trib ghi lệch — **KHÔNG tự tạo thêm** (sẽ tạo trùng luồng
        đã có), chỉ báo cho người dùng tự sửa Trib bên nào đúng.
      - Phát hiện nhóm `mismatches` này chính là bước tự kiểm chứng trước khi
        ghi hàng loạt — nếu bỏ qua sẽ tạo trùng dữ liệu (xem 2 ca ADX/DWDM
        FTI dưới).
      `buildMirrorNextPosition()` ghép `device_position_next` cho dòng mirror
      (own + tên + trib của luồng gốc, dùng lại `combinePositionNext()` có
      sẵn).
    - **`scripts/audit-device-device-sync.ts`** (mới, chỉ đọc, `npm run
      audit-device-device-sync`) — rà 855 luồng có "Vị trí ODF tiếp theo"
      trỏ tới 1 thiết bị local ADN1 đã biết: **41 ca ban đầu**, sau khi lọc
      qua bước kiểm chứng "trùng tên" còn **37 ca thiếu hẳn** (an toàn tự
      tạo) + **4 ca đã có mirror nhưng Trib lệch** (lỗi gõ dữ liệu gốc, vd
      "ADX#16/LP1" bị ghi nhầm "ADX#15/LP1" — 2 dòng LP1/LP2 kề nhau dễ lẫn;
      để người dùng tự sửa, không tự đoán bên nào đúng).
    - **`scripts/sync-missing-device-device-circuits.ts`** (mới, DRY RUN/
      `--commit`, `npm run sync-missing-device-device-circuits`) — KHÁC 2
      script sync trước (không đụng `ports`/`port_circuit_links` gì cả, vì
      domain=device không có bảng port thật — mục 7.2): chỉ INSERT 1 dòng
      `circuits` mới với `device_id`/`trib_text`/`device_position_own/next`
      suy cơ học từ dòng gốc, gắn `mirror_of_id` ngay lúc tạo (cột thật từ
      mục 33 — áp dụng được cho cả domain=device, không chỉ trunk). Rà sống
      lại ngay trước khi ghi từng dòng (tránh tạo trùng nếu 2 gap cùng đợt
      chạy đụng nhau).
    - **Đã hỏi & người dùng chọn hướng xử lý**: "Ghi thật cả 37". Kết quả:
      **37/37 tạo thành công**, chạy lại audit xác nhận "0 thiếu hẳn", 4 ca
      lệch Trib giữ nguyên để người dùng tự sửa tay.
    - **Sự cố phát hiện NGAY SAU khi ghi (cùng ngày 2026-07-31, người dùng
      báo)**: 1 trong 37 mirror ("100GE AĐN1.P2 (11/1/3)... Trib S47-1")
      được tạo dưới thiết bị `ADN1.PSS64/BB330G` — nhưng thiết bị NÀY và
      `ADN1.PSS64 BB1` (thiết bị chuẩn hóa thật, đã có 50 luồng từ lúc import
      gốc) **là CÙNG 1 thiết bị vật lý thật** (`BB330G` là tên cũ, `BB1` là
      tên mới chuẩn hóa) — người dùng xác nhận trực tiếp bằng kiến thức thực
      tế trạm, đúng tinh thần [[feedback_defer_to_physical_domain_knowledge]].
      2 tên này lệch nhau QUÁ NHIỀU ký tự ("BB330G" so "BB1") nên tab "Thiết
      bị trùng gần đúng" (mục 27, ngưỡng edit-distance≤2) không bao giờ bắt
      được — đây là giới hạn ĐÃ BIẾT của công cụ dedup tên gần đúng, không
      phải lỗi mới.
    - **Rà lại TOÀN BỘ 37 dòng vừa tạo** (so tên với dữ liệu CŨ hơn, loại trừ
      đúng chính luồng GỐC mà mirror được tạo ra từ đó — lần đầu rà nhầm coi
      cả luồng gốc là "trùng" nên báo sai 36/37, rà lại đúng cách chỉ còn
      **16/37 là trùng THẬT**): toàn bộ 16 luồng nhắm vào thiết bị
      `ADN1.PSS64/BB330G` đều trùng 100% (cùng tên VÀ cùng Trib) với luồng đã
      có sẵn dưới `ADN1.PSS64 BB1` — vì bảng `deviceIdByKey` trong
      `findMissingDeviceMirrors()` chỉ so khớp theo TEXT tên thiết bị xuất
      hiện trong "Vị trí ODF tiếp theo", không biết `PSS64/BB330G` cần hiểu
      là `PSS64 BB1`. 21 luồng còn lại (ASBR2↔PSS24X#3, ASBR2↔P2,
      ADX↔OMS3255, MRSE3C↔OMS3255) đã kiểm tra riêng — các thiết bị đích đó
      (`PSS24X#3 BB1`, `P2`, `OMS3255`, `MRSE3C`, `ADX`) đều chỉ có ĐÚNG 1
      dòng `devices`, không có vấn đề tương tự.
    - **Đã dọn (người dùng xác nhận trước khi xóa — bị auto-mode classifier
      chặn hành động xóa hàng loạt, đúng quy trình an toàn, dừng lại hỏi rồi
      mới làm)**: xóa 16 luồng trùng, dọn `device_position_map` theo tên, xóa
      hẳn thiết bị `ADN1.PSS64/BB330G` (đúng thứ tự mục 14) — KHÔNG đụng gì
      dữ liệu gốc bên `ADN1.PSS64 BB1`. Chạy lại `audit-device-device-sync`
      xác nhận về đúng trạng thái trước sự cố ("0 thiếu hẳn", vẫn 4 ca lệch
      Trib không đổi).
    - **Bài học**: khi mirror-sync tự động chọn thiết bị đích qua tra cứu
      theo TÊN TEXT (không phải theo id cố định), luôn có rủi ro chọn nhầm 1
      thiết bị "trùng lặp gần-như-vô-hình" (đổi tên hoàn toàn, không phải lỗi
      chính tả) mà công cụ dedup fuzzy-tên không bắt được — chỉ phát hiện
      được qua kiểm tra chéo SAU KHI ghi (so khớp Trib+tên với TOÀN BỘ dữ
      liệu, không chỉ trong phạm vi device_id vừa chọn) hoặc qua chính người
      dùng biết lịch sử đổi tên thiết bị thật.
    - **Kiểm chứng**: `tsc --noEmit` sạch; curl lại `/`, `/odf-trunk`,
      `/odf-device/sua-luong`, `/data-quality`, `/devices`, `/search`,
      `/dashboard` đều 200.

36. **Sửa tiếp mục 35: quy tắc own/next SAI khi 2 vị trí ODF trùng nhau + dọn
    dữ liệu ADX đã tắt nguồn** (người dùng chỉ ra ngay sau mục 35, cùng ngày
    2026-07-31) — `buildMirrorNextPosition()` dùng thẳng `device_position_own`
    của luồng GỐC để ghép vào "next" của mirror, nhưng nếu `own` của luồng gốc
    lại TRÙNG với phần ODF đã tách ra làm `own` cho mirror (own == next-ODF
    của chính luồng gốc) thì đó là **2 vị trí ODF không thể là 1** (người
    dùng khẳng định) — dữ liệu gốc kiểu này (vd ADX các cổng ≤12) dùng cách
    ghi CŨ để thể hiện "kết nối trực tiếp" (lặp lại tọa độ) thay vì ghi rõ
    chữ "Kết nối trực tiếp" như các dòng đã chuẩn hóa (ADX#15/LP1, #16/LP1,
    #16/LP2). Ca cụ thể: mirror OMS3255 tạo cho "ADX#11/LP1" bị ghi `next =
    "ODF 4/6 (13,14) - ADX (ADX#11/LP1)"` (lặp đúng tọa độ own), lẽ ra phải
    là `"Kết nối trực tiếp - ADN1.ADX (ADX#11/LP1)"`.
    - **Phát hiện thêm nguyên nhân gốc của TOÀN BỘ nhóm ADX**: người dùng cho
      biết thiết bị `ADN1.ADX` cổng **#13 trở lên (13/14/15/16) còn dùng**,
      cổng **≤12 đã tắt nguồn** — 12 luồng phía ADX (cổng 2,3,4,6,11,12,
      mỗi cổng 2 dòng LP1/LP2) là dữ liệu CŨ lẽ ra phải xóa từ trước, không
      phải "thiếu mirror" thật.
    - **Dọn dữ liệu (người dùng xác nhận trước khi xóa)**: xóa 12 luồng gốc
      phía `ADN1.ADX` (cổng ≤12) — nhờ `mirror_of_id on delete cascade` (mục
      33), 12 luồng mirror vừa tạo nhầm bên `ADN1.OMS3255` **tự động biến
      mất theo**, không cần xóa tay 2 lần (đúng mục đích xây cột này từ đầu).
      Không đụng cổng 13-16 (còn dùng).
    - **Sửa thuật toán `lib/deviceDeviceSync.ts` — `buildMirrorNextPosition()`**:
      thêm kiểm tra `ownKey === targetOwnKey` (chuẩn hóa qua
      `normalizeDevicePositionKey`) — nếu trùng, dùng `"Kết nối trực tiếp"`
      thay cho tọa độ lặp lại khi ghép phần ODF của "next" bên mirror (giữ
      nguyên `own` của mirror — đó vẫn là tọa độ thật của thiết bị đích).
      Sửa lại luôn 1 luồng còn sót đang dùng thật (mirror ADX#15/LP2 →
      OMS3255, cổng 15 vẫn hoạt động nên không xóa, chỉ sửa field) từ `next
      = "ODF 4/7 (01,02) - ADX (ADX#15/LP2)"` thành `"Kết nối trực tiếp -
      ADX (ADX#15/LP2)"`.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Chạy lại `audit-device-device-sync`
      xác nhận vẫn "0 thiếu hẳn", 4 ca lệch Trib không đổi. Curl lại `/`,
      `/odf-trunk`, `/odf-device/sua-luong`, `/data-quality`, `/devices`,
      `/search`, `/dashboard` đều 200.
    - **Sửa tiếp lần 2 cùng ngày — dòng GỐC (không phải mirror) của
      ADX#15/LP2 cũng sai `own`**: người dùng chỉ ra lý do vật lý cụ thể —
      2 thiết bị `ADN1.ADX` và `ADN1.OMS3255` nối trực tiếp với nhau, nhưng
      bản chất vật lý KHÔNG đối xứng: phía ADX ra cáp thẳng vào ODF của
      OMS3255 luôn (mặt trước, không qua ODF riêng của ADX), còn OMS3255 ra
      cáp ở ODF mặt sau cố định của chính nó. Vì vậy: dòng gốc phía
      `ADN1.ADX` (id `d3795ced-f85e-4c83-8152-9da68e0ff896`, Trib
      `ADX#15/LP2`) có `device_position_own = "ODF 4/7 (01,02)"` là SAI —
      tọa độ đó thực ra là ODF thật của OMS3255, không phải của ADX — phải
      sửa thành `"Kết nối trực tiếp"` (khớp với 3 dòng chị em cùng Trib
      `ADX#15/LP1` đã chuẩn hóa sẵn kiểu này). `device_position_next` của
      dòng gốc này (`"ODF 4/7 (01,02) - OMS3255 (2/4/9)"`) giữ nguyên — đã
      đúng ngay từ đầu vì đó đúng là tọa độ ODF thật của OMS3255. Mirror bên
      OMS3255 (đã tự tạo, mục 35) không đổi gì thêm — người dùng xác nhận
      "OK". Đã rà toàn bộ 4 thiết bị `ADN1.ADX#13/14/15/16` (riêng biệt, hoá
      ra không có luồng nào gắn trực tiếp — mọi luồng ADX vẫn đang nằm dưới
      thiết bị chung `ADN1.ADX`) và toàn bộ Trib `ADX#15/LP1` — không còn
      dòng nào khác lặp lại kiểu lỗi này. Đây là lỗi nhập liệu gốc một lần
      (không phải bug thuật toán), sửa tay trực tiếp bằng script tạm, không
      cần đổi code.

37. **Tô màu + lọc + đẩy lên đầu bảng cho luồng vừa thêm/sửa TRONG NGÀY**
    (`components/odf-device/DeviceCircuitList.tsx`, yêu cầu người dùng
    2026-07-31) — thay cho cơ chế cũ chỉ ghim ĐÚNG 1 dòng vừa thêm lên đầu +
    tô màu amber trong 5 giây rồi tự tắt (người dùng phản hồi: 5 giây quá
    ngắn, không kịp thấy trước khi dòng "nhảy đi chỗ khác" về đúng vị trí sắp
    xếp thật).
    - **Cơ chế mới — thuần dựa vào dữ liệu thật, không dùng timer**: bảng
      `circuits` đã có sẵn cột `updated_at` (tự cập nhật qua trigger DB, xem
      migration `circuits_updated_at`, mục 27) cho MỌI lần thêm mới lẫn sửa.
      Hàm mới `isUpdatedToday()` (`lib/format.ts`) so `updated_at` với ngày
      hiện tại (giờ máy người dùng) — không cần lưu state/timer riêng, tự
      "hết hạn" đúng lúc sang ngày mới vì lúc đó so sánh ngày sẽ không khớp
      nữa.
    - `DeviceCircuitList.tsx`: `updatedTodayIds` (useMemo từ `circuits`) —
      MỌI luồng có `updated_at` = hôm nay được: (a) tô nền vàng nhạt
      (`bg-yellow-50`, persistent, khác màu `bg-amber-100` tạm thời 5s vẫn
      giữ riêng cho cơ chế "nhảy tới từ link ngoài #dc-<id>"), (b) đẩy lên
      ĐẦU bảng bất kể đang sắp xếp/lọc cột nào, nhóm này tự sắp theo
      `updated_at` mới nhất trước; phần còn lại giữ nguyên thứ tự theo cột
      đang chọn.
    - Checkbox mới trong thanh công cụ: "Chỉ hiện luồng sửa hôm nay (N)" —
      lọc bảng chỉ còn các dòng trong `updatedTodayIds`, AND với mọi bộ lọc
      cột khác đang có. Chỉ hiện khi có ít nhất 1 dòng thỏa. Bỏ tick =>
      hiện lại tất cả (state React thường, tự reset khi F5 — không cần lưu
      localStorage, đúng ý người dùng "chỉ hủy lọc khi refresh lại").
    - Xóa hẳn cơ chế cũ trong `submitCreate()` (`justCreatedIdRef` +
      `setTimeout(..., 5000)` ghim/tắt màu 1 dòng) — dư thừa vì dòng vừa tạo
      giờ tự động nằm trong `updatedTodayIds` ngay khi `router.refresh()` nạp
      lại dữ liệu, không cần code riêng nữa.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Curl `/` và `/odf-device/sua-luong`
      đều 200.

38. **Gắn tự động tạo mirror thiết bị-thiết bị THẲNG VÀO form Thêm/Sửa luồng**
    (yêu cầu người dùng 2026-07-31, phát hiện ngay trong ngày làm mục 35/36) —
    ca cụ thể: thêm 2 luồng `ADN1.ASBR#2-MX2020 (7/1/8)` và `(7/1/9)` (đi HKG)
    xong, bên `ADN1.PSS24X#3 BB1 (1-4-1)`/`(1-4-5)` KHÔNG tự có luồng tương
    ứng dù bản chất là 2 thiết bị local ADN1 nối nhau (đúng loại ca mục 35).
    - **Nguyên nhân gốc**: toàn bộ cơ chế "tự tạo mirror" ở mục 35/36 (hàm
      `findMissingDeviceMirrors`/`buildMirrorNextPosition` trong
      `lib/deviceDeviceSync.ts`) **CHỈ từng chạy 1 LẦN dưới dạng script dọn
      dữ liệu tồn đọng** (`npm run sync-missing-device-device-circuits --
      --commit`) — **chưa bao giờ được gắn vào chính form Thêm/Sửa luồng
      trên UI** (`DeviceCircuitList.tsx`). Vì vậy MỌI luồng thiết bị-thiết bị
      MỚI thêm/sửa sau lần dọn đó lại tiếp tục thiếu mirror y hệt trước khi
      dọn — không phải lỗi ngẫu nhiên mà là lỗ hổng cơ chế còn sót.
    - **Backfill ngay 2 ca đã báo**: chạy lại `audit-device-device-sync`
      (xác nhận đúng 2 ca "THIẾU HẲN, an toàn tự tạo") rồi
      `sync-missing-device-device-circuits -- --commit` — tạo xong 2 luồng
      mirror bên `ADN1.PSS24X#3 BB1`, audit lại còn "0 thiếu hẳn".
    - **Sửa cơ chế triệt để**: thêm hàm mới `autoCreateMirrorForCircuit()`
      (`lib/deviceDeviceSync.ts`) — TÁI DÙNG NGUYÊN `findMissingDeviceMirrors`
      + `buildMirrorNextPosition` đã có (không viết lại thuật toán khác,
      tránh lệch nhau như bài học mục 34/35), chỉ khác: tự
      `fetchDeviceCircuits()`/`fetchDevices()` lấy dữ liệu MỚI NHẤT, tìm gap
      của ĐÚNG luồng vừa lưu (so theo `sourceCircuitId`), rà sống lại 1 lần
      nữa ngay trước khi ghi (tránh đụng độ), rồi `insert` mirror kèm
      `mirror_of_id` — không cần DRY RUN vì đây là 1 luồng đơn lẻ người dùng
      vừa chủ động lưu, không phải sửa hàng loạt. Nếu phát hiện case
      "mismatch" (đã có luồng cùng tên nhưng Trib lệch, xem mục 35) thì KHÔNG
      tự tạo — chỉ báo lỗi mềm cho người dùng biết vào Chất lượng dữ liệu tự
      kiểm tra, cùng tinh thần "không đoán, để người dùng tự sửa".
    - Gắn gọi `autoMirrorAfterSave()` (wrapper xử lý 3 trạng thái trả về,
      không chặn việc lưu luồng dù bước này lỗi — giống
      `maybeCreateCounterpartDevice`/`maybeCreateNextDevice` đã có) ngay sau
      `maybeCreateNextDevice()` trong CẢ `submitCreate()` lẫn `saveEdit()` —
      áp dụng cho cả thêm mới VÀ sửa (sửa `device_position_next` trỏ sang
      thiết bị khác cũng cần đồng bộ lại).
    - **Chưa làm** (ngoài phạm vi ca báo lần này, có thể cần làm tiếp nếu gặp
      lại): device-trunk và trunk-trunk (mục 32/34) hiện cũng CHỈ có script
      dọn 1 lần (`sync-missing-trunk-circuits.ts`,
      `sync-missing-trunk-trunk-circuits.ts`), KHÔNG gắn vào form Thêm/Sửa
      luồng bên `PortTable.tsx`/ODF trung kế — cùng loại lỗ hổng, nhưng CHƯA
      sửa vì ca báo lần này chỉ ở phía thiết bị-thiết bị.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Curl `/`, `/odf-device/sua-luong`,
      `/data-quality` đều 200.

39. **Cùng lỗ hổng ở mục 38 nhưng phía đối diện là ODF TRUNG KẾ THẬT (không
    phải thiết bị)** — ca cụ thể: thêm luồng `ADN1.ASBR#2-MX2020 (7/1/2)`
    đấu qua `ODF1/10 (35,36)`, nhưng bên Hồ sơ ODF Trung kế port đó vẫn
    "trống". Người dùng yêu cầu rõ: "đồng bộ lại chứ; cho cả việc thêm bớt
    xóa sau này chứ" — vừa sửa dữ liệu hiện tại vừa sửa cơ chế cho lâu dài.
    - **Nguyên nhân**: y hệt mục 38 — cơ chế tạo mirror trung kế
      (`scripts/sync-missing-trunk-circuits.ts`, có từ 2026-07-28) chỉ từng
      chạy dưới dạng script dọn dữ liệu, chưa gắn vào form Thêm/Sửa luồng.
      Phát hiện thêm: script này CHƯA từng cập nhật để dùng `mirror_of_id`
      (cột thật thêm ở mục 33) — vẫn ghi kiểu TEXT cũ "luồng gốc id
      &lt;uuid&gt;" trong `notes`, nên nếu cứ backfill bằng script cũ thì sẽ tái
      lặp đúng bug mồ côi mục 32 khi xóa luồng gốc sau này.
    - **Backfill 2 ca đang tồn đọng** (audit `audit-device-trunk-sync` xác
      nhận đúng 2 ca "chưa đồng bộ"): `ASBR#2 (7/1/2) -> ODF1/10 (35,36)` và
      `BNG#1 (7/0/0) -> ODF6/5 (61,68)` — đã tạo xong qua
      `sync-missing-trunk-circuits -- --commit` (đã sửa script gắn
      `mirror_of_id` trước khi chạy), audit lại còn 0 ca.
    - **Sửa cơ chế triệt để, tránh lệch thuật toán 2 nơi** (bài học mục
      34/35): tách phần dò-khớp rack/port trung kế trống ra hàm dùng chung
      `findTrunkMirrorCandidates()` (`lib/mirrorTrunkCircuits.ts`) — cả
      `sync-missing-trunk-circuits.ts` (rà hàng loạt) LẪN hàm mới
      `autoCreateTrunkMirrorForCircuit()` (tạo ngay lúc lưu form) đều gọi
      chung hàm này, không viết lại 2 chỗ. `autoCreateTrunkMirrorForCircuit()`
      tự fetch dữ liệu mới nhất, rà sống lại port ngay trước khi ghi (tránh
      đụng độ), tạo `circuits` + `port_circuit_links` + cập nhật
      `ports.status='in_use'`, gắn `mirror_of_id` — chiều XÓA đã tự động qua
      cascade có sẵn từ mục 33 (`findMirrorTrunkCircuits`/
      `cleanupAfterMirrorCascade`), không cần sửa thêm gì cho "xóa".
    - Gắn gọi `autoCreateTrunkMirrorForCircuit()` NGAY TRONG
      `autoMirrorAfterSave()` đã có ở mục 38 (cùng 1 wrapper, gọi CẢ 2 loại
      mirror — thiết bị-thiết bị VÀ thiết bị-trung kế — cho mỗi luồng vừa
      lưu; loại nào không khớp thì tự trả "no-gap", vô hại) trong CẢ
      `submitCreate()` lẫn `saveEdit()`.
    - Trunk-trunk qua `PortTable.tsx` **đã sửa luôn cùng lúc, không đợi ca
      báo riêng** — xem mục 40 ngay dưới đây.
    - **Kiểm chứng**: `tsc --noEmit` sạch. `sync-missing-trunk-circuits` dry
      run lại còn 0 ứng viên (xác nhận refactor không đổi hành vi). Curl
      `/odf-device/sua-luong`, `/odf-trunk`, `/data-quality` đều 200.

40. **Trunk-trunk (PortTable.tsx) — sửa luôn, không đợi "ca báo thật"** —
    người dùng phản ứng thẳng khi thấy mục 39 vẫn ghi "chưa làm, để dành sửa
    khi có ca báo thật": "khi nào thì mới sửa ca thật, chứ nói mới làm à".
    Đúng — đây là CÙNG 1 bug đã xác nhận ở mục 38/39 (cơ chế tạo mirror chỉ
    chạy qua script, chưa gắn UI), không cần đợi thêm 1 ca cụ thể mới sửa.
    - Thêm `autoCreateTrunkTrunkMirrorForCircuit()`
      (`lib/mirrorTrunkCircuits.ts`) — khác 2 hàm auto-mirror trước ở chỗ
      NGUỒN là 1 luồng TRUNG KẾ đã có port thật (không phải luồng thiết bị):
      tự tra `port_circuit_links` của circuit vừa lưu để biết (các) port
      nguồn, đọc `transit_links.raw_text` tương ứng, khớp qua
      `matchBareTrunkLink()` xem có trỏ sang 1 port trung kế THẬT khác đang
      trống không — cùng tinh thần rà sống trước khi ghi + gắn `mirror_of_id`
      như 2 hàm kia. Không đọc lại toàn bộ `transit_links` như
      `sync-missing-trunk-trunk-circuits.ts` (script vẫn giữ để rà soát hàng
      loạt/backfill dữ liệu cũ) — chỉ cần đúng port của 1 circuit vừa lưu,
      đủ và nhanh cho 1 lượt lưu đơn lẻ.
    - Gắn gọi hàm này ngay sau khi lưu "Chuyển tiếp" trong `saveEdit()`
      (`PortTable.tsx`) — không chặn việc lưu dù bước này lỗi, chỉ báo lỗi
      mềm, cùng tinh thần `maybeStandardizeTransitDevice()` đã có sẵn ngay
      phía trên.
    - **Kiểm chứng**: `tsc --noEmit` sạch. `audit-trunk-trunk-sync` vẫn chỉ
      còn đúng 1 ca "3G BTS Vina" đã biết từ trước (xung đột port 6/7, để
      người dùng tự rà tay, không phải bug mới). Curl `/odf-trunk`,
      `/odf-device/sua-luong` đều 200.

41. **Tab mới "Trung kế thiếu bên thiết bị" ở Chất lượng dữ liệu — chiều
    NGƯỢC của mục 38/39** (người dùng đặt câu hỏi giả định "trung kế đã đúng,
    Hồ sơ đấu nối thiết bị chưa cập nhật thì xử lý sao", rồi yêu cầu xây
    luôn ngay trong buổi, không đợi ca thật — xem hội thoại 2026-07-31).
    - **Cách phát hiện** (`lib/reverseDeviceTrunkAudit.ts`,
      `findTrunkCircuitsMissingDeviceMirror()`): dựa vào đúng 1 quy luật đã
      xác nhận nhiều lần (mục 35) — mirror pair LUÔN giữ NGUYÊN tên luồng ở
      cả 2 phía. Quét mọi luồng trung kế có tên chứa đoạn "ADN1.&lt;thiết bị&gt;
      (&lt;trib&gt;)" (khả năng cao liên quan 1 thiết bị local), nếu KHÔNG có luồng
      nào bên domain=device cùng tên CHÍNH XÁC → thiếu mirror.
    - **CỐ Ý KHÔNG tự match/tạo thiết bị nào** (khác hẳn mục 38/39/40) —
      người dùng chỉ rõ rủi ro thật: tên thiết bị ghi trong luồng trung kế có
      thể sai FORMAT (vd "ADN1.MPE8" thay vì đúng chuẩn "ADN1.MPE#8"), tự
      match/tạo sẽ lặp lại đúng bug tạo trùng thiết bị (mục 35,
      PSS64/BB330G). Test trên dữ liệu thật: **268 luồng** rơi vào diện này
      — nhìn sơ đa số là lệch format tên (vd "ASBR2" ghi thay cho
      "ASBR#2-MX2020"), tồn đọng có sẵn từ trước, KHÔNG phải do các thay đổi
      hôm nay gây ra.
    - **UI mới** (`components/data-quality/TrunkMissingDeviceMirrorTab.tsx`,
      tab "Trung kế thiếu bên thiết bị" trong `/data-quality`) — mỗi dòng có:
      link nhảy tới đúng port ở `/odf-trunk`, tên luồng + đoạn thiết bị tách
      được (chỉ để hiển thị/đối chiếu, KHÔNG dùng để match), 1 checkbox xác
      nhận + nút "Xóa" (disabled nếu chưa tick). Đúng ý người dùng: KHÔNG
      tick = "Phương án 2" (mặc định, không đụng gì, tự qua Hồ sơ đấu nối bổ
      sung đúng); TICK rồi bấm Xóa = "Phương án 1" (xóa luồng trung kế cũ để
      giải phóng port).
    - **`deleteTrunkCircuitToResync()`** (`lib/mirrorTrunkCircuits.ts`) — CHỈ
      xóa để giải phóng port, KHÔNG tự "tạo lại" gì cả: khi người dùng sau đó
      tự bổ sung đúng bên Hồ sơ đấu nối (thiết bị chuẩn từ danh mục, đúng
      Trib), `autoCreateTrunkMirrorForCircuit()` (mục 39, đã gắn sẵn ở
      `submitCreate()`/`saveEdit()`) tự động tạo lại mirror trung kế đúng
      chuẩn — không cần thêm code "tạo lại" ở tính năng này. Tái dùng
      `findMirrorTrunkCircuits()`/`cleanupAfterMirrorCascade()` (mục 33) để
      báo trước + dọn đúng các mirror khác (nếu có) sẽ mất theo cascade.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Curl `/data-quality` 200, tab mới
      hiện đúng 268 luồng test trên dữ liệu thật.

42. **Command Palette (Cmd/Ctrl + K)** (`components/ui/CommandPalette.tsx`,
    yêu cầu người dùng 2026-08-01, brief chi tiết) — tìm nhanh nổi lên trên
    mọi trang: gõ tên luồng/mã rack/port/thiết bị → Enter nhảy thẳng tới đúng
    chỗ, không cần rời trang đang làm. Trang `/search` + `SearchClient.tsx`
    giữ nguyên hoàn toàn, không đụng.
    - Mount 1 lần ở `app/layout.tsx` (`<CommandPalette />` ngay dưới
      `<Sidebar />`) — có mặt trên mọi trang.
    - Mở bằng Cmd/Ctrl+K (global keydown, `e.preventDefault()`) HOẶC nút
      "🔍" luôn hiện ở header `Sidebar.tsx` (yêu cầu: không được để tính năng
      chỉ truy cập qua phím tắt) — nút bắn `CustomEvent`
      (`COMMAND_PALETTE_OPEN_EVENT`, export từ chính CommandPalette.tsx) thay
      vì lift state lên `app/layout.tsx` (Server Component, không giữ được
      state) — tránh phải đổi layout.tsx thành "use client" chỉ để truyền 1
      hàm mở giữa 2 Client Component anh em.
    - **Không dùng thư viện `cmdk`** dù brief cho phép — tự viết tay để nhất
      quán với toàn bộ codebase (FilterInput/SlideOverPanel/GroupedMultiSelect/
      SearchableSelect đều tự viết, chưa có dependency UI ngoài nào). Điều
      hướng bàn phím dồn hết vào Ô INPUT (role="combobox", ↑/↓/Enter xử lý ở
      `onKeyDown` của input) thay vì focus rời sang từng dòng kết quả — cách
      này tự nhiên "bẫy focus" trong panel (chỉ có đúng 1 phần tử focus được),
      không cần code focus-trap riêng. Dòng kết quả `role="option"` +
      `aria-activedescendant`/`aria-selected` cho a11y.
    - **Nạp dữ liệu LƯỜI đúng yêu cầu**: `useEffect` chỉ gọi
      `fetchAllTrunkPorts()` + `fetchDevices()` khi `open` LẦN ĐẦU (gate qua
      `loadedOnceRef`), cache lại trong state cho các lần mở sau — không fetch
      lúc tải trang. Chấp nhận dữ liệu có thể cũ nếu vừa sửa ở tab khác trong
      CÙNG phiên (đúng brief, chưa làm nút "làm mới" ở v1).
    - **Xếp hạng 2 tầng** (`fieldScore`/`bestScore`) — tái dùng `matchesFilter`
      (mục lọc-có-khớp-không) rồi PHÂN HẠNG thêm qua `normalizeVN` (0=khớp
      chính xác, 1=bắt đầu bằng query, 2=chứa ở đâu đó), tránh brief chỉ nói
      "tận dụng matchesFilter" (vốn chỉ trả boolean, không đủ để xếp hạng).
    - **4 loại kết quả**, gom từ `fetchAllTrunkPorts()` (đã có sẵn port+circuit
      +rack) qua 1 lượt group-by (Map theo `rackId`/`circuit.id`, chỉ tính lại
      khi data đổi, KHÔNG tính lại mỗi phím gõ):
      - **Rack**: mỗi rack trung kế 1 dòng, khớp theo `rackCode`/`cableRouteName`.
      - **Luồng**: gom các port CÙNG `circuit.id` (vd cặp tx/rx) thành 1 dòng,
        khớp theo tên luồng/đối phương/rackCode/số port-sợi, hiện trạng thái
        qua `derivePortStatus`.
      - **Port**: CHỈ port TRỐNG (circuit=null) — port đã có luồng đã gom vào
        loại "Luồng" ở trên, tránh 2 dòng cho cùng 1 port vật lý.
      - **Thiết bị**: từ bảng `devices`, khớp theo tên.
    - Điều hướng: Rack → `/odf-trunk/<rackId>`; Luồng/Port → `/odf-trunk/
      <rackId>#port-<portId>` (tái dùng ĐÚNG cơ chế cuộn-tới-port đã có ở
      `PortTable.tsx`); Thiết bị → `/devices` (chưa cuộn tới đúng dòng — khảo
      sát `DeviceCategoryClient.tsx` chưa có anchor theo dòng như
      `DeviceCircuitList.tsx` đã có, để dành làm sau nếu cần, đúng brief cho
      phép "nếu không chắc thì cứ điều hướng, ghi chú lại").
    - **Kiểm chứng**: `tsc --noEmit` sạch. `git status` xác nhận
      `app/search/page.tsx`/`SearchClient.tsx`/`DeviceCategoryClient.tsx`
      không hề bị đụng. Curl `/`, `/odf-trunk`, `/devices`, `/search` đều 200,
      không lỗi compile khi mount CommandPalette toàn cục.

43. **`device_aliases` — bảng mapping "nhiều cách gõ = 1 thiết bị"** (yêu cầu
    người dùng 2026-08-01, Giai đoạn 1 trong 2 giai đoạn người dùng đề xuất) —
    lỗ hổng thật: `maybeStandardizeTransitDevice()` và ô "Thiết bị" trong
    `EditRow` (`PortTable.tsx`) trước đây chỉ so khớp CHÍNH XÁC sau chuẩn hóa
    (`normalizeDeviceNameKey`), nên "ADN1.MPE8" và "ADN1.MPE#8" bị coi là 2
    thiết bị khác nhau — gõ khác 1 chút là tạo trùng thiết bị ngay (đúng rủi
    ro từng gặp thật với PSS64/BB330G, xem mục 31), không có gợi ý "có phải ý
    bạn là..." nào cả.
    - **Migration `20260801000001_device_aliases.sql`** — bảng
      `device_aliases(id, device_id FK→devices on delete cascade, alias_text,
      normalized_key unique, created_at)`. Mỗi dòng là 1 cách gõ đã được
      NGƯỜI DÙNG xác nhận là cùng 1 thiết bị thật (không tự động suy luận ghi
      vào bảng này).
    - **`looseDeviceNameKey()` (mới, `lib/deviceNotes.ts`)** — khóa so khớp
      "lỏng" hơn `normalizeDeviceNameKey()`, dùng RIÊNG cho gợi ý (không dùng
      để tự động áp dụng). Thuật toán (theo đúng ví dụ người dùng cho): tách
      chuỗi thành các đoạn CHỮ/SỐ liên tiếp bằng regex `/[a-z]+|[0-9]+/g`
      TRƯỚC (mọi ký tự khác chữ/số — `#`, `-`, `/`, khoảng trắng — tự nhiên
      thành ranh giới đoạn), RỒI MỚI bỏ số 0 thừa ở đầu mỗi đoạn số. Tách đoạn
      trước khi bỏ số 0 là điểm mấu chốt an toàn: "PSS24#1" → `["pss","24","1"]`
      còn "PSS241" (nếu có thật) → `["pss","241"]` — 2 khóa khác nhau, không
      gộp nhầm 2 thiết bị có tên số liền nhau thật chỉ vì thiếu dấu phân cách.
      Khớp đúng theo yêu cầu: "MPE#4" = "MPE4" = "MPE04" = "MPE#04";
      "PSS24#1/BB1" = "PSS24#1 BB1" = "PSS24#01/BB1" = "PSS24#01 BB1".
    - **`lib/deviceAliases.ts` (mới)** — `fetchDeviceAliases()` (tải 1 lần
      cho cả trang, bảng nhỏ không cần lazy); `saveDeviceAlias(deviceId,
      aliasText)` (upsert với `ignoreDuplicates:true` — KHÔNG âm thầm cướp 1
      `normalized_key` đã trỏ sang thiết bị khác nếu chẳng may trùng, an toàn
      hơn upsert ghi đè); `resolveDeviceByExactOrAlias()` (khớp chính xác rồi
      tới alias đã biết — im lặng nhận ra ngay, KHÔNG hỏi lại); `find
      LooseDeviceCandidate()` (chỉ trả gợi ý khi ra ĐÚNG 1 ứng viên — ≥2 ứng
      viên nghĩa là mơ hồ, không tự đoán).
    - **Tích hợp vào `PortTable.tsx`** (đúng phạm vi người dùng nêu — CHỈ ô
      "Thiết bị" bên "Chuyển tiếp" trung kế, chưa đụng `DeviceCircuitList.tsx`):
      - `app/odf-trunk/[rackId]/page.tsx` tải thêm `fetchDeviceAliases()`,
        truyền prop `deviceAliases` xuống `PortTable`/`EditRow`.
      - `matchedDevice` (ô "Thiết bị") đổi sang gọi `resolveDeviceByExactOrAlias()`
        thay vì tự so khớp — 1 alias đã lưu tự nhận ra ngay từ lần gõ tiếp
        theo, không còn hiện "chưa có" nữa.
      - Khi KHÔNG khớp chính xác/alias (vẫn sẽ hiện "chưa có trong hồ sơ")
        VÀ `findLooseDeviceCandidate()` ra đúng 1 ứng viên → hiện thêm nút
        "💡 Có thể là thiết bị đã có: ... — bấm để dùng thiết bị này" ngay
        trên dòng "chưa có". Bấm → áp tên thiết bị đã chọn + gọi
        `saveDeviceAlias()` lưu lại cách gõ vừa rồi làm alias (không chặn UI
        nếu lưu alias lỗi, chỉ ảnh hưởng lần gợi ý sau).
      - `maybeStandardizeTransitDevice()` (chạy sau khi Lưu "Chuyển tiếp",
        đúng cơ chế cũ) — thêm nhánh: nếu không khớp chính xác/alias, thử
        `findLooseDeviceCandidate()` TRƯỚC khi hỏi "Tạo thiết bị mới?" — có
        ứng viên thì đổi `confirm()` thành 2 lựa chọn (OK = dùng thiết bị đã
        có + lưu alias, Cancel = tạo mới như cũ); không có ứng viên thì giữ
        nguyên hành vi cũ 100%.
    - **Chưa làm (Giai đoạn 2, để sau khi bảng có dữ liệu thật)**: gợi ý theo
      alias đã biết ở khung "Chuyển tiếp"/`data-quality`, và 1 thao tác
      "Đồng bộ" quét toàn bộ chỗ đang dùng đúng `alias_text` đó để tự cập
      nhật về tên chuẩn (thay vì phải sửa từng luồng như hiện tại).
    - **QUAN TRỌNG — cần người dùng tự chạy migration** (như mọi lần trước,
      môi trường này không có Postgres connection string/Supabase CLI để tự
      áp DDL): đã thử trước khi chạy migration, `/odf-trunk/<rackId>` lỗi 500
      đúng dự kiến (`PGRST205 — Could not find the table 'public.device_aliases'`)
      — hết ngay sau khi chạy xong SQL qua Supabase Dashboard (người dùng đã
      chạy 2026-08-02, xác nhận trang 200 trở lại).
    - **Kiểm chứng lần 1**: `tsc --noEmit` sạch. Rà thật 138 devices: 0 nhóm
      bị gộp sai, khớp đúng 100% trên 5 mẫu thiết bị thật gõ mô phỏng sai kiểu.
    - **Theo dõi ngay sau đó (cùng ngày, người dùng tự test UI thật)**: gõ
      "ADN1.OMEMSPP#01" ở rack ODF1/1 port 31 KHÔNG ra gợi ý, dù thiết bị thật
      đã có sẵn là "ADN1.OME-MSPP#1 RMT2" — 2 lỗ hổng của thuật toán ban đầu:
      (1) "OME"+"MSPP" bị tách rời do có dấu "-" trong tên thật nhưng KHÔNG có
      dấu trong chữ gõ (2 đoạn CHỮ liên tiếp không được gộp lại); (2) tên thật
      còn hậu tố "RMT2" mà chữ gõ tắt hoàn toàn không có (thiếu thông tin,
      không phải sai định dạng).
      - **Sửa `looseDeviceNameSegments()`** (đổi tên từ `looseDeviceNameKey`,
        hàm cũ giữ lại dạng `.join(" ")` của hàm mới, không phá API cũ) — gộp
        các đoạn CHỮ liên tiếp (không có đoạn số chen giữa) thành 1, CHỈ đoạn
        chữ (đoạn số vẫn tách riêng như cũ, giữ nguyên an toàn PSS24#1 ≠
        PSS241).
      - **Thêm luật "tiền tố"** trong `findLooseDeviceCandidate()`
        (`lib/deviceAliases.ts`) — nếu đoạn hóa chữ gõ là TIỀN TỐ đúng thứ tự
        (so mảng, không so chuỗi — tránh lỗi biên "1" là tiền tố chuỗi của
        "12") của 1 thiết bị có nhiều đoạn hơn, vẫn gợi ý được dù thiếu hậu
        tố. An toàn: nếu ≥2 thiết bị cùng khớp tiền tố → tự động KHÔNG gợi ý
        gì (mơ hồ).
      - **Kiểm chứng lại trên dữ liệu thật**: ca thật "ADN1.OMEMSPP#01" nay
        gợi ý đúng "ADN1.OME-MSPP#1 RMT2" (phân biệt đúng với thiết bị anh em
        "ADN1.OME-MSPP#3 RMT1", không lẫn — vì đoạn số ngay sau tên gộp khác
        nhau, 1 ≠ 3). Rà lại toàn bộ 136 thiết bị (giả lập gõ tắt = 2 đoạn đầu
        liền không dấu cho MỖI thiết bị, kiểm tra có tự khớp đúng lại chính nó
        không): 62 khớp đúng, 61 mơ hồ tự động không gợi ý (an toàn), **0 ca
        khớp NHẦM sang thiết bị khác**.

44. **Tab mới "Luồng chưa liên kết mirror" ở Chất lượng dữ liệu — LOẠI THỨ 3
    của "chưa đồng bộ"** (người dùng hỏi cụ thể ca thật `ADN1.OMS3255(1/9/2)`
    ↔ `ODF 1/1 (41,42)` 2026-08-02, "bản chất là cùng một luồng mà") — kiểm
    tra xác nhận ĐÚNG là 1 luồng vật lý (own/next khớp gần như tuyệt đối 2
    phía), nhưng `mirror_of_id` cả 2 dòng đều `null`.
    - **Vì sao chưa từng được tự đồng bộ**: khác hẳn mục 38/39/40 (port đích
      TRỐNG → tự tạo được ngay), ở đây CẢ 2 PHÍA đã có sẵn 1 luồng ĐỘC LẬP
      (import từ Excel gốc, trước khi có cột `mirror_of_id`). `findTrunkMirror
      Candidates()` (`lib/mirrorTrunkCircuits.ts`) đang coi "port đã bị chiếm
      = đã đồng bộ", không kiểm tra xem luồng chiếm chỗ đó có ĐÚNG là mirror
      của luồng thiết bị không — bỏ qua thẳng, không báo gì.
    - **Rà thử toàn bộ dữ liệu (chỉ đọc)**: **207 cặp** thuộc loại này. Xem
      mẫu thật: phần lớn tên 2 bên khớp gần tuyệt đối (chỉ khác dấu/định dạng,
      giống hệt ca OMS3255) nhưng có 1 số cặp tên 2 bên **khác hẳn nhau** (vd
      "100GE AĐN1.DPI#1 (Bypass...)" trùng port với 1 luồng tên hoàn toàn khác
      không liên quan) — nhiều khả năng là port bị dùng lại/dữ liệu cũ, KHÔNG
      phải cùng luồng thật. Gắn `mirror_of_id` nhầm sẽ khiến xóa 1 bên tự xóa
      lây bên kia (`on delete cascade`, mục 33) dù 2 luồng không liên quan —
      **rủi ro cao nếu tự động liên kết hàng loạt**.
    - **Đã hỏi người dùng chọn hướng xử lý** (3 lựa chọn: tự động hết / tự
      động phần khớp rất cao + để tay phần còn lại / chỉ sửa đúng ca vừa hỏi)
      — người dùng chọn **"Xây tab rà + tick xác nhận từng cặp"**, cùng tinh
      thần tab "Trung kế thiếu bên thiết bị" (mục 41): liệt kê hết, không tự
      quyết định, người dùng tự soi rồi tick xác nhận TỪNG cặp.
    - **`lib/unlinkedMirrorPairs.ts` (mới)**:
      - `findUnlinkedMirrorPairs(trunkPorts, deviceCircuits)` — với mỗi luồng
        thiết bị CHƯA phải là mirror của cái khác (`mirrorOfId` null, field
        mới thêm vào `DeviceCircuitRow`/`fetchDeviceCircuits()` —
        `lib/deviceCircuits.ts`), thử khớp own/next qua `matchTrunkPosition()`
        y hệt `findTrunkMirrorCandidates()`, nhưng KHÔNG bỏ qua port đã
        `inUse` (ngược lại, chỉ quan tâm port ĐANG bị chiếm) — tra 1 lượt
        `mirror_of_id` thật của các luồng trung kế ứng viên (`TrunkPortRow`
        không mang field này), loại cặp đã liên kết đúng hoặc liên kết sang
        luồng khác.
      - **% giống tên** (`fastest-levenshtein`, đã là dependency có sẵn từ
        `lib/deviceDedup.ts`) — chuẩn hóa tên qua `normalizeVN` + bỏ hết ký tự
        không phải chữ/số trước khi tính khoảng cách, ra % giống nhau
        (0-100). **CHỈ để SẮP XẾP/gợi ý độ tin cậy cho người dùng tự soi**,
        không phải ngưỡng tự động quyết định gì — sắp xếp cao xuống thấp.
      - `linkMirrorPair(deviceCircuitId, trunkCircuitId)` — `UPDATE circuits
        SET mirror_of_id = deviceCircuitId WHERE id = trunkCircuitId`, đúng
        chiều "thiết bị = gốc, trung kế = mirror" như `autoCreateTrunkMirror
        ForCircuit()` (mục 39). KHÔNG xóa/đổi gì khác — chỉ gắn 1 cột FK.
    - **`components/data-quality/UnlinkedMirrorPairsTab.tsx` (mới)** — tab
      thứ 5, cùng pattern tick-xác-nhận-rồi-mới-bấm-được của
      `TrunkMissingDeviceMirrorTab.tsx` (mục 41): mỗi dòng hiện % giống tên
      (huy hiệu màu — xanh lá ≥90%, vàng ≥60%, đỏ <60%), 2 tên đầy đủ để tự
      đối chiếu, link nhảy tới đúng port trung kế, tick "Xác nhận là 1 luồng"
      rồi mới bấm được "Liên kết". **Không có nút liên kết hàng loạt.**
    - **`app/data-quality/page.tsx`/`DataQualityClient.tsx`**: gọi
      `findUnlinkedMirrorPairs(trunkPorts, circuits)` (dùng lại đúng
      `trunkPorts`/`circuits` đã tải sẵn cho các khung khác, không fetch
      thêm), thêm tab thứ 5 "Luồng chưa liên kết mirror" vào thanh tab (đổi
      `flex gap-1` → `flex flex-wrap gap-1` vì đủ 5 tab có thể tràn dòng ở
      màn hình hẹp).
    - **Kiểm chứng qua chính hàm thật** (không phải script rà thử sơ bộ ban
      đầu): `tsc --noEmit` sạch. Chạy `findUnlinkedMirrorPairs()` trên dữ liệu
      thật: đúng 207 cặp, ca OMS3255 hiện đúng similarity=100%. Phân bố: 40
      cặp ≥90% (gần chắc chắn đúng), 102 cặp 60-89%, 65 cặp <60% (nhiều khả
      năng port dùng lại, cần soi kỹ trước khi tick) — đúng dự kiến, xác nhận
      thuật toán an toàn (không tự quyết định gì, chỉ xếp hạng).
    - **Hạn chế đã biết, chưa xử lý**: % giống tên dựa Levenshtein theo THỨ TỰ
      ký tự — 1 số cặp ĐÚNG là cùng luồng nhưng thứ tự "A - B" đảo thành "B -
      A" (vd "GE AĐN1.PE#2 (4/3/5) - GIÁM SÁT NOC3" ↔ "GIÁM SÁT NOC3 -
      ADN1.PE2(4/3/5)") bị tính % thấp dù đúng — không sửa vì UI đã nói rõ "%
      chỉ để gợi ý", người dùng vẫn tự đọc được cả 2 tên đầy đủ để tự quyết
      định dù % thấp.
    - **Theo dõi ngay sau đó (cùng ngày)**: người dùng hỏi lại "Liên kết thì
      có đẩy dữ liệu qua lại 2 đầu không?" — xác nhận KHÔNG, hành vi gốc chỉ
      gắn `mirror_of_id`, không đụng nội dung. Người dùng xác nhận muốn thêm
      lựa chọn đồng bộ. Đã thêm:
      - `linkMirrorPair(deviceCircuitId, trunkCircuitId, syncNameFrom?:
        "device"|"trunk")` — mặc định `undefined` (KHÔNG đồng bộ, giữ nguyên
        hành vi gốc). Nếu truyền, đọc `name`+`interface_type` từ bên NGUỒN,
        ghi đè sang bên CÒN LẠI. **Chỉ 2 trường này** — không đụng
        `counterpart_text`/`response_plan_text`/`execution_station_text`/
        `notes`/`trib_text`/`device_position_own`/`device_position_next` vì
        các trường đó chỉ có nghĩa RIÊNG theo từng domain (vd
        `device_position_own` bên thiết bị không có khái niệm tương ứng bên
        trung kế), khác `name`/`interface_type` vốn mô tả CÙNG 1 khái niệm ở
        cả 2 domain.
      - `UnlinkedMirrorPairsTab.tsx` — thêm `deviceInterfaceType`/
        `trunkInterfaceType` vào hiển thị (2 dòng tên nay kèm giao tiếp trong
        ngoặc). CHỈ hiện 3 lựa chọn radio ("Không đồng bộ" mặc định / "Dùng
        tên bên thiết bị" / "Dùng tên bên trung kế") khi 2 tên khác nhau —
        giống hệt tên thì không cần hỏi. Lựa chọn đi kèm ngay khi bấm "Liên
        kết", không phải bước riêng.
    - **Kiểm chứng**: `tsc --noEmit` sạch, `/data-quality` vẫn 200.

45. **Tab mới "Thiết bị-Thiết bị chưa liên kết" — LOẠI 4, cùng ngày** (người
    dùng chỉ ra ngay sau khi xong mục 44: "Còn trường hợp đấu nối giữa 02
    thiết bị nữa") — CÙNG BẢN CHẤT lỗ hổng nhưng cho cặp luồng THIẾT BỊ-THIẾT
    BỊ (cả 2 đầu đều local ADN1, mục 38) thay vì thiết bị-trung kế.
    - **Vì sao chưa từng được tự đồng bộ**: `findMissingDeviceMirrors()`
      (`lib/deviceDeviceSync.ts`, mục 38) coi "thiết bị đích đã có luồng khớp
      Trib" = "đã đồng bộ" (`if (targetOwnTribs.has(targetTribKey)) continue`),
      không kiểm tra luồng khớp Trib đó có ĐÚNG là mirror (`mirror_of_id` trỏ
      đúng) hay chỉ là 2 dòng độc lập từ Excel gốc tình cờ khớp thiết bị+Trib
      — y hệt lý do mục 44, khác domain.
    - **Rà thật trên toàn bộ dữ liệu**: **442 cặp DUY NHẤT** (quét 2 chiều —
      mỗi luồng đều có thể là "nguồn" hướng sang thiết bị kia — khử trùng qua
      cặp id đã sắp xếp, xác nhận đúng 442 không lệch). Phân bố % giống tên
      **sạch hơn hẳn** loại device-trunk (mục 44): 439/442 cặp ≥90% (gần như
      chắc chắn đúng), chỉ 2 cặp 60-89%, 1 cặp <60% — vì cả 2 domain đều LOCAL
      ADN1 nên tên luồng ít bị format lại khác nhau như phía trung kế.
    - **`lib/unlinkedMirrorPairs.ts` mở rộng** (không tạo file riêng — cùng
      nhóm chức năng "liên kết mirror còn thiếu"):
      - Tách `applyMirrorLink(originId, mirrorId, syncFrom?)` làm lõi DÙNG
        CHUNG cho cả `linkMirrorPair()` (mục 44) lẫn `linkDeviceDevicePair()`
        (mới) — tránh viết lại 2 lần cùng logic "gắn mirror_of_id + tùy chọn
        đồng bộ tên/giao tiếp" rồi lệch nhau.
      - `findUnlinkedDeviceDevicePairs(deviceCircuits, devices)` — THUẦN HÀM
        (không query DB, khác `findUnlinkedMirrorPairs` cần 1 lượt tra riêng)
        vì `DeviceCircuitRow.mirrorOfId` đã có sẵn cho CẢ 2 phía. Logic dò y
        hệt `findMissingDeviceMirrors()` (dùng lại `splitOdfDeviceStructure`/
        `normalizeDeviceNameKey`/`normalizeDevicePositionKey`) nhưng KHÔNG bỏ
        qua khi đã có luồng chiếm Trib — ngược lại chỉ quan tâm ca đó, rồi lọc
        tiếp bằng `occupant.mirrorOfId` (đã liên kết thì bỏ qua).
      - `linkDeviceDevicePair(circuitAId, circuitBId, syncNameFrom?: "a"|"b")`.
    - **`components/data-quality/UnlinkedDeviceMirrorPairsTab.tsx` (mới)** —
      y hệt `UnlinkedMirrorPairsTab.tsx` (huy hiệu % giống tên, tick-xác-nhận-
      rồi-mới-Liên-kết, 3 lựa chọn đồng bộ tên khi 2 tên khác nhau) nhưng cả 2
      cột đều link tới `/odf-device/sua-luong#${rowAnchor(circuitId)}` (không
      có rack/port như bên trung kế).
    - **`app/data-quality/page.tsx`/`DataQualityClient.tsx`**: tab thứ 6
      "Thiết bị-Thiết bị chưa liên kết" (đổi tên tab mục 44 thành "Thiết bị-
      Trung kế chưa liên kết" cho rõ phân biệt 2 tab).
    - **Kiểm chứng qua chính hàm thật**: `tsc --noEmit` sạch. Chạy
      `findUnlinkedDeviceDevicePairs()` trên dữ liệu thật: đúng 442 cặp, xác
      nhận KHÔNG có cặp id nào bị đếm trùng theo 2 chiều (442 cặp id duy nhất
      = 442 kết quả). `/data-quality` vẫn 200.
    - **Theo dõi ngay sau đó (cùng ngày)**: người dùng chỉ ra bấm link ở BẤT
      KỲ tab con nào trong "Chất lượng dữ liệu" đều điều hướng CÙNG TAB trình
      duyệt sang `/odf-trunk/<rackId>` hoặc `/odf-device/sua-luong` — sửa xong
      phải bấm "← Danh sách rack" rồi tự chuyển lại đúng tab con đang rà, rất
      mất công khi rà nhiều dòng liên tiếp. Đổi TẤT CẢ link trong các khung
      con của trang này (`TrunkMissingDeviceMirrorTab`, `UnlinkedMirrorPairsTab`,
      `UnlinkedDeviceMirrorPairsTab`, `CircuitLinkList`/`PositionConflictsTab`
      trong `DataQualityClient.tsx`) thành `target="_blank"` — bấm mở TAB
      TRÌNH DUYỆT MỚI để sửa, đóng tab đó là quay lại nguyên trạng thái tab
      "Chất lượng dữ liệu" (đang lọc gì/đang xem tab con nào vẫn giữ nguyên,
      vì tab gốc chưa từng điều hướng đi đâu).
      - **`TransitFormatWarning.tsx`** (dùng chung 3 nơi: `/odf-trunk`,
        `/odf-trunk/[rackId]`, VÀ trong `DataQualityClient.tsx`) — thêm prop
        `openInNewTab?: boolean` (mặc định `undefined`/tắt) thay vì đổi cứng
        hành vi chung, vì 2 nơi gọi kia đang xem ĐÚNG rack/danh sách liên quan
        rồi, mở thêm tab mới ở đó không cần thiết (thậm chí hơi thừa). CHỈ
        `DataQualityClient.tsx` truyền `openInNewTab` (giá trị `true`).
      - **Kiểm chứng**: `tsc --noEmit` sạch. Curl cả 3 trang dùng
        `TransitFormatWarning` (`/odf-trunk`, `/odf-trunk/<rackId>`,
        `/data-quality`) đều 200 — xác nhận prop mặc định tắt không phá 2 nơi
        gọi cũ.
    - **Ca thật nhân tiện phát hiện + sửa luôn**: người dùng hỏi cụ thể ca
      `ADN1.CGNAT#2 (5/1/2)` ↔ `ODF1/10 (21,22)` — hóa ra KHÔNG thuộc loại
      "chưa liên kết" (mục 44/45, cần cả 2 bên đã tồn tại) mà thuộc loại
      "THIẾU HẲN" (mục 39, port đích đang TRỐNG) — luồng thiết bị này chưa
      từng được lưu lại kể từ khi cơ chế tự tạo mirror ra đời. Chạy
      `npm run audit-device-trunk-sync`/`audit-trunk-trunk-sync`/`audit-
      device-device-sync` xác nhận đây là **ca DUY NHẤT** còn thiếu loại
      device-trunk (1/1) trong toàn bộ dữ liệu (2 audit kia vẫn còn đúng 1
      ca trunk-trunk "3G BTS Vina" + 4 ca Trib-lệch đã biết từ trước, chưa
      đụng — để dành người dùng tự sửa tay như đã thống nhất). Chạy `npm run
      sync-missing-trunk-circuits -- --commit` tạo đúng 1 luồng còn thiếu,
      audit lại xác nhận 0 lượt.

46. **Huy hiệu "🔗 Đã liên kết"/"⚠️ Chưa liên kết" NGAY trên từng dòng port/
    luồng** (yêu cầu người dùng 2026-08-02, sau ca CGNAT#2 ở trên: "làm sao
    biết được 02 bên này là 01 luồng; đã liên kết hay chưa hay vẫn rời rạc")
    — trước đó chỉ biết được qua 2 tab riêng ở `/data-quality`, phải rời
    trang đang xem mới tra được.
    - **`lib/trunkPorts.ts`**: `TrunkPortRow.circuit` thêm field
      `mirrorOfId` (select thêm `circuits.mirror_of_id`) — dùng chung cho cả
      huy hiệu mới lẫn ĐƠN GIẢN HÓA `findUnlinkedMirrorPairs()` (mục 44):
      hàm đó trước phải tự query riêng `mirror_of_id` của luồng trung kế ứng
      viên (vì `TrunkPortRow` chưa mang field này) — giờ đọc thẳng từ
      `trunkPorts` đã tải sẵn, bớt hẳn 1 round-trip Supabase mỗi lần tính (áp
      dụng luôn cho cả 2 nơi đang gọi hàm này: `/data-quality` và trang rack
      chi tiết mới thêm ở mục này).
    - **`lib/mirrorLinkStatus.ts` (mới)** — `computeMirrorLinkStatuses()`
      THUẦN HÀM (không query DB gì thêm): tính tập "id được tham chiếu làm
      gốc" từ `mirrorOfId` có sẵn trên CẢ `trunkPorts` lẫn `deviceCircuits`,
      rồi gán "linked" cho luồng nào tự có `mirrorOfId` HOẶC nằm trong tập
      đó (là gốc); gán "candidate" cho luồng nằm trong kết quả
      `findUnlinkedMirrorPairs`/`findUnlinkedDeviceDevicePairs` (mục 44/45)
      mà chưa được gán "linked". Trả `Record<string, MirrorLinkStatus>`
      (không phải `Map`) vì phải truyền qua ranh giới Server Component ->
      Client Component (props phải serialize được).
    - **`components/ui/MirrorLinkBadge.tsx` (mới)** — huy hiệu nhỏ dùng
      chung, nhận `status: "linked"|"candidate"|undefined`, không hiện gì
      nếu `undefined` (không phải lỗi, chỉ là không có vị trí liên quan để
      đối chiếu).
    - **Gắn vào 2 nơi**:
      - `app/odf-trunk/[rackId]/page.tsx` — thêm `fetchDeviceCircuits()`
        (trước đây trang này KHÔNG tải), chạy `findUnlinkedMirrorPairs`/
        `findUnlinkedDeviceDevicePairs`/`computeMirrorLinkStatuses`, truyền
        `mirrorLinkStatuses` xuống `PortTable.tsx` — hiện ngay dưới tên
        luồng ở cột "Tên luồng" (bảng danh sách, không phải form Sửa).
      - `app/odf-device/sua-luong/page.tsx` → `DeviceCircuitList.tsx` — y
        hệt, mọi dữ liệu cần (`circuits`/`devices`/`trunkPorts`) ĐÃ tải sẵn
        từ trước cho mục đích khác, chỉ thêm bước tính. Hiện ngay dưới tên
        luồng ở cột "Tên luồng".
    - **Kiểm chứng**: `tsc --noEmit` sạch. Curl `/odf-trunk/<rackId>` và
      `/odf-device/sua-luong` đều 200, thời gian tải không lệch đáng kể so
      với `/data-quality` (trang đã làm việc tương đương từ trước) — không
      thêm round-trip Supabase nào ngoài 1 lượt tải `deviceCircuits` mới ở
      trang rack (trang kia đã tải sẵn). Xác nhận trên dữ liệu thật: port
      CGNAT#2 vừa liên kết ở mục 45 hiện đúng "🔗 Đã liên kết", các port khác
      trong cùng rack hiện đúng "⚠️ Chưa liên kết" khớp với danh sách candidate
      thật.

47. **Tab mới "Chuyển tiếp sai tọa độ ODF" ở Chất lượng dữ liệu — LOẠI THỨ 5
    của "chưa đồng bộ"** (báo lỗi + xây 2026-08-02, sau khi người dùng chỉ ra
    ca thật ADN1.P2(2/1/2): "từ thiết bị ... -> ODF 9/14 (25,26) -> ODF 1/13
    (11,12) còn từ phía trung kế thì ODF 1/13 (11,12) -> ODF 9/12/21,22 ->
    ADN1.P2 (2/1/2) ==> Không đúng").
    - **Gốc rễ (xác nhận bằng dữ liệu thật, không phải bug cơ chế liên kết)**:
      khác 4 loại "chưa đồng bộ" trước (mục 38/39/40 = thiếu hẳn tự sinh khi
      trống; mục 44/45 = cả 2 bên đã có nhưng chưa gắn `mirror_of_id`) — đây
      là loại hoàn toàn khác: bản thân **ô "Chuyển tiếp" (`transit_links.
      raw_text`) ghi SAI phần tọa độ ODF**, dù phần tên thiết bị/trib đúng.
      Ca P2: luồng thiết bị (`circuits.device_position_own`/`_next`) ghi đúng
      "ODF 9/14 (25,26)" (khớp `device_position_map`, và đúng bằng vị trí vật
      lý luồng trung kế thật đang chiếm ODF1/13(11,12)) — nhưng
      `transit_links.raw_text` tại chính port ODF1/13(11) lại ghi "ODF
      9/12/21,22 - AĐN1.P2 (2/1/2)": "ODF9/12(21,22)" hóa ra là tọa độ của
      **1 trib KHÁC của chính P2** (3/1/6, theo `device_position_map`) — gần
      như chắc chắn gõ nhầm/copy nhầm dòng lúc nhập liệu gốc từ Excel (các số
      lệch nhẹ, không phải nhầm hẳn sang thiết bị khác).
    - **`lib/transitPositionMismatches.ts` (mới)**:
      - `findTransitPositionMismatches(devicePositionMap)` — quét TOÀN BỘ
        `transit_links` (rack nguồn phải domain='trunk', dùng lại đúng cách
        phân trang/embed FK như `fetchNonConformingTransitLinks`), tách bằng
        `splitOdfDeviceStructure()` (đã có), so khớp thiết bị+trib với
        `device_position_map` qua `looseDeviceNameSegments` (thuật toán mục
        43, xử lý được mọi biến thể gõ tên) + `normalizeDevicePositionKey`
        cho trib. CHỈ báo khi khớp được **ĐÚNG 1** dòng thư viện cho thiết
        bị+trib đó và tọa độ ODF trong `raw_text` (so bằng dãy số trích ra,
        bỏ qua khác biệt định dạng "/" vs "()") KHÁC tọa độ thư viện — nếu
        khớp nhiều dòng có tọa độ khác nhau (mơ hồ) hoặc không khớp dòng nào
        thì bỏ qua, không đoán đại (đúng nguyên tắc đã dùng ở mục 44/45).
        `device_position_map` có 1952 dòng — **phải phân trang** (`.range()`,
        1000 dòng/lần) khi tải hết bảng, quên bước này lúc viết script rà thử
        ban đầu khiến âm thầm bỏ sót phần lớn kết quả đối chiếu (bài học thực
        tế trong lúc điều tra, xem thêm mục lỗi tương tự "PostgREST giới hạn
        1000 dòng/query" đã gặp ở nơi khác).
      - `fixTransitLinkPosition(transitLinkId, newRawText)` — ghi đè thẳng
        `raw_text` bằng bản đề xuất (giữ NGUYÊN phần thiết bị/trib, chỉ thay
        phần tọa độ ODF phía trước bằng giá trị `device_position_map` nói
        đúng).
    - **`components/data-quality/TransitPositionMismatchTab.tsx` (mới)** —
      y hệt khuôn tick-xác-nhận-rồi-mới-sửa của mục 44/45 (KHÔNG có nút sửa
      hàng loạt — ghi đè trực tiếp dữ liệu thật của luồng đang chạy, rủi ro
      tương đương): mỗi dòng hiện song song "Đang ghi: ODF9/12(21,22) -
      AĐN1.P2(2/1/2)" (đỏ) vs "Đúng theo Vị trí thiết bị: ODF9/14(25,26) -
      AĐN1.P2(2/1/2)" (xanh), tick "Xác nhận đúng là lỗi" mới bấm được "Sửa
      lại"; link rack/port mở tab mới (`target="_blank"`, đúng yêu cầu mục 46
      "không muốn mất tab đang rà").
    - **Gắn vào `/data-quality`**: `app/data-quality/page.tsx` tải thêm
      `fetchDevicePositionMap()` (đã có sẵn cho trang `/odf-device/vi-tri-
      thiet-bi`, chỉ gọi lại), truyền vào `findTransitPositionMismatches()`;
      `DataQualityClient.tsx` thêm tab thứ 7 "Chuyển tiếp sai tọa độ ODF".
    - **Kiểm chứng**: `tsc --noEmit` sạch. Rà toàn bộ 287 dòng `transit_links`
      dạng "ODF... - Thiết bị (trib)" trên dữ liệu thật: 163 dòng không đối
      chiếu được (trib chưa có trong thư viện), **13 dòng sai tọa độ thật**
      (gồm đúng ca P2(2/1/2) người dùng chỉ ra), còn lại khớp đúng. Curl
      `/data-quality` → tab mới hiện đúng "13 chuyển tiếp sai tọa độ ODF".
      **Chưa bấm "Sửa lại" cho dòng nào** — theo đúng lựa chọn người dùng
      "xây tab rà + tick xác nhận từng dòng", việc sửa thật để người dùng tự
      làm qua UI, không tự động thay họ dù đã xác định rõ ca P2.
    - **SỬA NGAY SAU ĐÓ, cùng ngày** — người dùng hỏi thẳng ca BNG#1(4/0/1):
      "tại sao bạn viết đúng theo vị trí, rồi bạn lấy số liệu này ở đâu ???".
      Truy ngược xác nhận `device_position_map` đến từ đợt import 126 file
      Excel thiết bị gốc (`created_at` khớp mili-giây với batch 2026-07-25,
      KHÔNG suy vòng từ chính transit_links đang xét — dòng transit_links đó
      là dòng DUY NHẤT nhắc tới thiết bị+trib này, giá trị lại khác hẳn thư
      viện) — nhưng người dùng phản hồi đúng: "chưa chắc là device_position_
      map đúng đâu; đúng ra bạn phải để tôi chọn chứ sao áp đặt như vậy được.
      thậm chí cả 2 đều sai và nhập cho đúng lại nữa kia". Bỏ hẳn nhãn "đúng"/
      "sai" (`correctOdfPosition`/`wrongOdfPart` đổi tên trung lập thành
      `libraryOdfPosition`/`transitOdfPart`) — đổi từ 1 nút "Sửa lại" tự động
      ghi đè Chuyển tiếp theo thư viện, sang 3 lựa chọn ngang hàng (radio, ô
      thứ 3 có input tự gõ): (1) Chuyển tiếp đúng → ghi đè NGƯỢC LẠI vào thư
      viện (`applyLibraryFromTransit`, hàm MỚI — trước đây chưa từng có chiều
      này); (2) Vị trí thiết bị đúng → ghi đè Chuyển tiếp (`applyTransitFromLibrary`,
      giữ lại hành vi cũ nhưng không còn tự động); (3) cả 2 đều sai → người
      dùng gõ tọa độ đúng, ghi vào CẢ 2 nơi cho khớp lại (`applyCustomPosition`,
      hàm MỚI). `tsc --noEmit` sạch, curl `/data-quality` vẫn 200 sau khi đổi.

48. **"Kiểm tra 01 luồng" đúng ánh xạ vật lý — thay hẳn cách rà CŨ bị người
    dùng chỉ ra là "không logic"** (yêu cầu người dùng 2026-08-02, ngay sau
    mục 47, dựa trên chính ca ADN1.P2(2/1/2)): cách rà trước đó ở mục 44 (chỉ
    đồng bộ TÊN khi liên kết) và mục 47 (chỉ so 1 CHIỀU giữa Chuyển tiếp với
    thư viện `device_position_map`) đều không đối chiếu TRỰC TIẾP giữa 2 hồ
    sơ theo đúng 3 điểm dữ liệu và đúng ánh xạ vật lý. Người dùng viết rõ ánh
    xạ:
    ```
    [Thiết bị @ trib] --(Vị trí ODF thiết bị = phần ODF trong Chuyển tiếp)-->
    [ODF thiết bị]    --(Vị trí ODF tiếp theo = vị trí port THẬT bên trung kế)-->
    [ODF trung kế, nơi luồng trung kế thật sự nằm]
    ```
    tức Tên luồng so trực tiếp; `device_position_own` so với PHẦN ODF tách từ
    Chuyển tiếp (KHÔNG so cả chuỗi, phần "Thiết bị (port)" trong Chuyển tiếp
    chỉ dùng để XÁC ĐỊNH đúng cặp, không đưa vào Tên luồng); `device_position_
    next` so với vị trí port THẬT (không phải text lưu riêng — luôn suy được
    từ chính vị trí luồng trung kế đang nằm). Áp dụng cho CẢ cặp CHƯA liên kết
    lẫn ĐÃ liên kết (chọn "cả 2" qua AskUserQuestion) — cặp đã liên kết vẫn có
    thể LỆCH nếu 1 bên bị sửa tay sau đó, chưa từng có cơ chế nào bắt được.
    - **`lib/circuitPairSync.ts` (mới)** — lõi dùng chung cho MỌI nơi hiện
      tính năng này:
      - `TrunkPortRow` (`lib/trunkPorts.ts`) thêm `transitText`/`transitLinkId`
        (join thêm `transit_links` vào `fetchAllRawPorts()`) — cần đọc trực
        tiếp Chuyển tiếp của port mà không query riêng.
      - `CircuitPairDetail` — 1 cặp đầy đủ: cả dữ liệu 2 bên (tên, own/next
        thiết bị, tên+trib thiết bị riêng để dựng lại Chuyển tiếp, phần ODF
        tách từ Chuyển tiếp, vị trí port thật dạng chuẩn, id để ghi) LẪN 3 cờ
        diff (`nameMatch`/`ownPositionMatch`/`nextPositionMatch`, `null` =
        không đủ dữ liệu 1 trong 2 bên để so, KHÔNG phải lỗi).
      - `findLinkedDeviceTrunkPairs()` — cặp ĐÃ liên kết (gom port trung kế
        theo `circuit.id`, tra `mirror_of_id` để nối sang đúng luồng thiết bị).
      - `findAllDeviceTrunkPairs()` — gộp CẢ cặp đã liên kết LẪN cặp chưa liên
        kết (tái dùng `findUnlinkedMirrorPairs()` — mục 44 — cho nửa sau,
        KHÔNG viết lại thuật toán khớp vị trí, tránh phân kỳ 2 nơi).
      - `findMismatchedLinkedPairs()` — lọc riêng cặp ĐÃ liên kết nhưng có ≥1
        cờ diff `false` — LOẠI THỨ 6 hoàn toàn mới (đã liên kết vẫn có thể sai).
      - `applySyncFromTrunk(detail)` / `applySyncFromDevice(detail)` — áp dụng
        thật: chiều trung kế đúng → ghi `name`+`device_position_next` (= vị
        trí port thật) +`device_position_own` (= phần ODF trong Chuyển tiếp,
        nếu có) cho luồng thiết bị; chiều thiết bị đúng → ghi `name` cho luồng
        trung kế + build lại `transit_links.raw_text` = `"<device_position_
        own> - <Tên thiết bị> (<Trib>)"` (update nếu đã có dòng transit_link,
        insert dòng mới nếu chưa — port chưa từng có Chuyển tiếp trước đó vẫn
        xử lý được). Cặp CHƯA liên kết thì CẢ 2 chiều đều tự gắn luôn
        `mirror_of_id` (chọn 1 bên làm chuẩn tức đã xác nhận đây là 1 luồng).
      - **Bẫy phát hiện lúc verify bằng dữ liệu thật** (không phải giả định):
        so số trực tiếp trên NGUYÊN chuỗi `device_position_next` báo SAI khi
        cột này có dạng ghép "ODF x/y (a,b) - Tên tuyến cáp (n,m)" (hợp lệ,
        xem `combinePositionNext()` mục 6) — số trong phần tên tuyến cáp phía
        sau (vd "144FO#1 ADN1-2T9 (131,132)") lẫn vào phép so khiến báo lệch
        dù phần tọa độ ODF thực ra khớp đúng. Sửa bằng `odfPartOnly()` — tách
        lấy ĐÚNG phần ODF qua `splitOdfDeviceStructure()` trước khi so số,
        rơi về nguyên chuỗi nếu không tách được (đã là tọa độ trơn). Sau khi
        sửa, số cặp "đã liên kết nhưng lệch" giảm đúng từ 3 xuống 2 (1 ca vừa
        nêu là báo nhầm, xóa đi; 2 ca còn lại xác nhận lệch THẬT bằng tay).
    - **`components/data-quality/CircuitPairSyncPanel.tsx` (mới)** — panel
      dùng CHUNG cho MỌI nơi (bảng 3 hàng "Bên thiết bị"/"Bên trung kế" tô đỏ/
      xanh theo từng cờ diff; nếu có lệch → 2 radio "Trung kế đúng"/"Thiết bị
      đúng" (bắt buộc chọn mới bấm được "Áp dụng đồng bộ" — cùng tinh thần
      tick-xác-nhận-trước-khi-sửa mục 44/45/47); nếu khớp đủ cả 3 mà CHƯA liên
      kết → nút "Liên kết (giữ nguyên dữ liệu)" (gọi `applySyncFromTrunk` với
      dữ liệu 2 bên vốn đã giống hệt nhau, chỉ để gắn `mirror_of_id`).
    - **Nâng cấp `UnlinkedMirrorPairsTab.tsx` (mục 44)** — đổi hẳn prop từ
      `UnlinkedMirrorPair[]` sang `CircuitPairDetail[]`, bỏ 3-radio "đồng bộ
      tên" cũ, dùng `CircuitPairSyncPanel` thay thế (đồng bộ ĐỦ 3 điểm thay vì
      chỉ tên, đúng đúng yêu cầu người dùng).
    - **`MismatchedLinkedPairsTab.tsx` (mới)** — tab thứ 8 ở `/data-quality`
      ("Đã liên kết nhưng lệch dữ liệu"), cùng khuôn danh sách/lọc/phân trang
      như các tab trước, item = `CircuitPairSyncPanel`.
    - **Nút "🔎 Kiểm tra đồng bộ" ngay trong form sửa 1 luồng** (đúng tinh thần
      "kiểm tra 01 luồng" người dùng dùng làm tên yêu cầu) — gắn ở CẢ 2 nơi,
      chỉ hiện khi tìm được đúng 1 cặp tương ứng trong `circuitPairDetails`
      (im lặng không hiện gì nếu không tìm được, giống các nút "Xem nhanh" mục
      29 — không phải lỗi, chỉ là không có đối phương thiết bị nào):
      - `PortTable.tsx` `EditRow` — tra theo `circuitPairDetails.find(d =>
        d.trunkCircuitId === edit.circuitId)`; trang `app/odf-trunk/[rackId]/
        page.tsx` tính `circuitPairDetails` cho TOÀN TRẠM (không chỉ rack đang
        xem) vì có thể đang sửa bất kỳ luồng nào.
      - `DeviceCircuitList.tsx` khung "Sửa" — tra theo `deviceCircuitId ===
        edit.id`; `app/odf-device/sua-luong/page.tsx` tính tương tự. Toggle
        ẩn/hiện panel dùng `useState` riêng, `useEffect` reset về ẩn mỗi khi
        đổi dòng đang sửa (`edit.id` đổi) — component này KHÔNG remount theo
        dòng như `PortTable.tsx EditRow` (đã có `key` riêng ở nơi gọi), phải
        tự reset tay tránh lộ nhầm panel của dòng cũ.
    - **Kiểm chứng**: `tsc --noEmit` sạch mỗi bước. Trên dữ liệu thật:
      - Ca P2(2/1/2) hiện đúng trong tab "chưa liên kết" với `ownPositionMatch:
        false` (ODF9/14(25,26) thật vs ODF9/12/21,22 sai trong Chuyển tiếp),
        `nextPositionMatch: true`, `nameMatch: true`, `similarity: 100` —
        đúng NGUYÊN VĂN phát hiện ban đầu của người dùng, giờ hiện tự nhiên
        qua UI thay vì phải tự tra tay như lúc đầu.
      - Tổng "chưa liên kết" 207 (mục 44) → 203 (giảm đúng 4, do các ca đã xử
        lý/liên kết rải rác trước đó trong phiên, không phải lỗi đếm).
      - "Đã liên kết nhưng lệch" phát hiện đúng 2 ca thật (sau khi sửa bẫy
        `odfPartOnly` ở trên) — 1 ca thiếu hẳn Chuyển tiếp bên trung kế
        (`ownPositionMatch: null`, không đủ dữ liệu so) nhưng `nextPositionMatch:
        false` thật (device_position_next trỏ ODF9/8(23,24), trung kế thật
        nằm ở ODF2/8(43,44) — 2 vị trí khác hẳn nhau).
      - Curl toàn bộ route chính (`/`, `/odf-trunk`, `/odf-trunk/<rackId>`,
        `/odf-device`, `/odf-device/sua-luong`, `/data-quality`, `/devices`,
        `/search`) đều 200. **Chưa áp dụng đồng bộ/liên kết cho cặp nào** —
        tính năng mới build xong, để người dùng tự thử trên UI trước.

49. **Sửa mục 47 — bỏ nhãn "đúng"/"sai" áp đặt, cho người dùng tự chọn (+ tự
    đồng bộ liên tục sau khi đã liên kết)** (yêu cầu người dùng 2026-08-02,
    ngay sau mục 48):
    - **Phản hồi 1**: người dùng hỏi thẳng ca BNG#1(4/0/1) ở tab mục 47 "tại
      sao bạn viết đúng theo vị trí, rồi bạn lấy số liệu này ở đâu ??? rồi bạn
      biết khi bấm xác nhận rồi sửa lại lấy theo cái nào là đúng". Truy ngược
      xác nhận `device_position_map` đến từ đợt import 126 file Excel thiết bị
      gốc (`created_at` khớp mili-giây với batch 2026-07-25, KHÔNG suy vòng từ
      chính transit_links đang xét), nhưng người dùng phản hồi đúng: "chưa
      chắc là device_position_map đúng đâu; đúng ra bạn phải để tôi chọn chứ
      sao áp đặt như vậy được. thậm chí cả 2 đều sai và nhập cho đúng lại nữa
      kia". **`lib/transitPositionMismatches.ts`** — bỏ hẳn
      `correctOdfPosition`/`wrongOdfPart` (đổi tên trung lập
      `libraryOdfPosition`/`transitOdfPart`), bỏ 1 nút "Sửa lại" tự động, thay
      bằng 3 hàm: `applyLibraryFromTransit()` (Chuyển tiếp đúng → ghi NGƯỢC
      vào thư viện — hàm MỚI, trước đây chưa từng có chiều này),
      `applyTransitFromLibrary()` (Vị trí thiết bị đúng → ghi Chuyển tiếp,
      giữ hành vi cũ nhưng hết tự động), `applyCustomPosition()` (cả 2 sai →
      người dùng gõ tọa độ đúng, ghi vào CẢ 2 nơi — hàm MỚI). UI đổi thành 3
      radio (không cái nào chọn sẵn) + 1 ô nhập tay cho lựa chọn thứ 3.
    - **Phản hồi 2** (cùng lượt, câu hỏi tiếp theo): "sau khi đã liên kết được
      luồng được rồi thì khi tôi sửa ở 1 bên hồ sơ thì hồ sơ bên còn lại tự
      đồng bộ luôn (từ tên, odf, cho chuẩn luôn...)" — muốn continuous sync
      sau khi liên kết, không chỉ công cụ "Kiểm tra đồng bộ" bấm tay (mục 48).
      Hỏi lại qua AskUserQuestion mức độ tự động: chọn **"hiện cảnh báo xác
      nhận, đồng thời đưa ra số liệu ánh xạ 1-1... cho từng trường"** (không
      phải 1 trong 2 lựa chọn gợi ý sẵn — câu trả lời tự do, mức an toàn hơn
      cả 2 gợi ý: có xác nhận VÀ hiện rõ số liệu). Riêng ví dụ "port 1/24/9 ghi
      thành S24-9" — xác nhận là ô Trib (không phải tọa độ ODF), nên VẪN giữ
      nguyên giới hạn đã có từ trước (không có thuật toán an toàn để tự quy
      đổi giữa các kiểu viết Trib khác nhau, xem `distinctPositionsForDevice`)
      — KHÔNG đưa Trib vào phạm vi tự đồng bộ này.
    - **`lib/circuitPairSync.ts`** — thêm `hasPositionChanged(oldValue,
      newValue)`: so theo dãy số (như `numbersEqual` nội bộ dùng cho rà bứn)
      thay vì so chuỗi thô, để KHÔNG hỏi xác nhận thừa khi chỉ lệch định dạng
      ("ODF7/9(41,42)" vs "ODF 7/9 (41,42)" — cùng 1 giá trị). Khi không đủ số
      để so, coi là "có khác" (thà hỏi thừa còn hơn bỏ lỡ 1 thay đổi thật).
    - **`PortTable.tsx` `saveEdit()`** — sau khi lưu xong "Chuyển tiếp" (và
      auto-tạo mirror trung kế-trung kế nếu có, mục 40), tra `circuitPairDetails`
      xem luồng vừa lưu có ĐÃ liên kết với 1 luồng thiết bị không; nếu có VÀ
      Tên luồng hoặc phần ODF trong Chuyển tiếp vừa đổi thật (qua
      `hasPositionChanged`) → `confirm()` liệt kê CHÍNH XÁC từng trường đổi
      (`"Tên luồng: A -> B"`, `"Vị trí ODF (thiết bị): X -> Y"`) → đồng ý mới
      gọi `applySyncFromTrunk()` (tái dùng nguyên hàm mục 48, không viết lại).
    - **`DeviceCircuitList.tsx` `saveEdit()`** — đối xứng, gọi
      `applySyncFromDevice()` khi luồng đã liên kết với 1 luồng trung kế và
      Tên luồng hoặc Vị trí ODF (thiết bị) vừa đổi thật.
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl toàn bộ route chính vẫn 200.
      KHÔNG có công cụ trình duyệt (Playwright) trong phiên này để tự bấm thử
      luồng lưu+confirm() thật — đã rà code kỹ (đường mã nguồn dùng LẠI đúng
      2 hàm `applySyncFromTrunk`/`applySyncFromDevice` đã kiểm chứng ở mục 48,
      chỉ thêm bước tính diff + `confirm()` bọc ngoài), báo rõ với người dùng
      để họ tự thử trên UI trước khi tin tưởng hoàn toàn.
    - **CHƯA làm**: câu hỏi riêng "tick tự đặt tên luồng có nên thêm vào form
      Sửa (hiện chỉ có ở Thêm luồng mới, từ commit gốc `5a603ef` 2026-07-27,
      không phải lỗi mới)" — người dùng chưa trả lời câu này, để ngỏ.

50. **Form Sửa PHẢI đủ mọi ô nhập liệu như Thêm mới; Trib cũng là 1 trường
    đồng bộ, không phải ngoại lệ** (yêu cầu người dùng 2026-08-02, trả lời câu
    hỏi để ngỏ ở mục 49 + phản đối giới hạn Trib tôi đưa ra): "hai form phải
    giống nhau về mặt nhập liệu chứ; những gì có ở bên thêm mới thì bên sửa
    cũng phải có; bên sửa thì sẽ có nhiều trường, nút hơn do các tính năng
    khác như đồng bộ...; rồi port trib cũng phải đồng bộ luôn chứ; làm gì có
    chuyện mà ở bên thiết bị thì port trib này mà sang hồ sơ khác lại port
    ghi kiểu khác được. thống nhất 1 tên thôi".
    - **Tick "tự đặt tên luồng" ở form Sửa** (`components/odf-device/
      DeviceCircuitList.tsx`) — trước đó `enableNameTicks=false` cứng cho
      Sửa, tick+logic tính tên (`toggleNameTick`/`computeAutoName`) chỉ nối
      dây tới `createDraft`. Generalize: `toggleNameTick` giờ rẽ theo `edit ?
      ... : ...` (an toàn dùng CHUNG 1 state `nameTicks` cho cả 2 form vì
      Thêm/Sửa khóa lẫn nhau, không bao giờ cùng mở — xem `creating`/`edit`);
      thêm `handleEditChange()` đối xứng với `handleCreateChange()` (tính lại
      tên khi ĐỦ 2 tick và 1 trường liên quan đổi); `openEdit()` reset
      `nameTicks` về rỗng (giống `openCreate()`); thêm checkbox "Thiết bị"
      ngay cạnh ô tên thiết bị TĨNH trong khung Sửa (trước đây khung Sửa
      không có checkbox nào ở đây, chỉ hiện text); đổi `enableNameTicks` ->
      `true` + `onChange` -> `handleEditChange` ở lệnh gọi
      `renderCircuitFormFields()` cho khung Sửa.
    - **Trib trở thành điểm dữ liệu thứ 4 trong `lib/circuitPairSync.ts`**
      (trước mục 48/49 chỉ có Tên luồng/Vị trí ODF thiết bị/Vị trí ODF tiếp
      theo — Trib bị bỏ sót hoàn toàn khỏi việc SO SÁNH dù đã được dùng để
      DỰNG LẠI Chuyển tiếp lúc đồng bộ chiều thiết bị->trung kế):
      - `CircuitPairDetail` thêm `trunkTransitTrib` (tách từ Chuyển tiếp qua
        `splitOdfDeviceStructure().port`, đã có sẵn, trước đây chỉ chưa lưu
        lại) và `tribMatch: boolean | null`.
      - So Trib KHÔNG dùng `numbersEqual` (đúng cho tọa độ ODF, sai cho Trib —
        "S24-9" chỉ có 1 số tách được là sai) mà so CHUỖI đã chuẩn hóa qua
        `normalizeDevicePositionKey` (hoa/thường, khoảng trắng) — **cố ý
        KHÔNG cố quy đổi giữa các hệ ký hiệu khác nhau** (vd "1/24/9" vs
        "S24-9" vẫn báo khác nhau thật, đúng giới hạn đã xác nhận từ trước,
        `distinctPositionsForDevice`). Người dùng làm rõ: đây là 2 bài toán
        KHÁC NHAU — "tự phát hiện 2 cách viết là cùng 1 port khi CHƯA biết gì"
        (vẫn không có thuật toán an toàn, giữ nguyên giới hạn) khác với "đã
        XÁC ĐỊNH đây là 1 cặp liên kết rồi thì đồng bộ Trib y hệt kiểu bên
        nguồn" (chỉ là copy chuỗi, không cần đoán gì — làm được, không có gì
        khó).
      - `applySyncFromTrunk()` — thêm ghi `trib_text` (chiều trung kế đúng,
        trước đây bỏ sót); `applySyncFromDevice()` không cần sửa (đã ghi Trib
        vào Chuyển tiếp từ trước, chỉ chưa được coi là 1 điểm so sánh riêng).
      - `findMismatchedLinkedPairs()` thêm điều kiện `tribMatch === false`.
      - `hasTribChanged()` (mới, dùng CHUNG với `hasPositionChanged` cho tự
        đồng bộ liên tục mục 49) — so chuẩn hóa, không so số.
      - `CircuitPairSyncPanel.tsx` thêm hàng "Trib" vào bảng đối chiếu (hàng
        thứ 4, sau Tên luồng/Vị trí ODF thiết bị/Vị trí ODF tiếp theo).
      - `PortTable.tsx`/`DeviceCircuitList.tsx` `saveEdit()` (tự đồng bộ liên
        tục, mục 49) — thêm dòng "Trib: ... -> ..." vào `confirm()` khi Trib
        đổi thật, đẩy kèm trong cùng 1 lượt `applySyncFromTrunk`/
        `applySyncFromDevice`.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Curl toàn bộ route chính vẫn 200.
      Tổng "đã liên kết nhưng lệch dữ liệu" đổi theo dữ liệu thật đang sống
      (người dùng đang tự sửa qua UI song song) — không dùng số tuyệt đối để
      kiểm chứng đợt này, chỉ xác nhận code path chạy không lỗi.

51. **Thêm thao tác "Gỡ liên kết"** (yêu cầu người dùng 2026-08-02, bước 1/6
    trong tài liệu đề xuất "Giải pháp: Nhất quán liên kết ODF trung kế ↔
    ODF/DDF thiết bị ↔ Thiết bị" do người dùng tự viết sau khi đọc kỹ
    `architecture.md`/code thật — xác định đúng: trước đó KHÔNG có bất kỳ
    thao tác nào trong code để tách 2 luồng đã liên kết (`mirror_of_id`) ra —
    đã grep toàn repo xác nhận 0 kết quả — nên khi 1 đầu xa đã tồn tại nhưng
    SAI, không có đường nào sửa đúng; đây là bước NỀN TẢNG bắt buộc phải làm
    trước khi có thể chặn-lưu-khi-đổi-số-liệu-thật ở các bước sau (nếu chặn
    mà không có lối gỡ thì người dùng bị kẹt).
    - **`lib/mirrorLinkStatus.ts`** — thêm `unlinkCircuitMirror(circuitId)`:
      CHỈ set `mirror_of_id = null`, không đụng bất kỳ trường dữ liệu nào
      khác của cả 2 bên. Nhận `circuitId` là BÊN NÀO CŨNG ĐƯỢC trong cặp (dò
      cả 2 chiều — tự nó có `mirror_of_id` thì null trực tiếp; không thì tìm
      dòng khác có `mirror_of_id` trỏ về nó rồi null dòng đó) — cùng lý do
      `computeMirrorLinkStatuses()` ở trên cũng phải dò cả 2 chiều: chiều nào
      giữ cột `mirror_of_id` phụ thuộc loại cặp (device-trunk: luôn bên trung
      kế; device-device/trunk-trunk: luồng được tạo SAU, xem
      `lib/deviceDeviceSync.ts`/`lib/mirrorTrunkCircuits.ts`).
    - **`PortTable.tsx`** — hàm `unlinkMirror(circuitId, counterpartName)` ở
      tầng component cha (cùng chỗ `saveEdit`/`deleteGroup`), `confirm()` rồi
      gọi `unlinkCircuitMirror` + `refreshAndThen()`. Nút "🔓 Gỡ liên kết"
      thêm vào `EditRow` (props mới: `mirrorLinkStatuses`, `onUnlink`), hiện
      khi `mirrorLinkStatuses?.[edit.circuitId] === "linked"` — CỐ Ý dùng
      `mirrorLinkStatuses` chứ không phải `pairDetail` (chỉ phủ cặp
      device-trunk) để cũng hiện được cho mirror trung kế-trung kế.
    - **`DeviceCircuitList.tsx`** — đối xứng: `unlinkMirror()` dùng lại
      `busy`/`setBusy`/`router.refresh()` sẵn có. Nút "Gỡ liên kết" nằm trong
      cùng khối IIFE với nút "Kiểm tra đồng bộ" (khối này trước đây `return
      null` sớm nếu không có `pairDetail` — sửa lại để tách điều kiện hiện 2
      nút độc lập nhau: nút đồng bộ cần `pairDetail`, nút gỡ liên kết chỉ cần
      `mirrorLinkStatuses?.[edit.id] === "linked"`, phủ được cả mirror
      thiết bị-thiết bị).
    - Cả 2 nút đều hiện text `confirm()` rõ ràng: dữ liệu 2 bên giữ nguyên,
      chỉ mất liên kết đối chiếu/tự đồng bộ.
    - **Kiểm chứng**: `tsc --noEmit` sạch. Chạy `npm run dev`, curl `/`,
      `/odf-trunk`, `/odf-trunk/<rackId>` (1 rack thật), `/odf-device`,
      `/odf-device/sua-luong`, `/data-quality` — tất cả 200. KHÔNG có công cụ
      trình duyệt (Playwright) trong phiên này để tự bấm nút "Gỡ liên kết"
      thật trên UI — đã báo người dùng tự thử trước khi tin tưởng hoàn toàn.
    - **CHƯA làm** (các bước 2-6 còn lại trong đề xuất của người dùng, mỗi
      bước cần xác nhận riêng trước khi làm tiếp theo đúng nguyên tắc vertical
      slice ở `CLAUDE.md`): (2) tách "đổi định dạng" (tự đồng bộ, không hỏi)
      khỏi "đổi số liệu thật" (chặn lưu nếu đã liên kết, bắt gỡ liên kết
      trước) trong `saveEdit()` 2 nơi; (3) khi phát hiện đầu xa khớp/gần khớp
      lúc lưu mà đầu xa đã có dữ liệu riêng, hỏi `CircuitPairSyncPanel` ngay
      trong form thay vì lưu-trước-báo-sau; (4) dọn tồn đọng dữ liệu cũ qua
      các script rà soát hiện có; (5) gộp `/data-quality` từ 8 tab xuống 2;
      (6, tùy chọn) biến `device_position_map` thành cache tự sinh từ
      `circuits` thay vì nguồn nhập tay độc lập.

52. **Chặn lưu khi luồng ĐÃ liên kết mà đổi Vị trí ODF/Trib sang SỐ LIỆU
    THẬT khác** (bước 2/6, tiếp theo mục 51 sau khi người dùng xác nhận "đã
    gỡ liên kết ok"). Hỏi lại 1 điểm đề xuất chưa nói rõ — chặn TOÀN BỘ lượt
    lưu hay chỉ riêng trường vị trí/trib — người dùng chọn **chặn toàn bộ**
    (không lưu bất kỳ trường nào khác cùng lượt, kể cả Đối phương/Phương án
    ứng cứu... nếu sửa chung).
    - **Phát hiện lúc code hóa (quan trọng)**: `hasPositionChanged`/
      `hasTribChanged` (thêm ở mục 49) **ĐÃ SẴN tách đúng "số liệu thật" khỏi
      "cách ghi"** — trả `true` CHỈ KHI dãy số thật sự khác nhau (qua
      `numbersEqual`/`odfPartOnly` nội bộ), lệch định dạng thuần túy (vd
      "ODF7/9(41,42)" vs "ODF 7/9 (41,42)") vẫn trả `false`. Nghĩa là luồng
      cũ ở mục 49 (lưu trước → hỏi `confirm()` → đẩy sang bên kia nếu đồng ý)
      **CHỈ hỏi đúng lúc có SỐ LIỆU THẬT khác nhau** — tức là mục 49 vô tình
      đã tự động hóa chính xác trường hợp NGUY HIỂM NHẤT (im lặng tin bên vừa
      sửa đúng rồi ghi đè bên kia, không ai xác nhận bên nào đúng — đúng lỗ
      hổng gây ra ca AĐN1.P2(2/1/2) mở đầu phiên). Sửa bước này thực chất là
      ĐẢO NGƯỢC hành vi khi phát hiện số thật khác: từ "lưu rồi hỏi có đẩy
      không" sang "chặn lưu, không hỏi, bắt tự xử lý qua Kiểm tra đồng bộ/Gỡ
      liên kết". Trường hợp CHỈ đổi cách ghi/chỉ đổi TÊN thì giữ hành vi tự
      đẩy — nhưng bỏ luôn `confirm()` (yêu cầu người dùng: "tự đồng bộ...
      không hỏi confirm() nữa") vì đã chắc chắn an toàn.
    - **`PortTable.tsx` `saveEdit()`** — thêm guard NGAY ĐẦU hàm (trước
      `setSaving(true)`, trước MỌI lượt ghi Supabase): nếu `edit.circuitId`
      đã liên kết (`circuitPairDetails`, `isLinked`), tách lại
      `edit.transitText` qua `splitOdfDeviceStructure` thành odfPart/trib
      mới, so với `linkedPair.deviceOwnPosition`/`deviceTrib` bằng
      `hasPositionChanged`/`hasTribChanged` — khác thật thì `setError(...)` +
      `return` ngay, KHÔNG chạm DB. Khối tự đồng bộ ở cuối hàm rút gọn: chỉ
      còn kiểm tra TÊN đổi (vị trí/trib đổi thật không thể tới được đây nữa
      vì đã chặn ở đầu), gọi thẳng `applySyncFromTrunk()` không qua
      `confirm()`.
    - **`DeviceCircuitList.tsx` `saveEdit()`** — đối xứng, guard đặt sau
      `findMissingRequiredFields` (trước `setBusy(true)`). Khác trung kế 1
      điểm: kiểm tra CẢ 3 trường thay vì 2 — `positionOwn` (so
      `trunkTransitOdfPart`), `tribText` (so `trunkTransitTrib`), VÀ
      `device_position_next` mới ghép qua `combinePositionNext()` (so
      `trunkOwnPositionCanonical`). **Trường thứ 3 này chính là lỗ hổng CHƯA
      từng được kiểm ở mục 49** — mục 49 chỉ đối chiếu own/trib, không đối
      chiếu "Vị trí ODF (tiếp theo)", nên 1 luồng vẫn liên kết mirror_of_id
      với 1 luồng trung kế NHƯNG bị gõ lại "đi đâu tiếp theo" thành 1 port
      trung kế khác hẳn (đúng hệt kiểu lỗi ca P2 mở đầu phiên) sẽ KHÔNG bị
      bắt — giờ bắt được. Khối tự đồng bộ cuối hàm cũng rút gọn tương tự,
      chỉ còn đẩy TÊN qua `applySyncFromDevice()`, không `confirm()`.
    - Message chặn lưu (2 nơi, giống công thức): `Luồng này đang liên kết
      với luồng <thiết bị/trung kế> "<tên>" (<vị trí nếu có>). Không lưu
      được vì Vị trí ODF/Trib vừa đổi sang số liệu khác — dùng "Kiểm tra
      đồng bộ..." để chọn đúng bên, hoặc "Gỡ liên kết" trước nếu đây thực sự
      là 1 đấu nối khác.` — trỏ đúng 2 lối thoát đã có sẵn (panel đối chiếu
      mục 48 chọn 1 bên đúng, HOẶC nút "Gỡ liên kết" mục 51).
    - **Kiểm chứng**: `tsc --noEmit` sạch. `npm run dev` + curl `/`,
      `/odf-trunk`, `/odf-trunk/<rackId>`, `/odf-device`,
      `/odf-device/sua-luong`, `/data-quality`, `/dashboard` — tất cả 200.
      KHÔNG có Playwright trong phiên này để tự bấm thử chặn-lưu thật trên
      UI (thử lưu 1 luồng đã liên kết với số vị trí khác hẳn, xác nhận báo
      lỗi đúng và KHÔNG ghi gì xuống DB) — đã báo người dùng tự thử trước
      khi tin tưởng hoàn toàn.
    - **CHƯA làm**: bước 3 (khi phát hiện đầu xa khớp/gần khớp lúc lưu mà đầu
      xa đã có dữ liệu riêng — hỏi `CircuitPairSyncPanel` ngay trong form
      thay vì lưu-trước-báo-sau) trở đi, theo đúng thứ tự đề xuất, mỗi bước
      chờ xác nhận trước khi làm tiếp.

53. **Sửa lỗi báo sai "Vui lòng nhập đủ: Cáp quang (tiếp theo)" khi Sửa 1
    luồng thiết bị ở Chế độ Cáp quang** (người dùng phát hiện ngay sau khi
    thử bước 2/mục 52: "trường này là tự động nhận dạng từ phía vị trí ODF
    (tiếp theo) rồi mà" — đúng, đây là bug CÓ TRƯỚC, không liên quan chặn lưu
    mục 52, chỉ tình cờ lộ ra vì người dùng đang thử sửa nhiều luồng đã liên
    kết).
    - **Gốc lỗi**: `renderCircuitFormFields()` ở Chế độ Cáp quang (Ô1 khớp 1
      rack TRUNG KẾ thật) hiển thị Ô2 "Cáp quang (tiếp theo)" READ-ONLY, đọc
      TRỰC TIẾP từ `matchTrunkPosition(positionNextOdf, trunkPorts)` sống —
      tức màn hình LUÔN đúng bất kể state ra sao. Nhưng `findMissingRequiredFields()`
      lúc lưu lại đọc từ STATE (`edit.positionNextDevice`), và STATE đó được
      `openEdit()` khởi tạo qua `splitPositionNextForEdit()` — hàm này (trước
      sửa) CHỈ tách bằng `splitOdfDeviceStructure()`, đòi hỏi
      `device_position_next` đã lưu đúng y hệt mẫu "ODF... - Tên (n,m)". Dữ
      liệu cũ/import (không qua đúng form này) khớp rack trung kế thật ở Ô1
      nhưng không đúng y hệt mẫu ghép (thiếu "()" quanh Sợi, cách ghi số
      khác...) → tách rớt mất phần thiết bị/trib → STATE rỗng dù MÀN HÌNH vẫn
      hiện đúng tên tuyến cáp — lệch giữa "cái đang thấy" và "cái sắp lưu".
      Hệ quả nghiêm trọng hơn cả validation sai: nếu bug này KHÔNG bị chặn
      bởi validation, lượt lưu thật sự sẽ ghi `device_position_next` THIẾU
      mất phần tên tuyến cáp/sợi (vì `combinePositionNext()` cũng đọc từ
      cùng STATE rỗng đó) — mất dữ liệu âm thầm.
    - **`components/odf-device/DeviceCircuitList.tsx`** —
      `splitPositionNextForEdit(raw, trunkPorts)` (thêm tham số `trunkPorts`):
      khi phần ODF tách được khớp 1 rack TRUNG KẾ thật, LUÔN suy Ô2/Ô3 từ
      chính rack/port thật đó qua `matchTrunkPosition()` (giống hệt cách
      onChange của Ô1 làm khi gõ tay) — không phụ thuộc dữ liệu text cũ có
      đúng mẫu ghép hay không; chỉ fallback về `splitOdfDeviceStructure()`
      khi Ô1 KHÔNG khớp rack trung kế (chế độ Thiết bị, hành vi cũ giữ
      nguyên). `openEdit()` truyền thêm `trunkPorts` (đã có sẵn trong scope,
      component prop).
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/odf-device`,
      `/odf-device/sua-luong` vẫn 200. Chưa tự bấm thử trên UI (không có
      Playwright) — đã báo người dùng tự mở lại đúng luồng từng báo lỗi để
      xác nhận Ô2 "Cáp quang (tiếp theo)" không còn báo thiếu khi Sửa.

54. **Bước 3/6: khi lưu 1 luồng mà đầu xa đã tồn tại (khớp hay lệch), xử lý
    NGAY tại thời điểm lưu thay vì lưu-trước-báo-lỗi-mềm-sau** (tiếp theo mục
    52). Hỏi phạm vi trước (có nên phân theo LOẠI cặp: thiết bị-trung kế /
    thiết bị-thiết bị / trung kế-trung kế không) — người dùng bác bỏ hẳn cách
    đặt vấn đề đó: "cũng là odf, cũng có port, cũng có tên trung kế (bên
    thiết bị thì có tên thiết bị). Như nhau mà có gì đâu mà phải phân loại
    lắm thế", và nêu rõ NGUYÊN TẮC DUY NHẤT áp cho MỌI loại cặp: "khi mở một
    bên hồ sơ... sửa lại lúc này nó phải là đúng, là chuẩn rồi; check bên còn
    lại khớp thì lấy từ bên chuẩn này đẩy qua; gần khớp thì người dùng thấy
    ok thì cho đẩy qua thôi (tự xóa bên kia rồi mới đẩy từ bên chuẩn này qua;
    còn nếu bị chệch port hay cùng loại thì cũng xác nhận từng bước là xóa
    của bên kia, rồi đẩy bên chuẩn này qua bên kia (dĩ nhiên lúc đó bên kia
    port trên thiết bị đó ko còn nữa vì đã xóa rồi thì lúc đó tạo mới theo
    chuẩn bên này thôi là được".
    - **Nguyên tắc code hóa**: bên VỪA LƯU luôn là chuẩn. Đầu xa TRỐNG → tự
      tạo ngay (giữ nguyên, không đổi — mục 38/39/40). Đầu xa ĐÃ CÓ dữ liệu:
      - **Tên khớp hệt** (chắc chắn cùng 1 luồng thật, chỉ chưa gắn liên
        kết) → tự gắn `mirror_of_id` NGAY, không hỏi (Case B).
      - **Tên KHÁC** (gần khớp hay lệch hẳn — không phân biệt 2 mức này,
        đúng yêu cầu người dùng: cả 2 đều xử lý y hệt nhau) → `confirm()`
        hiện rõ tên đang chiếm + tên vừa lưu, đồng ý thì **XÓA** luồng đang
        chiếm rồi **TẠO LẠI** theo đúng bên vừa lưu (không sync field-by-
        field — xóa sạch rồi tạo mới theo hàm tạo-mirror sẵn có, đơn giản và
        chắc chắn không lẫn dữ liệu cũ).
    - **`lib/mirrorTrunkCircuits.ts`** — `autoCreateTrunkMirrorForCircuit()`
      (device→trunk) và `autoCreateTrunkTrunkMirrorForCircuit()`
      (trunk→trunk): nhánh "port đã bị chiếm" trước đây `continue` (bỏ qua
      ÂM THẦM, đây chính là lỗ hổng bước 3 sửa) → giờ trả `status: "occupied"`
      kèm `occupantCircuitId`/`occupantCircuitName` (join thêm
      `port_circuit_links(circuit_id, circuits(name))` vào query rà sống có
      sẵn, không thêm round-trip). Thêm 2 hàm
      `replaceOccupantAndCreateTrunkMirror()`/
      `replaceOccupantAndCreateTrunkTrunkMirror()` — tái dùng NGUYÊN
      `deleteTrunkCircuitToResync`/`findMirrorTrunkCircuits` (mục 33, đã có
      sẵn cho ca "Trung kế thiếu bên thiết bị") để xóa, rồi gọi lại đúng hàm
      tạo-mirror tương ứng (port đã trống thì tự thành công).
    - **`lib/deviceDeviceSync.ts`** — `autoCreateMirrorForCircuit()`
      (device↔device): status `"mismatch"` đã có sẵn từ mục 38 (tên khớp
      nhưng Trib lệch) — bổ sung `existingCircuitId` vào kết quả trả về
      (trước đây tính trong `DeviceMirrorMismatch` nhưng bị bỏ sót không trả
      ra ngoài). Thêm `replaceMismatchedDeviceMirror()` — xóa thẳng dòng
      `circuits` cũ (luồng thiết bị KHÔNG có `port_circuit_links`, đơn giản
      hơn phía trung kế) rồi gọi lại `autoCreateMirrorForCircuit()`.
    - **`DeviceCircuitList.tsx`** — `autoMirrorAfterSave(circuitId, sourceName)`
      (thêm tham số `sourceName`, gọi từ cả `saveEdit()`/`submitCreate()`):
      xử lý CẢ 2 nhánh (device-device `"mismatch"`, device-trunk
      `"occupied"`) theo đúng nguyên tắc trên — so tên trực tiếp, khớp thì
      `update({ mirror_of_id })` thẳng, khác thì `confirm()` + xóa + gọi lại
      hàm tạo-mirror.
    - **`PortTable.tsx`** — đối xứng cho nhánh trunk-trunk (`"occupied"` từ
      `autoCreateTrunkTrunkMirrorForCircuit`), dùng `circuitFields.name`
      (tên vừa lưu) để so.
    - **Kiểm chứng**: `tsc --noEmit` sạch. `npm run dev` + curl toàn bộ route
      chính (`/`, `/odf-trunk`, `/odf-trunk/<rackId>`, `/odf-device`,
      `/odf-device/sua-luong`, `/data-quality`, `/dashboard`) — tất cả 200.
      KHÔNG có Playwright trong phiên này để tự bấm thử luồng
      lưu→confirm()→xóa→tạo-lại thật (đặc biệt là XÓA — thao tác không thể
      hoàn tác) — đã báo người dùng: **bắt buộc tự thử trên UI với 1 ca cụ
      thể trước khi tin tưởng hoàn toàn**, vì đây là bước có thao tác XÓA dữ
      liệu tự động theo phát hiện của máy (dù luôn có `confirm()` chặn
      trước, không bao giờ tự xóa mà không hỏi).
    - **CHƯA làm**: bước 4 (dọn tồn đọng dữ liệu cũ qua các script rà soát
      hiện có) và bước 5 (gộp `/data-quality` từ 8 tab xuống 2) — theo đúng
      thứ tự đề xuất, chờ xác nhận bước 3 hoạt động đúng trên dữ liệu thật
      trước khi làm tiếp.

55. **2 phát hiện khi người dùng tự test bước 3** (ca thật: `ADN1.OME-MSPP#1
    RMT2 (S24-9) <-> ODF 3/2 (05,06) <-> ODF 1/1 (43,44) - 96FO#1 ADN1 - 2T9
    (43,44)` — xác nhận chuỗi này ĐÚNG, tức mục 53 chạy tốt trên ca thật).
    - **Xóa 1 bên đã liên kết KHÔNG tự phục hồi bên kia**: người dùng chủ
      động xóa dòng trung kế `ODF 1/1 (43,44) - 96FO#1...` để thử phản ứng —
      "chưa thấy gì", nhận xét đúng: "rõ ràng sync được thì có thông tin và
      trạng thái đã liên kết". Gốc: cơ chế tự-tạo-mirror (mục 38-40, 54) CHỈ
      chạy khi LƯU luồng NGUỒN (thiết bị) — xóa thẳng luồng đích (trung kế)
      không đụng gì tới luồng thiết bị nên không có gì kích hoạt lại, dù dữ
      liệu thiết bị vẫn còn nguyên trỏ đúng vị trí vừa trống.
      - **Sửa**: `PortView.circuit` (`PortTable.tsx`) + `RawCircuit`
        (`app/odf-trunk/[rackId]/page.tsx`) thêm `mirrorOfId`/`mirror_of_id`
        (join thêm 1 cột vào query rack đã có, không thêm round-trip).
        `deleteGroup()` — SAU khi xóa xong + giải phóng port, nếu luồng vừa
        xóa có `mirrorOfId` (tức nó LÀ mirror của 1 luồng thiết bị), gọi
        THẲNG LẠI `autoCreateTrunkMirrorForCircuit(circuit.mirrorOfId)` —
        port vừa trống nên tự tạo lại thành công ngay (trừ khi dữ liệu thiết
        bị đã đổi trỏ nơi khác từ trước, khi đó "no-gap", vô hại). Không cần
        xây cơ chế quét-ngược phức tạp — chỉ cần đúng 1 id đã biết sẵn
        (`mirrorOfId` của chính dòng vừa xóa).
    - **"Sợi quang (tiếp theo)" vẫn phải gõ tay dù suy được 1-1 từ port**:
      người dùng chỉ ra đúng cùng loại vấn đề đã sửa cho "Cáp quang (tiếp
      theo)" ở mục 53 — "Có ODF x/y (a,b) thuộc trung kế là biết port mấy,
      sợi quang mấy luôn rồi cần gì gõ tay nữa". Field này trước là `<input>`
      cho gõ NGƯỢC (Sợi → suy Port), dù đã tự điền khi gõ Ô1.
      - **Sửa**: `components/odf-device/DeviceCircuitList.tsx`
        `renderCircuitFormFields()` — đổi ô "Sợi quang (tiếp theo)" (Chế độ
        Cáp quang) từ `<input>` sang `<div>` read-only giống hệt "Cáp quang
        (tiếp theo)", đọc trực tiếp `trunkMatch.resolvedPorts` (số Sợi thật
        của port đã khớp ở Ô1). An toàn để khóa vì STATE `positionNextTrib`
        đã được đảm bảo tự điền đúng ở CẢ 2 nơi: onChange Ô1 (khi gõ) và
        `splitPositionNextForEdit()` (khi mở Sửa, vừa sửa ở mục 53) — không
        còn đường nào cần gõ tay Ô3 nữa. Áp dụng CẢ Thêm mới lẫn Sửa (dùng
        chung `renderCircuitFormFields()`).
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/odf-trunk`,
      `/odf-trunk/<rackId>`, `/odf-device`, `/odf-device/sua-luong` — 200.
      Chưa tự bấm thử trên UI (không có Playwright) — đã báo người dùng tự
      thử lại đúng ca vừa test (xóa 1 bên trung kế, xem có tự tạo lại không;
      mở Sửa 1 luồng Cáp quang, xem Sợi quang có tự hiện đúng không).

56. **Nút "Quét & lấp đầy chỗ trống" ở `/data-quality`** — người dùng hỏi
    thẳng: "nếu bên hồ sơ còn lại đang trống thì anh sync luôn chứ sao phải
    đợi sửa lại bên hồ sơ đúng một chút gì đó (ví dụ ghi thêm ghi chú) rồi
    mới kích hoạt chế độ sync qua bên hồ sơ kia". Đúng: `autoCreateXForCircuit`
    (mục 38-40/54) CHỈ chạy khi LƯU đúng 1 luồng cụ thể — tồn đọng CŨ (có từ
    trước, hoặc phát sinh từ thao tác không qua form Lưu, như ca vừa test ở
    mục 55 — xóa 1 bên trung kế) không có gì tự kích hoạt được nếu không ai
    sửa+lưu lại đúng luồng liên quan.
    - **`lib/mirrorTrunkCircuits.ts`** — thêm `syncAllTrunkMirrorGaps()`
      (device→trunk) và `syncAllTrunkTrunkMirrorGaps()` (trunk→trunk): quét
      TOÀN BỘ 1 lượt, tái dùng NGUYÊN `findTrunkMirrorCandidates`/
      `matchBareTrunkLink` (đúng thuật toán `scripts/sync-missing-trunk-
      circuits.ts`/`sync-missing-trunk-trunk-circuits.ts` đã dùng, không viết
      lại — tránh lệch nhau) nhưng chỉ 1 lần fetch `trunkPorts`/`circuits`/
      `port_circuit_links`/`transit_links` (có phân trang `.range()` đúng
      pattern `lib/deviceCircuits.ts` — PostgREST mặc định chỉ trả 1000
      dòng/lần) rồi lặp trong bộ nhớ — KHÁC gọi lại `autoCreateXForCircuit`
      hàng trăm/nghìn lần (mỗi lần tự fetch lại toàn bộ, quá chậm). Khác CLI
      script: LUÔN ghi thật (không DRY RUN — bấm nút tức đã chủ động); "đã bị
      chiếm nhưng TÊN KHỚP HỆT" → tự liên kết ngay (đúng nguyên tắc bước 3/6,
      mục 54); "TÊN KHÁC" → KHÔNG tự xóa/tạo lại hàng loạt (rủi ro cao khi
      không giám sát từng dòng) — chỉ đẩy vào danh sách `conflicts` để tự xử
      lý tay qua "Gỡ liên kết"/"Kiểm tra đồng bộ".
    - **`lib/deviceDeviceSync.ts`** — thêm `syncAllDeviceMirrorGaps()`, đối
      xứng nhưng đơn giản hơn hẳn vì `findMissingDeviceMirrors()` (mục 38) đã
      SẴN tính toàn bộ `gaps`/`mismatches` cho MỌI circuit trong 1 lần gọi —
      chỉ cần thêm vòng lặp ghi (mismatches → `conflicts` luôn, không cần
      thêm logic dò).
    - **`components/data-quality/DataQualityClient.tsx`** — `ScanFillGapsPanel`
      (mới): 1 nút "🔎 Quét & lấp đầy chỗ trống" gọi cả 3 hàm quét song song
      (`Promise.all`), gộp kết quả, hiện tóm tắt (đã tạo/đã liên kết/danh
      sách xung đột/danh sách lỗi), `router.refresh()` sau khi xong để cập
      nhật lại số đếm các tab.
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/data-quality`, `/odf-trunk`,
      `/odf-device`, `/odf-device/sua-luong` — 200. Chưa tự bấm nút thật
      (không có Playwright, và bấm thật sẽ GHI dữ liệu thật lên toàn trạm) —
      đã báo người dùng: bấm thử 1 lần, đọc kỹ tóm tắt trước khi tin, và đây
      cũng là cách xử lý luôn ca tồn đọng từ thử nghiệm ở mục 55 (xóa 1 bên
      trung kế) nếu vẫn còn treo.

57. **Giới hạn phạm vi cho "Quét & lấp đầy chỗ trống"** (người dùng phản hồi
    ngay sau mục 56: "quét toàn bộ thì sẽ bị chồng lấp đang đúng tự nhiên ở
    đâu nhập thêm vào thành sai. Quét theo ODF trung kế; quét theo ODF thiết
    bị ra; quét theo thiết bị"). Cũng nhân dịp này người dùng chỉ ra đúng 1 lỗ
    hổng khác của mục 56 (tự liên kết khi "tên khớp hệt" chỉ so tên, không so
    Vị trí ODF/Trib trong Chuyển tiếp) — quyết định: **giữ nguyên tạm thời**
    ("tạm theo thế đã"), người dùng sẽ tự kiểm tra 2 bên tay + dùng lại
    "Gỡ liên kết"/xóa-rồi-lưu-lại (mục 51/54) cho ca cần độ chính xác cao;
    CHƯA sửa thêm điều kiện Trib vào nhánh tự-liên-kết ở mục 56 (còn để ngỏ,
    chờ người dùng chủ động yêu cầu lại).
    - **`lib/mirrorTrunkCircuits.ts`** — thêm `MirrorScanScope` (3 field
      optional, so bằng CHUỖI không phải id — đơn giản, tái dùng field có sẵn
      trên từng dòng, không cần join thêm):
      - `trunkRackCode` — giới hạn theo 1 rack ODF TRUNG KẾ (áp cho vị trí
        ĐÍCH sẽ tạo/kiểm tra mirror, hoặc vị trí NGUỒN khi quét trung
        kế-trung kế — khớp 1 trong 2 là đủ).
      - `deviceRackCode` — giới hạn theo 1 rack ODF/DDF THIẾT BỊ (so
        `includes()` trên `device_position_own`/`targetOwnPosition` — chỉ để
        thu hẹp phạm vi quét, không phải validate chuẩn).
      - `deviceName` — giới hạn theo 1 thiết bị cụ thể, khớp cả khi thiết bị
        đó là NGUỒN lẫn ĐÍCH của 1 cặp.
      - Cả 3 optional, để trống hết = quét toàn trạm như mục 56 (hành vi cũ
        giữ nguyên, chỉ THÊM khả năng thu hẹp).
      - `syncAllTrunkMirrorGaps(scope?)`/`syncAllTrunkTrunkMirrorGaps(scope?)`
        nhận thêm tham số `scope`, lọc ngay trong vòng lặp đã có (không thêm
        query DB nào, lọc thuần trong bộ nhớ).
    - **`lib/deviceDeviceSync.ts`** — `syncAllDeviceMirrorGaps(scope?)`: LƯU
      Ý quan trọng — `findMissingDeviceMirrors()` vẫn phải chạy trên TOÀN BỘ
      dữ liệu KHÔNG lọc scope ở đầu vào (nó cần thấy hết mọi luồng của thiết
      bị ĐÍCH để biết đúng Trib nào đã có sẵn — lọc sớm sẽ làm SAI kết quả
      đối chiếu). Chỉ lọc scope ở OUTPUT (`gaps`/`mismatches`), sau khi đã
      tính xong đầy đủ. `DeviceMirrorMismatch` không mang theo vị trí/thiết
      bị NGUỒN (chỉ có `sourceCircuitName`) nên `mismatches` chỉ lọc được
      theo `deviceName` (khớp thiết bị ĐÍCH) — bỏ qua `deviceRackCode` cho
      danh sách này (thà hiện thừa còn hơn giấu mất 1 xung đột thật).
    - **`app/data-quality/page.tsx`** — tính `trunkRackCodes`/`deviceRackCodes`
      từ `trunkPorts` đã tải sẵn (có cả 2 domain `trunk`/`device`, không cần
      tải thêm gì) + `deviceNames` từ `devices`, truyền xuống
      `DataQualityClient`.
    - **`DataQualityClient.tsx` `ScanFillGapsPanel`** — thêm 3 ô chọn (rack
      trung kế / rack thiết bị / thiết bị, mỗi ô có lựa chọn "(mọi...)" =
      không giới hạn theo chiều đó), gộp thành `MirrorScanScope` truyền vào cả
      3 hàm quét. Chữ nút đổi động theo có chọn phạm vi hay không ("Quét &
      lấp đầy TOÀN TRẠM" khi để trống cả 3 ô, "...theo phạm vi đã chọn" khi
      có chọn) — để người dùng luôn biết rõ mình sắp quét rộng hay hẹp trước
      khi bấm.
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/data-quality`, `/odf-trunk`,
      `/odf-device` — 200. Chưa tự bấm thử trên UI (không có Playwright) —
      đã báo người dùng tự thử với 1 phạm vi hẹp trước (vd 1 rack cụ thể) để
      quen với tính năng, trước khi dùng chế độ quét toàn trạm.

58. **Ca thật phát hiện qua nút quét (mục 56/57)**: `GSCQ ADN1-2T9-QNM` (rack
    ODF1/14, port 44) báo xung đột "Port ODF1/1 (20) đang có luồng khác: DP3
    RMT1 ADN1-TKY". Người dùng hỏi thẳng nguồn gốc con số này ở đâu — tra ra:
    Chuyển tiếp CÓ SẴN TỪ TRƯỚC ở port 44 ghi "ODF1/1/20" (kiểu bare trung
    kế-trung kế), người dùng xác nhận port ODF1/1(19,20) đang dùng cho DP3
    RMT1 ADN1-TKY mới là ĐÚNG — tức Chuyển tiếp của GSCQ là dữ liệu sai/cũ,
    cần tự vào sửa (không tự sửa hộ, không biết nó phải trỏ đi đâu mới đúng).
    Sau đó người dùng hỏi tiếp: "mỗi lần vướng lại phải hỏi bạn lấy dữ liệu
    từ đâu đưa đến à, có cách nào ghi sẵn không" — đúng, nên **ghi thẳng
    nguồn gốc vào từng dòng xung đột** thay vì bắt hỏi lại mỗi lần.
    - **`MirrorGapScanSummary.conflicts`** thêm field `sourceHref?: string`
      (link bấm thẳng tới đúng dòng chứa dữ liệu NGUỒN).
    - **`lib/mirrorTrunkCircuits.ts`**:
      - `syncAllTrunkMirrorGaps` (device→trunk) — `detail` giờ nói rõ ĐÚNG
        field (`"Vị trí ODF (thiết bị)"`/`"Vị trí ODF (tiếp theo)"`, từ
        `cand.field`) + chữ gốc (`cand.rawText`) đã gây ra ứng viên này;
        `sourceHref` trỏ `/odf-device/sua-luong#${rowAnchor(sourceCircuit.id)}`.
      - `syncAllTrunkTrunkMirrorGaps` (trunk→trunk, ĐÚNG loại ca GSCQ) —
        thêm `portNumberByPortId` (map port_id → số port, đối xứng
        `rackCodeByPortId` đã có) để `detail` nói rõ **"Chuyển tiếp tại
        <rack nguồn> port <n> ghi "<chữ gốc>" → trỏ tới port <rack đích>
        (...)"** — đúng công thức người dùng cần để tự đi sửa mà KHÔNG phải
        hỏi lại; `sourceHref` trỏ `/odf-trunk/<rackId nguồn>#port-<portId
        nguồn>` (tái dùng cơ chế `#port-<id>` cuộn-tới-tô-sáng đã có sẵn ở
        `PortTable.tsx`, xem mục kiểm tra ODF1/1(43,44) ở phiên trước).
    - **`lib/deviceDeviceSync.ts`** — `DeviceMirrorMismatch` thêm
      `sourceCircuitId`/`sourceDeviceName` (trước đây bị thiếu — chỉ có
      `sourceCircuitName`, không đủ để dựng link hay lọc scope theo thiết bị
      NGUỒN). `syncAllDeviceMirrorGaps`'s `conflicts` giờ nói rõ thiết bị
      NGUỒN + `sourceHref` trỏ `/odf-device/sua-luong#${rowAnchor(...)}`; bộ
      lọc `deviceName` scope (mục 57) cũng được nâng cấp khớp CẢ nguồn lẫn
      đích (trước chỉ khớp đích).
    - **`DataQualityClient.tsx` `ScanFillGapsPanel`** — mỗi dòng xung đột
      giờ hiện TÊN dạng link (bấm mở tab mới `#port-<id>`/`#dc-<id>`) khi có
      `sourceHref`, kèm `detail` đầy đủ chữ gốc + vị trí — không cần hỏi lại
      "lấy ở đâu" nữa.
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/data-quality`, `/odf-trunk`,
      `/odf-device` — 200. Chưa tự bấm nút quét thật (không có Playwright) —
      đã báo người dùng tự thử lại, xác nhận dòng xung đột giờ đủ thông tin
      để tự đi sửa không cần hỏi thêm, và link bấm có nhảy đúng chỗ không.

59. **"Quét & lấp đầy" nhớ lại lần quét gần nhất, thêm nút "Làm mới"**
    (người dùng 2026-08-03, sau mục 58, chỉ ra 2 điểm bất hợp lý còn sót: (1)
    bấm link nguồn từ dòng xung đột → sửa xong ở tab khác → quay lại tab
    `/data-quality` cũ thì KHÔNG tự cập nhật; (2) tải lại trang là mất sạch
    kết quả quét, phải quét lại từ đầu). Ban đầu tôi đề xuất tách hẳn phần
    "phát hiện" (đọc, tính lại mỗi lần tải trang như 8 tab kia) khỏi phần
    "hành động" (ghi, vẫn bấm tay) — người dùng chốt lại đơn giản hơn, không
    tách 2 luồng riêng: *"quét nhân công, lưu lại lần quét cuối cùng mình
    quét; có thêm nút refresh trong phần này thì khi bấm refresh coi như quét
    lại nhưng chỉ quét phần đã chọn lần cuối. nếu muốn chọn vị trí khác thì
    lúc đó bấm quét và lấp đầy lại để quét. chú ý việc refresh là lựa chọn
    của lần trước đó (làm tươi mới mà)."* — làm đúng theo hướng này, KHÔNG
    làm bản tách đọc/ghi đã đề xuất.
    - **`DataQualityClient.tsx` `ScanFillGapsPanel`** — thêm
      `localStorage` key `hskt:dataQuality:scanFillGaps:last` (chỉ là tiện
      ích hiển thị trên trình duyệt đang dùng, KHÔNG phải nguồn dữ liệu thật
      — nguồn thật luôn là Supabase) lưu `{ scope, result, scannedAt }` mỗi
      lần quét thành công; đọc lại lúc mount (`useEffect`) để khôi phục kết
      quả + 3 ô chọn phạm vi + hiện dòng "Lần quét gần nhất: ... — phạm vi:
      ...".
    - Tách `lastScope` (state riêng, = phạm vi CỦA LẦN QUÉT GẦN NHẤT) ra khỏi
      3 ô chọn `trunkRackCode`/`deviceRackCode`/`deviceName` (state đang hiển
      thị trên UI, người dùng có thể đang đổi dở chưa bấm quét) — 2 hàm riêng:
      `runScan()` dùng giá trị 3 ô đang chọn (như cũ), `refreshScan()` dùng
      `lastScope`, KHÔNG đọc 3 ô hiện tại — đúng yêu cầu "refresh là lựa chọn
      của lần trước đó".
    - Nút mới "🔄 Làm mới (theo phạm vi lần quét trước)" chỉ hiện khi đã có
      `lastScope` (tức đã quét ít nhất 1 lần, kể cả từ phiên trước nhờ
      localStorage) — bấm là quét+vá lại (vẫn CÓ ghi dữ liệu, giống hệt
      "Quét & lấp đầy", chỉ khác nguồn phạm vi), rồi `router.refresh()` như cũ.
    - Lưu ý còn tồn tại (đã ghi rõ trong UI, không giấu): danh sách xung đột
      hiển thị vẫn là ảnh chụp tại lần quét gần nhất — sửa dữ liệu ở nơi khác
      xong vẫn phải tự bấm "Làm mới" 1 cái mới thấy cập nhật, không tự động.
      Đây là lựa chọn có chủ đích của người dùng (đổi lấy đơn giản, tránh
      phải tách 2 luồng đọc/ghi phức tạp hơn), không phải thiếu sót quên làm.
    - **Kiểm chứng**: `tsc --noEmit` sạch, curl `/data-quality` — 200. Chưa tự
      bấm nút quét/làm mới thật hay tự kiểm tra `localStorage` qua trình
      duyệt (không có Playwright) — đã báo người dùng tự thử: quét 1 lần, F5
      lại trang xem còn giữ kết quả + phạm vi không, đổi rack rồi bấm "Làm
      mới" xem có ĐÚNG bỏ qua ô mới đổi, quét lại đúng phạm vi cũ không.

60. **Gộp `/data-quality` từ 8 tab xuống 3 khung (bước 5/6, người dùng hỏi
    2026-08-03 trước khi làm mục 59: "xem việc điều chỉnh ở các khung khác có
    vấn đề gì với nội dung gộp các khung... để tab chất lượng dữ liệu còn lại
    2-3 khung thôi")** — đã PHÂN TÍCH rồi hỏi lại đúng 1 điểm còn mở (tách
    riêng "Xung đột vị trí" hay gộp chung để vừa đúng 2 khung) — người dùng
    chọn **"Tách riêng — 3 khung"**, đã code xong theo đúng lựa chọn này.
    - **Phát hiện quan trọng**: 4 trong 8 tab hiện tại (`trunkMissingDevice` =
      "Trung kế thiếu bên thiết bị", `unlinkedMirror` = "Thiết bị-Trung kế
      chưa liên kết", `mismatchedLinked` = "Đã liên kết nhưng lệch dữ liệu",
      `unlinkedDeviceMirror` = "Thiết bị-Thiết bị chưa liên kết") vốn được
      tính bằng các hàm CŨ, RIÊNG LẺ, có TRƯỚC (
      `findTrunkCircuitsMissingDeviceMirror` mục 45,
      `findAllDeviceTrunkPairs` mục sau đó, `findUnlinkedDeviceDevicePairs`)
      — về bản chất là CÙNG 1 loại rà soát "thiếu liên kết/lệch dữ liệu 2
      bên" mà `syncAllTrunkMirrorGaps`/`syncAllTrunkTrunkMirrorGaps`/
      `syncAllDeviceMirrorGaps` (mục 56-58, MỚI hơn, đã có breadcrumb/link)
      đang làm lại — chính là loại trùng lặp mà đề xuất gốc của người dùng
      muốn gộp. 4 tab còn lại (`transit` = "Chuyển tiếp chưa chuẩn", `devices`
      = "Thiết bị trùng gần đúng", `positions` = "Xung đột vị trí",
      `transitPositionMismatch` = "Chuyển tiếp sai tọa độ ODF") là 4 loại rà
      soát BẢN CHẤT KHÁC (định dạng/trùng tên/tranh chấp vị trí), không liên
      quan liên kết 2 bên.
    - **Cách gộp đã chọn — CHỈ gộp lớp hiển thị/điều hướng, KHÔNG viết lại
      logic 8 rà soát con**: cân nhắc lại lúc code hóa, thấy 4 tab "sync" có
      dữ liệu (`TrunkCircuitMissingDeviceMirror`/`CircuitPairDetail`/
      `UnlinkedDeviceDevicePair`) và hành vi xử lý (xóa-để-tự-tạo-lại /
      `CircuitPairSyncPanel` chọn bên đúng / tick xác nhận rồi Liên kết) khác
      nhau thật sự, không thể gộp thành 1 bảng chung mà không viết lại từ đầu
      — rủi ro cao, không cần thiết. Nên **giữ nguyên 100%** 8 component con
      (`TrunkMissingDeviceMirrorTab.tsx`, `UnlinkedMirrorPairsTab.tsx`,
      `MismatchedLinkedPairsTab.tsx`, `UnlinkedDeviceMirrorPairsTab.tsx`,
      `TransitFormatWarning.tsx`, `TransitPositionMismatchTab.tsx`,
      `DeviceDupTab`, `PositionConflictsTab`) — chỉ đổi `DataQualityClient.tsx`:
      `type Tab` từ 8 giá trị xuống còn `"sync" | "format" | "positions"`,
      thanh tab còn 3 nút (đếm gộp `syncCount`/`formatCount`), mỗi khung render
      các component con liên quan XẾP CHỒNG (`space-y-4`) thay vì phải bấm
      chuyển tab riêng từng cái — mỗi component con đã tự có `EmptyState`
      riêng nên xếp chồng không bị hở/thừa khoảng trắng khi rỗng. Khung "sync"
      đặt thứ tự: thiếu bên thiết bị → thiết bị-trung kế chưa liên kết → đã
      liên kết nhưng lệch → thiết bị-thiết bị chưa liên kết. Khung "format":
      chuyển tiếp chưa chuẩn → chuyển tiếp sai tọa độ → thiết bị trùng. Khung
      "positions" giữ y nguyên `PositionConflictsTab` như cũ.
    - Tab mặc định khi mở trang: `sync` nếu có gì đó cần xử lý
      (`syncCount > 0`), không thì `format`, không thì `positions` — thay cho
      chuỗi if/else 8 tầng cũ.
    - **Kiểm chứng**: `tsc --noEmit` sạch. `npm run dev` + curl `/`,
      `/data-quality`, `/odf-trunk`, `/odf-device`, `/odf-device/sua-luong`,
      `/dashboard` — tất cả 200. Chưa tự bấm chuyển 3 tab/kiểm tra từng khung
      hiện đúng nội dung xếp chồng trên UI thật (không có Playwright) — đã
      báo người dùng tự thử.

61. **Ca thật "ADX#16/LP1 và LP2 lộn trib, sửa xong OMS3255 (2/2/10, 2/4/10)
    vẫn không đồng bộ/liên kết" (người dùng 2026-08-03)** — tra thẳng vào dữ
    liệu thật (script tạm `_tmp-check-adx-oms*.ts`, xóa ngay sau khi dùng), 2
    phát hiện:
    - **Không phải lỗi**: cặp LP1 (`8d8c83f5...` ↔ `738a6196...`, ODF4/6
      (19,20) ↔ OMS3255 2/2/10) dữ liệu khớp 100% NHƯNG chưa từng gắn
      `mirror_of_id` — đây đúng loại "cả 2 bên đã có sẵn dữ liệu độc lập từ
      Excel gốc, chỉ thiếu liên kết" (LOẠI 4, mục 44/khung "Thiết bị-Thiết bị
      chưa liên kết") — loại NÀY LUÔN cần tự tick+bấm "Liên kết" tay, không
      có cơ chế tự động nào cho trường hợp CẢ 2 BÊN đã tồn tại sẵn (tự động
      chỉ chạy khi 1 bên đang TRỐNG hoàn toàn, xem mục 38/39). Xác nhận qua
      `findUnlinkedDeviceDevicePairs()`: cặp này đúng là đang nằm sẵn trong
      danh sách đó, 100% giống tên.
    - **Phát hiện dữ liệu thừa thật**: còn 1 dòng ADX cũ (`ccbbe426...`) vẫn
      ghi nhãn "ADX#16/LP1" nhưng `device_position_next` trỏ tới OMS3255
      2/4/10 (đúng ra là vị trí của LP2) — rác còn sót lại từ TRƯỚC khi người
      dùng tạo dòng LP2 đúng thay thế (`c2239e23...`, đã có `mirror_of_id`
      trỏ đúng `96ed461c...`). Dòng rác này cũng hiện trong "chưa liên kết"
      (97% giống, ghép NHẦM với đúng dòng LP2 gốc) — đã CẢNH BÁO người dùng
      không bấm "Liên kết" ở dòng đó (sẽ phá liên kết LP2 đúng vừa tạo), tự
      vào kiểm tra rồi xóa nếu đúng là rác — KHÔNG tự xóa hộ (đúng nguyên tắc
      không tự quyết định bên nào đúng khi chưa chắc, để người dùng — người
      có đủ ngữ cảnh vật lý thật — tự xác nhận).
    - Không sửa code gì ở mục này (không phải bug, chỉ là tra + giải thích +
      cảnh báo false-positive trong danh sách gợi ý).

62. **BUG THẬT (người dùng 2026-08-03, ca "thêm luồng ADN1.ASBR#2-MX2020
    (2/1/8) đi ODF 1/2 (47,48) — không tự tạo mirror trung kế")** — tra thẳng
    dữ liệu (script tạm `_tmp-check-asbr*.ts`, xóa sau khi dùng) xác nhận: port
    ODF1/2 (47,48) THẬT SỰ đang trống hoàn toàn, `findTrunkMirrorCandidates()`
    tính đúng y hệt candidate cần tạo — nghĩa là đây KHÔNG phải ca "cần xử lý
    tay" như mục 61, mà cơ chế tự tạo mirror (mục 39) đúng ra phải chạy được
    nhưng đã không chạy — có bug thật trong code.
    - **Nguyên nhân**: `DeviceCircuitList.tsx` `submitCreate()`/`saveEdit()` —
      dòng gọi `autoMirrorAfterSave(...)` (mục 38/39, gồm CẢ phần tự tạo
      mirror trung kế `autoCreateTrunkMirrorForCircuit`) bị đặt LỘN vào TRONG
      khối `if (!isCableMode) { ... }` — khối này đúng ra chỉ nên bọc 2 dòng
      `maybeGrowLibrary`/`maybeCreateNextDevice` (2 dòng CHỈ có ý nghĩa khi Ô2
      là 1 THIẾT BỊ, không áp dụng khi Ô2 là 1 tuyến cáp quang trỏ thẳng ODF
      trung kế). Hệ quả: **MỌI luồng nhập ở Chế độ Cáp quang (isCableMode) từ
      trước tới giờ — chính là loại luồng CẦN autoMirrorAfterSave NHIỀU NHẤT
      vì đầu kia luôn là 1 port ODF trung kế cụ thể — chưa BAO GIỜ tự tạo
      được mirror trung kế**, âm thầm không ai biết cho tới ca thật này.
    - **Sửa**: tách riêng — `maybeGrowLibrary`/`maybeCreateNextDevice` vẫn giữ
      nguyên trong `if (!isCableMode)`, còn `await autoMirrorAfterSave(...)`
      đưa RA NGOÀI, chạy ở CẢ 2 chế độ (2 chỗ: `saveEdit()` và
      `submitCreate()`). Xác nhận an toàn khi chạy ở Chế độ Cáp quang: nhánh
      device-device bên trong `autoMirrorAfterSave` (`autoCreateMirrorForCircuit`)
      parse tên "thiết bị" ở Ô2 ra thực chất là tên TUYẾN CÁP, không khớp
      bảng `devices` nào nên tự trả `"no-gap"`, không gây hại — chỉ nhánh
      trung kế (đúng cái cần) mới thực sự chạy có tác dụng.
    - **CHƯA lấp lại các gap CŨ đã bị bỏ sót do bug này** (chỉ ngăn được gap
      MỚI từ giờ trở đi — sửa code không tự chạy lại cho dữ liệu cũ). Vì bug
      này có thể đã âm thầm ảnh hưởng NHIỀU luồng Cáp quang khác từ trước
      (không chỉ ca ASBR#2-MX2020 này), đã khuyên người dùng chạy "🔎 Quét &
      lấp đầy" (mục 56, KHÔNG giới hạn phạm vi = quét toàn trạm 1 lượt) để tự
      động lấp lại toàn bộ các gap kiểu này cùng lúc, an toàn (chỉ tạo mới ở
      chỗ ĐANG TRỐNG THẬT, xung đột thật chỉ liệt kê không tự đụng).
    - **Kiểm chứng**: `tsc --noEmit` sạch. curl `/`, `/data-quality`,
      `/odf-trunk`, `/odf-device`, `/odf-device/sua-luong` — 200. Chưa tự bấm
      thử "Thêm luồng" ở Chế độ Cáp quang thật trên UI để xác nhận mirror
      trung kế tự xuất hiện (không có Playwright) — đã báo người dùng tự thử
      lại đúng ca ASBR#2-MX2020 hoặc 1 luồng cáp quang mới bất kỳ.

63. **BUG THẬT thứ 2, cùng ca ASBR#2-MX2020 (người dùng 2026-08-03, sau khi
    tự chạy "Quét & lấp đầy" theo lời khuyên mục 62): "liên kết đã đồng bộ
    qua ODF 1/2 (47,48) nhưng lại không có thông tin Chuyển tiếp — bấm Kiểm
    tra đồng bộ thì bên thiết bị đủ, bên trung kế trống — sao không tiến hành
    sync luôn?"** — đúng câu hỏi cốt lõi: mirror ĐÃ tạo đúng (`circuits` +
    `port_circuit_links` + `mirror_of_id` đều ổn), nhưng thiếu 1 việc riêng.
    - **Nguyên nhân**: "Chuyển tiếp" hiển thị ở Hồ sơ ODF trung kế đọc từ
      bảng RIÊNG `transit_links.raw_text` (không phải suy ra từ
      `circuits`/`port_circuit_links`) — `CircuitPairSyncPanel`/
      `findLinkedDeviceTrunkPairs()` (lib/circuitPairSync.ts) tách
      `trunkTransitOdfPart`/`trunkTransitTrib` TỪ CHÍNH dòng `transit_links`
      này. `autoCreateTrunkMirrorForCircuit()`/`syncAllTrunkMirrorGaps()`
      (mục 39/56) khi tạo mirror mới trước giờ CHỈ insert `circuits` +
      `port_circuit_links` + cập nhật `ports.status` — **quên hẳn** insert
      dòng `transit_links` tương ứng — nên mirror tạo ra tuy hoạt động đúng
      (đã liên kết, đã tính đúng trong mọi rà soát) nhưng "trông trống" khi
      xem trực tiếp ở bảng port/khi mở "Kiểm tra đồng bộ". Cơ chế push dữ
      liệu thiết bị → `transit_links` này VỐN ĐÃ CÓ SẴN — chỉ nằm ở
      `applySyncFromDevice()` (dùng cho luồng người dùng tự bấm "Áp dụng đồng
      bộ" ở panel), CHƯA từng được gọi từ 2 hàm tự-tạo-mirror.
    - **Sửa**: thêm hàm dùng chung `buildTransitRawTextFromDevice(sourceCircuit)`
      (lib/mirrorTrunkCircuits.ts) — dựng đúng CHUỖI Y HỆT
      `applySyncFromDevice()` đang dùng ("<Vị trí ODF thiết bị> - <Tên thiết
      bị> (<Trib>)"), không viết lại quy ước khác rồi lệch nhau. Gọi hàm này
      + `insert` vào `transit_links` (`source_port_id` = port ĐẦU TIÊN của
      cặp port, `target_type: "text_only"`) ngay sau bước cập nhật
      `ports.status` — ở CẢ 2 nơi: `autoCreateTrunkMirrorForCircuit` (tạo lúc
      lưu form) VÀ vòng lặp tạo mới trong `syncAllTrunkMirrorGaps` (tạo lúc
      quét hàng loạt). Bỏ qua (không insert) nếu luồng gốc thiếu 1 trong 3
      trường own/deviceName/trib — không ghi text rỗng/thiếu.
    - **Đã lấp lại các mirror CŨ bị tạo thiếu `transit_links` từ trước** —
      người dùng xác nhận "có" khi được hỏi có muốn quét+vá hàng loạt không.
      Script mới `scripts/backfill-transit-links-for-mirrors.ts` (thêm npm
      script cùng tên) — xác định ứng viên bằng CẤU TRÚC dữ liệu (không dựa
      chữ trong `notes`, tránh lệch nếu ai từng sửa tay): circuit có
      `mirror_of_id` trỏ tới 1 luồng CÓ `device_id` (chiều thiết bị->trung
      kế) + chính nó CÓ `port_circuit_links` (xác nhận là luồng trung kế thật)
      + port đầu tiên CHƯA có `transit_links` nào — dựng `raw_text` bằng ĐÚNG
      công thức `buildTransitRawTextFromDevice()` mới thêm ở trên. DRY RUN mặc
      định, `--commit` để ghi thật (đúng quy ước mọi script khác trong dự án).
    - Chạy dry-run lần 1: phát hiện **62 luồng** thiếu (gồm đúng luồng
      ASBR#2-MX2020 (2/1/8) đã biết), 4 đã có sẵn, 52 bị loại vì không phải
      mirror thiết bị->trung kế (đa số là mirror thiết bị-thiết bị, không có
      port nên không áp dụng), 0 lỗi. Người dùng xác nhận danh sách hợp lý,
      chọn "Chạy ghi thật ngay" — chạy `--commit`: **62/62 tạo thành công, 0
      lỗi**. Chạy lại dry-run lần 2 xác nhận **0 còn thiếu** (66 đã có =
      4 gốc + 62 vừa vá) — idempotent, an toàn chạy lại sau này nếu phát sinh
      thêm mirror mới bị thiếu vì lý do khác.
    - Giữ lại script này trong `scripts/` (không xóa như script `_tmp-*`) —
      hữu ích chạy lại định kỳ hoặc sau khi phát hiện lỗ hổng tương tự khác.
    - **Kiểm chứng**: `tsc --noEmit` sạch. curl `/`, `/data-quality`,
      `/odf-trunk`, `/odf-device`, `/odf-device/sua-luong` — 200. Chưa tự bấm
      thử tạo mirror mới thật + xem "Chuyển tiếp" tự xuất hiện trên UI, cũng
      chưa tự vào `/odf-trunk` xem 62 dòng vừa vá hiển thị đúng cột "Chuyển
      tiếp" (không có Playwright) — đã báo người dùng tự thử, đặc biệt kiểm
      lại đúng port ODF 1/2 (47,48) của ca ASBR#2-MX2020 mở đầu.

64. **Bước 4/6 của đề xuất "Nhất quán liên kết" (người dùng đưa lại nguyên
    văn tài liệu gốc 2026-08-03, yêu cầu "còn mục nào chưa làm thì tiếp
    tục")** — "dọn tồn đọng dữ liệu cũ qua các script rà soát hiện có tới khi
    hàng đợi về 0 hoặc chỉ còn case thật sự cần mắt người".
    - Chạy `audit-device-device-sync`/`audit-trunk-trunk-sync`/
      `audit-device-trunk-sync` (đọc dữ liệu SỐNG, không phải ảnh chụp cũ) để
      biết tồn đọng THẬT hiện tại — không giả định "Quét & lấp đầy" đã chạy
      trước đó (mục 62) đã dọn hết mọi loại, vì nó CHỈ xử lý 2 loại (tạo mới
      chỗ trống hẳn + liên kết khi tên khớp y hệt), KHÔNG đụng loại "cả 2 bên
      đã có sẵn dữ liệu khác tên, chỉ nghi là 1 luồng" (LOẠI 3/4, mục 47/48 —
      cố tình KHÔNG tự động theo quyết định người dùng, xem lib/unlinkedMirrorPairs.ts).
    - **Phần CƠ HỌC (an toàn, tự động được) — đã dọn về 0**: `audit-device-
      device-sync` sẵn đã 0/0. `audit-device-trunk-sync` còn đúng 1 gap
      (ODF2/13 (05,06), luồng "GE AĐN1.PE#2 (11/1/5)...") — chạy `npm run
      sync-missing-trunk-circuits -- --commit`, tạo xong. `audit-trunk-trunk-
      sync` còn 1 dòng NHƯNG không phải gap thường (port 6 của cặp (6,7) đã
      có ĐÚNG luồng cùng tên "3G BTS Vina", chỉ port 7 chưa được gộp vào cùng
      `port_circuit_links` — bản chất khác "tạo circuit mới hẳn", script
      hiện có không xử lý được ca này, để lại cho người dùng tự vào port 7
      rack ODF6/3 xử lý tay).
    - **Phát hiện thêm 1 bug con khi chạy `sync-missing-trunk-circuits.ts`**:
      script CLI này có khối tạo `circuits`+`port_circuit_links` RIÊNG, KHÔNG
      dùng chung `autoCreateTrunkMirrorForCircuit()` (chỉ dùng chung
      `findTrunkMirrorCandidates()` để DÒ, không dùng chung phần GHI) — nên
      SAU KHI đã sửa bug thiếu `transit_links` ở mục 63 (chỉ sửa trong
      `lib/mirrorTrunkCircuits.ts`), luồng vừa tạo bằng SCRIPT này (ODF2/13)
      vẫn bị thiếu y hệt lỗi cũ. Export thêm `buildTransitRawTextFromDevice()`
      (trước đó không export) và gọi trong `sync-missing-trunk-circuits.ts`
      ngay sau bước `ports.status` — đúng bài học mục 34/35 (logic ghi bị copy
      2 nơi RẤT dễ lệch nhau, nên tách hàm dùng chung ngay khi phát hiện, dù
      chỉ mới lệch 1 chỗ). Chạy lại `backfill-transit-links-for-mirrors --commit`
      1 lượt nữa để vá luôn dòng ODF2/13 vừa tạo thiếu — tạo thêm đúng 1.
    - **Phần CẦN MẮT NGƯỜI (không thể/không nên tự động theo đúng chính sách
      đã chốt — KHÔNG liên kết hàng loạt dù % giống tên cao, xem mục 47/48)
      — số liệu THẬT tính trực tiếp từ dữ liệu sống, KHÔNG phải mục tiêu "về
      0"**:
      - Thiết bị-Trung kế chưa liên kết: 200 cặp.
      - Thiết bị-Thiết bị chưa liên kết: 436 cặp.
      - Chuyển tiếp chưa chuẩn form: 341 dòng.
      - Chuyển tiếp sai tọa độ ODF (vs `device_position_map`): 11 dòng.
      - Thiết bị trùng gần đúng: 5 cặp.
      - Đã liên kết nhưng lệch dữ liệu: 1 cặp.
      - Xung đột vị trí: 0.
      Số lượng LỚN (200-436) không phải dấu hiệu bug — đây đúng là khối lượng
      tồn đọng THẬT từ dữ liệu Excel gốc (2 dòng độc lập/mỗi luồng nhập từ
      trước khi có `mirror_of_id`), và theo đúng quyết định người dùng đã
      chốt nhiều lần trong phiên trước (mục 47/48: *"chỉ liệt kê... không có
      liên kết hàng loạt"*) — KHÔNG tự động gắn dù giống tên cao, rủi ro
      xóa lây (`on delete cascade`) nhầm 2 luồng không liên quan. Việc rà tay
      qua UI khung "Liên kết & đồng bộ 2 chiều" (mục 60) vẫn còn nguyên —
      bước 4 chỉ đảm bảo phần MÁY LÀM ĐƯỢC AN TOÀN đã sạch, phần còn lại là
      khối lượng công việc thật, không phải lỗi cần sửa thêm.
    - **Kiểm chứng**: `tsc --noEmit` sạch sau khi export `buildTransitRawTextFromDevice`
      + sửa `sync-missing-trunk-circuits.ts`. curl `/`, `/data-quality`,
      `/odf-trunk`, `/odf-device`, `/odf-device/sua-luong` — 200. 3 script
      audit chạy lại xác nhận đúng số liệu trên.

65. **Đợt 1 của tài liệu audit toàn dự án (người dùng gửi nguyên văn
    `HSKT-audit-2026-08-03.md` + `HSKT-dot-1-brief.md` ngày 2026-08-03, yêu
    cầu "tiếp tục thực hiện theo file md tôi gửi")** — brief chốt sẵn 2 bất
    biến nghiệp vụ BB-1/BB-2 và 4 bước cụ thể, phạm vi hẹp (KHÔNG đụng
    transaction/RPC — để dành đợt sau).
    - **BB-2** (app dùng thật trên di động ngoài hiện trường) → **Bước 1**:
      `components/Sidebar.tsx` — dải hover 3px mép trái vốn chỉ nhận hover
      chuột (vô dụng trên cảm ứng) nay thêm `onClick`/`onKeyDown`/`role=
      "button"`; thêm nút `☰` luôn hiện góc trái trên khi menu đang ẩn; thêm
      lớp phủ nền mờ đóng menu khi bấm ra ngoài; thêm `aria-label` cho nút
      tìm kiếm/ghim.
    - **Bước 2**: `findAllDeviceTrunkPairs()` (lib/circuitPairSync.ts) trước
      đây tự gọi lại `findUnlinkedMirrorPairs()` bên trong dù nơi gọi
      (`/odf-trunk/[rackId]`, `/odf-device/sua-luong`) đã tính sẵn — tính
      trùng 2 lần cùng 1 dữ liệu. Thêm tham số thứ 3 tùy chọn
      `precomputedUnlinked` để tái dùng kết quả đã có, không đổi hành vi khi
      không truyền (tương thích ngược).
    - **Bước 3**: `AddDeviceRackForm.tsx`/`RackAdminPanel.tsx` (tạo rack ODF
      trung kế/thiết bị) trước đây không kiểm tra trùng `code` trước khi
      insert — lỗi 23505 từ Postgres hiện nguyên dạng khó hiểu cho người
      dùng. Thêm bước `select` kiểm tra trùng `(station_id, code)` trước khi
      insert, báo lỗi tiếng Việt rõ ràng; thêm dịch mã lỗi 23505 trong nhánh
      catch (phòng race condition giữa lúc check và lúc insert thật). Kèm
      migration `20260804000001_racks_code_unique.sql` — thêm ràng buộc
      `unique index (station_id, code)` ở tầng DB (UI check không đủ để
      chống race condition 2 người dùng bấm cùng lúc).
    - **Bước 4** (nặng nhất) — **"Một đường ghi duy nhất cho Chuyển tiếp"**:
      rà soát phát hiện **6 nơi** ghi `transit_links.raw_text` với **2 hành
      vi khác nhau** (PortTable.saveEdit ghi ĐỦ mọi port active; 5 nơi còn
      lại — applySyncFromDevice, mirrorTrunkCircuits.ts×2,
      sync-missing-trunk-circuits.ts, backfill-transit-links-for-mirrors.ts —
      chỉ ghi port ĐẦU TIÊN) → nguồn gốc gián tiếp của bug thiếu "Chuyển
      tiếp" ở mục 63/64.
      - Viết đường ghi duy nhất `writeTransitForPorts(portIds, rawText)`
        (`lib/transitLinks.ts`) — tự đọc dữ liệu hiện có trên các port trước
        khi ghi, xử lý đủ 3 case: xóa (rawText rỗng), update+insert đồng bộ
        mọi port, và **case bảo vệ**.
      - **Trước khi code case bảo vệ**: rà dữ liệu SỐNG (chỉ đọc) tìm mọi
        circuit có ≥2 port đang mang `raw_text` KHÁC nhau — brief giả định
        BB-1 ("2 sợi Tx/Rx của CÙNG 1 luồng LUÔN chuyển tiếp về CÙNG 1 chỗ,
        không có ngoại lệ") là tuyệt đối. Kết quả rà thật: **11 circuit**
        thật sự có 2 port mang giá trị khác nhau, toàn bộ đều là thiết bị
        khuếch đại quang/DWDM (MLA/SRA/CPL/WDM, vd "CPL/MLA2/Port 5 (Tx
        Out)" khác "CPL/MLA2/Port 8 (Rx IN)") — mâu thuẫn trực tiếp với BB-1
        như brief viết. Dừng lại, trình bày đúng 11 ca kèm ví dụ cho người
        dùng thay vì tự áp cứng công thức "luôn ghi giống nhau" của brief.
        **Người dùng xác nhận 2026-08-04**: "11 ca này có đúng là ngoại lệ
        hợp lệ (thiết bị khuếch đại, Tx/Rx đi khác port)" — tức BB-1 đúng
        với ĐA SỐ nhưng KHÔNG tuyệt đối. `writeTransitForPorts()` vì vậy có
        rule: nếu các port truyền vào ĐANG có sẵn ≥2 giá trị khác nhau (đã
        khác nhau TỪ TRƯỚC, không phải do lần ghi này) → coi là ngoại lệ hợp
        lệ, CHỈ điền port đang trống, không đụng port đã có giá trị — không
        có nơi gọi nào (kể cả PortTable.saveEdit) có thể vô tình ép đồng
        nhất 11 ca này nữa.
      - Thay cả 6 nơi ghi cũ bằng gọi `writeTransitForPorts()` — không viết
        lại công thức riêng ở đâu nữa (bài học mục 34/35/63 lặp lại: logic
        ghi bị copy nhiều nơi rất dễ lệch nhau).
      - **Bug phụ phát hiện khi sửa**: `scripts/sync-missing-trunk-circuits.ts`
        crash ngay khi chạy (`Thiếu NEXT_PUBLIC_SUPABASE_URL...`) vì 1 import
        tĩnh ở đầu file tải `lib/supabase.ts` TRƯỚC khi `loadEnv()` của
        chính script kịp chạy (đúng bẫy đã ghi ở quy ước dự án — script CLI
        phải dùng `await import()` động cho mọi module xuyên qua
        `lib/supabase.ts`). Sửa xong, verify chạy sạch.
      - **Vá dữ liệu cũ**: script mới `scripts/repair-transit-per-circuit.ts`
        (dry-run mặc định, `--commit` để ghi thật) — Phần A gộp các dòng
        `transit_links` bị ghi trùng y hệt nhau trên cùng 1 port (rà thật
        thấy đúng 1 port bị trùng 3 dòng, gộp còn 1); Phần B backfill circuit
        có port thiếu "Chuyển tiếp" so với port kia cùng luồng, dùng lại
        chính `writeTransitForPorts()` (tự bảo vệ 11 ca ngoại lệ, không đụng
        gì tới chúng). Dry-run xác nhận đúng số đã tính tay trước đó bằng
        rà dữ liệu sống: 498 circuit cần vá + 11 bảo vệ = 509 circuit lệch,
        cộng 19 circuit đã đủ sẵn = 528 circuit ≥2 port có `transit_links`.
        Người dùng duyệt, chạy `--commit` **2026-08-04**:
        498 circuit đã vá, 11 vẫn nguyên vẹn không bị đụng. Dry-run lần 2
        xác nhận sạch: 0 dòng trùng còn lại, 0 circuit còn thiếu.
      - Sau khi dữ liệu sạch, thêm migration
        `20260804000002_transit_links_unique_port.sql` — xóa index thường cũ
        `idx_transit_source`, thay bằng `unique index` cùng cột
        `source_port_id`, chốt bất biến "1 port chỉ có đúng 1 dòng Chuyển
        tiếp" ở tầng DB thay vì chỉ dựa vào code. An toàn với
        `writeTransitForPorts()` vì hàm này luôn đọc trước rồi mới quyết
        định update hay insert (không bao giờ insert trùng port đã có
        dòng). Cả 2 migration (`racks_code_unique` + `transit_links_unique_port`)
        đã được người dùng tự chạy tay trong Supabase SQL Editor, xác nhận
        thành công **2026-08-04**.
      - **Bước 4e**: thêm khung rà soát mới "Luồng có 2 sợi ghi Chuyển tiếp
        khác nhau" ở `/data-quality` (nhóm tab "Định dạng") —
        `findDivergentTransitGroups()` (lib/transitLinks.ts, thuần, không
        query thêm vì `trunkPorts` đã có sẵn `transitText`/`circuit` mỗi
        port) + `DivergentTransitTab.tsx`. CHỦ ĐỘNG khác các tab mismatch
        khác trong trang: KHÔNG có nút tự sửa, vì phần lớn ca thuộc nhóm này
        là ngoại lệ hợp lệ (11/11 ca đã rà là thiết bị khuếch đại/DWDM) — chỉ
        liệt kê để dễ thấy/dễ rà nếu phát sinh ca mới thật sự sai, không phải
        mục tiêu "dọn về 0". Verify qua HTML render thật: đúng 11 luồng hiện
        ra, khớp số đã xác nhận với người dùng.
    - Bước 0 của brief (bật Vercel Deployment Protection) — người dùng xác
      nhận **2026-08-04 bỏ qua có chủ đích**: tính năng này (Password
      Protection/Vercel Authentication) chỉ có ở gói Pro, tài khoản đang dùng
      là Free. Không phải thiếu sót, không cần nhắc lại trừ khi sau này nâng
      gói.
    - **Kiểm chứng cuối đợt**: `tsc --noEmit` sạch, `npm run build` sạch
      (14 trang, không lỗi). 3 script audit (`audit-device-trunk-sync`/
      `audit-trunk-trunk-sync`/`audit-device-device-sync`) chạy lại trên dữ
      liệu sống sau khi vá — 0 gap mới phát sinh; 2 dòng còn lại ở
      `audit-trunk-trunk-sync` (rack ODF6/4↔ODF6/3) là ca CŨ đã biết từ mục
      64 (cần tay xử lý, không phải regression của đợt này). Chưa tự test
      cảm ứng Sidebar ở viewport hẹp qua trình duyệt thật (không có
      Playwright) — đã báo người dùng tự thử trên di động ngoài hiện trường.
    - **Đợt 1 hoàn tất** theo đúng phạm vi `HSKT-dot-1-brief.md` đã chốt.

66. **Đợt 2 của `HSKT-audit-2026-08-03.md` mục 7 ("Nhất quán dữ liệu")** —
    người dùng yêu cầu 2026-08-04 "tiếp tục các nội dung còn lại của các
    đợt". Mục 2.1/2.2 (1 hàm ghi `transit_links` duy nhất + script vá) đã
    làm xong trong Đợt 1 (mục 65) dù audit gốc xếp vào Đợt 2 — phần còn lại
    của Đợt 2 là 2.3/2.4/2.5:
    - **2.3/2.4 — 2 hàm RPC xóa nguyên tử** (`supabase/migrations/
      20260804000003_delete_rpc_and_mirror_unique.sql`): trước đây
      `PortTable.deleteGroup()` là 4 lời gọi Supabase độc lập từ trình
      duyệt (xóa `port_circuit_links` → xóa `circuits` → update
      `ports.status` → xóa `transit_links`); mất mạng/đóng tab giữa chừng
      để lại trạng thái dở dang không tự phát hiện được (circuit đã xóa
      nhưng port vẫn `in_use`). Tương tự `DeviceCategoryClient.
      deleteSelectedDevices()` (5+ lời gọi, chia batch 200).
      - `delete_trunk_circuit(p_circuit_id uuid)` — gộp đúng 4 bước cũ vào 1
        hàm `plpgsql`, `security invoker` (tôn trọng RLS người gọi, sẵn sàng
        cho lúc bật Auth thật mà không cần sửa lại hàm). `PortTable.
        deleteGroup()` giờ chỉ còn 1 lời gọi `supabase.rpc(...)`.
      - `delete_devices_with_circuits(p_device_ids uuid[])` — gộp phần THUẦN
        CƠ HỌC (xóa circuits theo device_id, dọn port/transit_links của
        mirror trung kế bị cascade xóa theo, xóa devices) vào 1 hàm, nhận
        thẳng mảng id (không cần tự chia batch 200 như code cũ — Postgres
        xử lý `= any(uuid[])` tốt với mảng lớn). **Cố ý KHÔNG** đưa bước dọn
        `device_position_map` vào RPC — bước đó khớp theo tên đã chuẩn hóa
        qua `normalizeDeviceNameKey()` (hàm JS, chưa có bản SQL tương
        đương) nên vẫn giữ là lời gọi JS riêng, best-effort, SAU khi RPC
        thành công — đúng hành vi cũ (không đổi ngữ nghĩa, chỉ thu hẹp cửa
        sổ "dở dang" xuống đúng phần thuần cơ học).
      - Tương tự, phần business logic thật (tự tạo lại mirror sau khi xóa ở
        `deleteGroup`, dùng `autoCreateTrunkMirrorForCircuit` — có logic dò/
        khớp vị trí) KHÔNG đưa vào RPC, vẫn ở tầng JS, gọi SAU khi RPC thành
        công, y hệt trước.
      - **Verify**: viết script test tạm (tự tạo rack/port/circuit/device
        giả với tiền tố `TEST_RPC_DELETE_TMP`, gọi RPC, kiểm 10 assertion,
        tự dọn sạch ở `finally` bất kể pass/fail, xóa script sau khi chạy) —
        cả 2 RPC pass toàn bộ, bao gồm đúng ca cascade mirror qua
        `mirror_of_id on delete cascade`.
    - **2.5 — `unique(mirror_of_id)` + `check(mirror_of_id <> id)`**: mô
      hình nghiệp vụ 1-1 (1 luồng thiết bị ↔ 1 luồng trung kế mirror) trước
      đây không được CSDL giữ — 2 luồng trung kế có thể cùng trỏ
      `mirror_of_id` về 1 luồng thiết bị, xóa luồng gốc sẽ cascade xóa CẢ
      HAI dù luồng thứ 2 có thể là 1 đấu nối khác. Kiểm tra dữ liệu sống
      2026-08-04 (script đọc trực tiếp Supabase) TRƯỚC khi thêm ràng buộc:
      119 dòng có `mirror_of_id`, 0 self-reference, 0 nhóm trùng — an toàn
      thêm ngay, không cần dọn dữ liệu trước.
    - Migration đã được người dùng tự chạy tay trong Supabase SQL Editor,
      xác nhận thành công 2026-08-04.
    - **Kiểm chứng**: `tsc --noEmit` sạch, `npm run build` sạch. 3 script
      audit chạy lại — 0 gap mới, 2 dòng còn lại ở `audit-trunk-trunk-sync`
      là ca cũ đã biết (mục 65), không phải regression.
    - **KHÔNG làm trong đợt này** (ngoài phạm vi 2.3/2.4/2.5): chuyển
      `confirmMove()`/`saveEdit()` sang RPC (audit mục 2.3 xếp ưu tiên
      3/4, không nằm trong bảng lộ trình Đợt 2 chính thức — để đợt sau nếu
      cần); đổi mô hình `transit_links` sang khóa theo `circuit_id` (Phụ lục
      A của brief Đợt 1 — cố ý để đợt sau).
    - **Đợt 3 của audit (`3.1` Bật Supabase Auth, `3.2` tách quyền DELETE ở
      CSDL) mâu thuẫn trực tiếp với `CLAUDE.md`**: *"Không tự thêm
      authentication ở giai đoạn MVP"*. Đây là xung đột giữa 1 đề xuất
      trong tài liệu audit (viết trước, chưa biết nguyên tắc MVP hiện hành)
      và 1 quy ước dự án đang có hiệu lực — KHÔNG tự ý làm 3.1/3.2 khi chưa
      hỏi lại người dùng xác nhận có muốn đổi nguyên tắc MVP hay không.
      Phần còn lại của Đợt 3 (3.3-3.5, thuần UI — chuyển nút xóa xuống khung
      "Thao tác nguy hiểm" cuối trang, gõ xác nhận + giới hạn 20 dòng cho
      xóa hàng loạt, đưa "Xóa" khỏi hàng nút `PortTable`) không phụ thuộc
      Auth, có thể làm độc lập.

67. **Đợt 3 (tiếp) — Bật Supabase Auth thật (3.1/3.2 của audit)**. Hỏi lại
    người dùng theo đúng mục 66 đã ghi — **2026-08-06 người dùng xác nhận
    bật ngay, chấp nhận đổi nguyên tắc "không auth ở MVP"** (chỉ 1 tài khoản,
    chính người dùng). `CLAUDE.md` đã cập nhật ghi lại quyết định này.
    - **Phát hiện thêm khi tự rà lại (ngoài phạm vi audit gốc)**: bảng
      `device_aliases` (migration `20260801000001`) **chưa từng bật RLS,
      không có policy nào** — mở hoàn toàn qua GRANT mặc định của Supabase,
      cùng mức rủi ro như 10 bảng có `mvp_allow_all` dù không cùng tên. Xử
      lý cùng đợt, không bỏ sót — xem migration bên dưới.
    - **Bài toán kiến trúc cốt lõi**: 16 file `lib/*.ts` dùng chung (fetch/
      mutation, gọi từ HẦU HẾT mọi trang lúc SSR) trước đây import thẳng 1
      singleton `supabase` (anon key) — không còn đúng khi có phiên đăng
      nhập, vì các hàm này được gọi từ CẢ Server Component (cần client đọc
      cookie qua `next/headers`, chỉ hợp lệ trong phạm vi 1 request) LẪN
      Client Component (cần client trình duyệt tự mang cookie) LẪN **9 script
      CLI** chạy `tsx` (không có `next/headers`, cần service-role key như cũ).
      1 singleton module-level không thể đúng cho cả 3.
    - **Giải pháp đã chọn — dependency injection bắt buộc, không dùng
      accessor "tự phát hiện môi trường"**: mọi hàm trong 16 file (+ 1 file
      bị sót lúc rà đầu — `lib/reverseDeviceTrunkAudit.ts`) nhận tham số
      `client: SupabaseClient` **bắt buộc** (không default) làm tham số ĐẦU
      TIÊN, dùng kỹ thuật shadow biến (`const supabase = client;` ngay đầu
      thân hàm) để phần thân hàm bên trong (mọi `supabase.from(...)`) không
      cần đổi gì thêm. Bắt buộc (không default) là cố ý: 1 tham số có default
      rủi ro 1 nơi gọi âm thầm dùng nhầm client và nhận về rỗng thay vì lỗi
      rõ ràng — đúng bẫy `mvp_allow_all` từng che giấu; tham số bắt buộc biến
      lỗi quên truyền thành **lỗi biên dịch `tsc`**, dùng chính `tsc --noEmit`
      làm lưới an toàn dò hết mọi chỗ gọi thiếu, không cần tự liệt kê tay.
    - **3 client cụ thể**:
      - `lib/supabase.ts` (giữ nguyên tên/đường dẫn) — đổi `createClient` →
        `createBrowserClient` (`@supabase/ssr`), vẫn giữ NGUYÊN override
        `cache: "no-store"` đã có từ trước (bài học cache cũ, không được
        mất). Dùng cho mọi Client Component `"use client"` — 9 file (`PortTable.tsx`,
        `DeviceCircuitList.tsx`...) không cần sửa gì cho chính import này.
      - `lib/supabase-server.ts` (mới) — `createSupabaseServerClient()`,
        dùng `createServerClient` + `cookies()` từ `next/headers`. CỐ Ý
        KHÔNG cache/không phải singleton — tạo mới mỗi lần gọi, chỉ gọi được
        trong Server Component/Route Handler/Server Action/middleware, tránh
        đúng lớp lỗi "1 request dùng nhầm session của request khác trên 1
        lambda ấm" (giống bài học `no-store` cho `fetch`, lần này nguy hiểm
        hơn vì rò rỉ session giữa người dùng khác nhau).
      - `scripts/lib/supabaseAdmin.ts` (mới) — `getSupabaseAdmin()`, service
        role key, gom 9 script trước đây tự dựng client rời rạc về 1 hàm
        dùng chung.
    - **Triển khai** (chia nhỏ theo file, chạy song song bằng nhiều agent,
      xác nhận từng phần bằng `tsc --noEmit` trước khi gộp):
      16+1 file `lib/*.ts` thêm tham số `client` bắt buộc → 9 trang
      `app/**/page.tsx` (Server Component, thêm `const supabase = await
      createSupabaseServerClient();` đầu component, một số trang có hàm phụ
      module-level như `getRacks`/`getRackAndPorts`/`getDashboardData` cũng
      phải nhận thêm tham số `supabase`) → 12 Client Component (truyền thẳng
      biến `supabase` — trình duyệt — đã có sẵn trong scope vào các hàm) →
      9 script CLI (đổi sang `getSupabaseAdmin()`, kể cả các script trước đây
      "vô tình vẫn compile được" vì tự `import("../lib/supabase")` rồi dùng
      client đó trực tiếp — lỗi loại này KHÔNG bị `tsc` bắt được vì kiểu vẫn
      là `SupabaseClient`, phải tự rà tay bằng grep, không chỉ dựa lỗi biên
      dịch). Tổng cộng ~29 file caller, hàng trăm chỗ gọi.
    - `middleware.ts` (mới) — chặn MỌI route chưa đăng nhập TRƯỚC khi trang
      kịp gọi Supabase, dùng `supabase.auth.getUser()` (KHÔNG dùng
      `getSession()` — `getUser()` xác thực lại với Auth server, `getSession()`
      chỉ tin JWT cục bộ, bẫy đã biết của chính docs Supabase). `matcher`
      loại trừ `_next/static`, `_next/image`, `favicon.ico`, `/login`.
    - `app/login/page.tsx` (mới) — form email+password đơn giản, dùng lại
      class `.input`/`.btn-primary` sẵn có. Không signup/quên mật khẩu — 1
      tài khoản duy nhất, tạo tay qua Supabase Dashboard.
    - `components/Sidebar.tsx` + `app/layout.tsx` — thay dòng tĩnh "Giai
      đoạn MVP · single-user" bằng email người dùng thật (đọc qua
      `createSupabaseServerClient()` ở `RootLayout`, giờ là async, truyền
      xuống prop `userEmail`) + nút "Đăng xuất" (`supabase.auth.signOut()`
      rồi điều hướng `/login`).
    - Migration mới `supabase/migrations/20260806000001_authenticated_rls.sql`
      (người dùng tự chạy tay — Claude không có quyền DDL, đúng quy ước dự
      án): xóa `mvp_allow_all` trên 10 bảng, thêm `authenticated_select`/
      `authenticated_insert`/`authenticated_update`; bật RLS mới hoàn toàn +
      2 policy (không update, không cần) cho `device_aliases`; tách riêng
      `admin_delete` (kiểm `auth.jwt() -> 'app_metadata' ->> 'role' =
      'admin'`) trên 7 bảng THẬT có `.delete()` từ app (`devices`, `circuits`,
      `port_circuit_links`, `transit_links`, `ports`, `racks`,
      `device_position_map` — xác nhận bằng grep, không đoán); 4 bảng không
      có delete thật (`stations`, `import_batches`, `device_dedup_ignored`,
      `device_aliases`) không thêm policy delete nào (mặc định chặn). Kèm
      câu lệnh mẫu gán `app_metadata.role = "admin"` cho tài khoản duy nhất
      — **thiếu bước này thì mọi nút Xóa (kể cả 2 RPC Đợt 2) ngưng hoạt
      động cho chính người dùng**.
    - **Kiểm chứng đã làm**: `npx tsc --noEmit` sạch tuyệt đối (lưới an toàn
      chính, xem lý do "bắt buộc không default" ở trên). `npm run build`
      sạch — 15 trang, `middleware` build thành công (85.2kB); ghi nhận `/`
      chuyển từ `○` (static) sang `ƒ` (dynamic) vì `RootLayout` giờ đọc
      session mỗi request — đúng, cần thiết, không phải lỗi.
    - **⚠️ ĐIỂM DỪNG — RLS CHƯA khóa**: toàn bộ việc ở trên (16+1 file lib,
      ~29 file caller, middleware, login, Sidebar) đã xong và đã verify bằng
      `tsc`/`build`, nhưng **migration `20260806000001` CHƯA chạy** —
      `mvp_allow_all` vẫn còn nguyên trên CSDL sống tại thời điểm ghi mục
      này. Việc còn lại là CỦA NGƯỜI DÙNG, theo đúng thứ tự: (1) tạo 1 tài
      khoản thật qua Supabase Dashboard; (2) `npm run dev`, tự đăng nhập,
      xác nhận luồng redirect/login hoạt động ĐÚNG khi RLS còn mở (chỉ xác
      nhận plumbing đăng nhập, chưa xác nhận RLS); (3) gán
      `app_metadata.role = "admin"` cho tài khoản đó; (4) chạy migration
      `20260806000001` tay trong Supabase SQL Editor; (5) test lại toàn bộ
      đọc/ghi/xóa (kể cả 2 RPC) + chạy lại vài script audit xác nhận vẫn ra
      đúng số liệu (service role key, không bị RLS chặn).
    - **Chưa làm trong đợt này** (đúng phạm vi đã chốt): UI nhiều vai trò
      (Admin/Edit/Viewer), signup tự phục vụ, luồng quên-mật-khẩu, rate-limit
      đăng nhập, ẩn Sidebar ở `/login`. Phần UI thuần của Đợt 3 (3.3-3.5,
      mục 66) cũng chưa làm — làm sau đợt Auth này.

68. **Đợt 3 (mở rộng) — 3 cấp quyền viewer/operator/admin (2026-08-06, cùng
    ngày với mục 67)**. Sau khi người dùng tự tạo tài khoản + đăng nhập thành
    công (tài khoản admin đầu tiên), người dùng yêu cầu thêm: "cho tôi sang
    các chế độ view, chế độ operator để tôi test" — tức 3 cấp quyền thay vì
    chỉ 1 mức admin như mục 67 vừa thiết kế, và cần có tài khoản thật để tự
    test bằng cách đăng xuất/đăng nhập lại (không phải giả lập trong UI —
    xem lý do bên dưới).
    - **Rà lại 4 kiểu xóa thật trong app** (grep `.delete(` toàn bộ `.tsx`)
      trước khi thiết kế policy, để đảm bảo "operator xóa được từng luồng,
      không xóa được cả ODF/thiết bị" ánh xạ ĐÚNG vào bảng CSDL chứ không chỉ
      đoán theo tên chức năng:
      | Thao tác | Cách xóa | File |
      |---|---|---|
      | Xóa 1 luồng trung kế | RPC `delete_trunk_circuit` | `PortTable.tsx` |
      | Xóa 1/nhiều luồng thiết bị | `.from("circuits").delete()` trực tiếp | `DeviceCircuitList.tsx` |
      | Xóa cả ODF/rack | `.from("ports").delete()` + `.from("racks").delete()` | `DeleteRackButton.tsx` |
      | Xóa cả thiết bị | RPC `delete_devices_with_circuits` | `DeviceCategoryClient.tsx` |
      May mắn: cả 2 RPC Đợt 2 đều `security invoker`, và `delete_trunk_circuit`
      chỉ đụng `circuits`/`port_circuit_links`/`transit_links` + update
      `ports.status` — KHÔNG đụng bảng `devices`/`racks` — nên chỉ cần chia
      policy DELETE theo bảng là ánh xạ đúng "xóa từng luồng" vs "xóa cả
      rack/thiết bị" mà KHÔNG cần sửa code RPC hay component nào.
    - **Sửa `supabase/migrations/20260806000001_authenticated_rls.sql`**
      (vẫn CHƯA chạy lần nào — sửa trực tiếp file cũ vì chưa từng áp dụng
      lên CSDL sống, không cần migration nối tiếp):
      - `authenticated_select` giữ nguyên (mọi tài khoản đăng nhập đọc được,
        kể cả viewer — đọc không có rủi ro).
      - `authenticated_insert`/`authenticated_update` đổi tên
        `write_operator_admin`/`update_operator_admin`, điều kiện thêm
        `auth.jwt() -> 'app_metadata' ->> 'role' in ('operator', 'admin')` —
        viewer không ghi được gì (kể cả sửa nhỏ), tránh viewer bấm Lưu giữa
        form dài rồi nhận lỗi RLS khó hiểu.
      - DELETE tách 2 mức thay vì 1: `operator_delete` (role operator HOẶC
        admin) trên `circuits`, `port_circuit_links`, `transit_links`,
        `device_position_map`; `admin_delete` (role admin) trên `devices`,
        `ports`, `racks` — đúng bảng ánh xạ ở trên.
      - `device_aliases` insert cũng đổi theo `write_operator_admin`.
    - **`scripts/create-role-test-accounts.ts`** (mới, `npm run
      create-role-accounts`) — dùng Admin API (`supabase.auth.admin.createUser`,
      service role key, KHÔNG phải DDL) để tự tạo 2 tài khoản thật kèm gán
      sẵn `app_metadata.role` lúc tạo, không cần vào Dashboard tay: bắt buộc
      `--base-email=`, tự suy ra 2 địa chỉ theo kiểu alias Gmail "+"
      (`base+operator@...`, `base+viewer@...` — Gmail coi là tài khoản đăng
      nhập khác nhau nhưng mail vẫn về đúng hộp thư chính, không cần 2 email
      thật riêng biệt để test). Mật khẩu sinh ngẫu nhiên
      (`crypto.randomBytes`), chỉ in ra console MỘT LẦN lúc `--commit`, không
      lưu ở đâu khác. Dry-run mặc định (in dự kiến, chưa tạo gì) theo đúng
      quy ước script khác trong `scripts/`.
    - **`components/Sidebar.tsx` + `app/layout.tsx`** — thêm badge role cạnh
      email (đọc `user.app_metadata.role` qua `createSupabaseServerClient()`
      ở `RootLayout`, đã fetch `user` sẵn từ mục 67, chỉ thêm 1 dòng lấy
      `role`): "Admin"/"Operator"/"Viewer (chỉ xem)", hoặc "chưa gán quyền"
      (màu hổ phách) nếu tài khoản chưa có `app_metadata.role` — ca này xảy
      ra với chính tài khoản admin đầu tiên cho tới khi người dùng tự chạy
      câu lệnh gán role tay ở cuối migration. Badge CHỈ để hiển thị đang
      đăng nhập bằng tài khoản nào khi tự test đổi vai trò (đăng xuất/đăng
      nhập lại bằng tài khoản khác) — không phải chốt chặn quyền, RLS mới là
      nơi chặn thật.
    - **Vì sao không làm "nút chuyển chế độ" giả lập ngay trong UI** (thay vì
      bắt đăng xuất/đăng nhập lại bằng tài khoản khác): role nằm trong JWT
      cấp lúc đăng nhập, phía client KHÔNG thể tự đổi role của chính JWT
      đang có (đúng nguyên lý bảo mật của toàn bộ Đợt 3 — nếu đổi được thì
      RLS coi như vô nghĩa). Một nút "xem thử như Viewer" mà không đổi JWT
      thật chỉ ẩn/hiện vài nút trên UI — không kiểm chứng được RLS có chặn
      đúng hay không, hàng chục điểm ghi (insert/update) ở khắp component sẽ
      không được che theo, và người dùng bấm Lưu vẫn thấy có vẻ hoạt động (vì
      JWT thật vẫn là admin) — sai lệch với thứ đang thật sự được test. Đăng
      nhập lại bằng tài khoản operator/viewer thật là cách DUY NHẤT kiểm
      chứng đúng.
    - **Chưa làm** (cùng lý do phạm vi đã ghi ở mục 67, giờ áp dụng luôn cho
      cả viewer/operator): UI tự ẩn/khóa nút Sửa/Xóa theo role (viewer hiện
      tại vẫn thấy đủ nút, chỉ bị RLS chặn khi bấm — lỗi hiện ra là thông
      điệp Postgres thô "new row violates row-level security policy...",
      chưa dịch tiếng Việt, xem Đợt 4 "dịch lỗi Postgres" ở mục 66), gom nút
      "Xóa cả rack"/"Xóa cả thiết bị" vào khung "Thao tác nguy hiểm" riêng
      (Đợt 3.3, mục 66 — xem mục 70, đã làm xong 2026-08-07).
    - **Kiểm chứng cần làm sau khi người dùng tự chạy migration + script**:
      đăng nhập bằng tài khoản operator → xóa 1 luồng OK, bấm "Xóa rack"/"Xóa
      thiết bị" phải BỊ chặn (lỗi RLS hiện ra, không xóa được); đăng nhập
      bằng tài khoản viewer → mọi nút Lưu/Xóa đều bị chặn, chỉ xem được.

69. **Sửa lỗi migration 20260806000001 áp dụng nhầm bản CŨ (2026-08-07)**.
    Người dùng chạy `20260806000001_authenticated_rls.sql` (bản 3 cấp) trong
    Supabase SQL Editor, báo lỗi `policy "authenticated_select" for table
    "stations" already exists` — nghĩa là 1 policy trùng tên đã tồn tại
    TRƯỚC khi câu lệnh này chạy. Suy luận + xác minh: bản CŨ của chính file
    này (1 cấp — trước khi sửa lại thành viewer/operator/admin ở mục 68) đã
    được áp dụng lên CSDL sống ở 1 thời điểm nào đó trước đó (không rõ chính
    xác lúc nào), tạo ra policy `authenticated_insert`/`authenticated_update`
    (MỞ cho MỌI tài khoản đã đăng nhập, không lọc theo role) và `admin_delete`
    phạm vi cũ (gồm cả `circuits`/`port_circuit_links`/`transit_links`/
    `device_position_map`, tức operator KHÔNG xóa được luồng — sai ý muốn).
    Khi chạy bản mới, câu lệnh ĐẦU TIÊN trong `do $$` của Part A
    (`create policy "authenticated_select"`, tên KHÔNG đổi giữa 2 bản) va
    ngay vào bản ghi cũ đã tồn tại → toàn bộ phần còn lại của Part A/B/C
    KHÔNG chạy được, dừng ngay từ câu đầu.
    - **Xác minh thật trên CSDL sống** (script tạm, xóa ngay sau khi chạy):
      đăng nhập bằng tài khoản viewer test (`ongtienonline+viewer@gmail.com`)
      rồi thử `insert` vào `stations` — **thành công (status 201)**, xác
      nhận đúng giả thuyết trên (viewer đang ghi được, sai với thiết kế 3
      cấp). Không dùng anon key để test việc này vì anon select/insert 0
      dòng/bị chặn xảy ra ở CẢ 2 trường hợp "có policy đúng" lẫn "không có
      policy nào" (RLS mặc định chặn hết khi không có policy khớp) — phải
      đăng nhập thật bằng 1 tài khoản có role cụ thể mới phân biệt được.
    - **Fix**: migration mới
      `supabase/migrations/20260807000001_fix_role_policies.sql` — viết
      idempotent hoàn toàn (`drop policy if exists` bằng CẢ tên cũ lẫn tên
      mới trước mỗi `create`), an toàn chạy lại bất kể CSDL đang ở trạng thái
      nào (`mvp_allow_all` gốc, bản cũ 1 cấp của `20260806000001`, hay đã
      đúng bản mới rồi). Người dùng cần chạy file này (SAU khi
      `20260806000001` đã chạy, bất kể lỗi hay không) để đưa CSDL về đúng
      trạng thái 3 cấp mong muốn.
    - **Bài học quy trình**: từ nay khi 1 file migration ĐÃ được gửi cho
      người dùng chạy tay rồi mới cần sửa nội dung (như ca đổi 1 cấp → 3
      cấp ở mục 68, sửa TRƯỚC khi xác nhận người dùng đã chạy hay chưa) —
      nên viết migration mới riêng thay vì sửa đè file cũ, HOẶC nếu sửa đè
      thì phải viết idempotent (`drop if exists` mọi tên, cũ lẫn mới) ngay
      từ đầu, không giả định "chưa ai chạy file này bao giờ".
    - **Kiểm chứng sau khi người dùng chạy `20260807000001`** (script tạm,
      đăng nhập thật bằng 2 tài khoản test, xóa ngay sau khi chạy) — cả 8
      phép thử đều đúng: operator select/insert/xóa-từng-luồng (`circuits`,
      `device_position_map`...) OK, operator xóa `racks` **bị chặn đúng**;
      viewer select OK, insert/xóa đều **bị chặn đúng**. Lưu ý phát sinh khi
      viết script test: `DELETE` bị RLS chặn ở Postgres **KHÔNG báo lỗi**,
      chỉ lặng lẽ xóa 0 dòng (khác hẳn `INSERT` bị chặn thì có lỗi rõ ràng
      "row violates row-level security policy") — lần chạy thử ĐẦU TIÊN của
      script test này chỉ kiểm tra `error` nên báo FAIL giả (tưởng nhầm là
      lỗi bảo mật thật) — phải sửa lại dùng `.select()` sau `.delete()` để
      đếm ĐÚNG số dòng bị xóa mới kết luận được. Cũng dọn luôn 1 dòng rác
      `stations.code = '__rls_probe__'` sót lại từ lúc kiểm tra RLS ở bước
      trước đó (viewer từng ghi được vào bảng thật lúc policy còn ở bản cũ).

70. **Đợt 3.3-3.5 (audit, mục 66) — UI thuần, không phụ thuộc Auth
    (2026-08-07)**. 3 việc còn lại của Đợt 3 audit, làm sau khi 3 cấp quyền
    (mục 68-69) đã ổn định:
    - **`lib/dangerousConfirm.ts`** (mới) — `confirmBulkDelete(message,
      count, maxRows=20)` thay `confirm()` OK/Cancel thường cho các nút
      "Xóa đã chọn" (bulk): quá `maxRows` thì chặn hẳn (alert, không cho xóa,
      phải bớt lựa chọn), trong hạn thì bắt gõ đúng chữ "XÓA" qua
      `window.prompt()` thay vì chỉ OK/Cancel — xóa hàng loạt khó hoàn tác
      hơn xóa 1 dòng nên cần rào chắn mạnh hơn 1 cú Enter. **Chỉ áp dụng cho
      2 nút xóa HÀNG LOẠT** (`DeviceCircuitList.deleteSelectedCircuits`,
      `DeviceCategoryClient.deleteSelectedDevices`) — nút xóa 1 dòng đơn lẻ
      (`PortTable.deleteGroup`, `DeviceCircuitList.deleteCircuit`) vẫn giữ
      `confirm()` thường như cũ, không đổi (đúng phạm vi audit: chỉ bulk mới
      cần rào chắn thêm).
    - **`components/ui/DangerZone.tsx`** (mới) — khung "⚠️ Thao tác nguy
      hiểm" dùng `<details>` gốc trình duyệt (thu gọn mặc định, không cần
      `"use client"`/state riêng). Bọc `DeleteRackButton` ở
      `app/odf-trunk/[rackId]/page.tsx` — trước đây nút "Xóa rack này" nằm
      lộ thiên ngay dưới `RackAdminPanel`, giờ phải bấm mở khung mới thấy.
    - **`components/odf-trunk/PortTable.tsx`** — nút "Xóa" (xóa 1 luồng
      trung kế) trước đây nằm NGAY CẠNH "Sửa" trong hàng nút chính của mỗi
      dòng, dễ bấm nhầm (đúng lo ngại của audit). Thêm state
      `dangerOpenKey: string | null` (key = id các port nối nhau của group,
      đã có sẵn biến `key` này trong `.map()`, chỉ tái dùng) — mặc định hiện
      nút "⋯" thay chỗ "Xóa", bấm "⋯" mới lộ ra nút "Xóa" thật ở đúng dòng đó
      (dòng khác vẫn đóng, vì so khớp theo `key`). Không đổi hành vi
      `deleteGroup()` bên trong (vẫn `confirm()` thường — đây là xóa 1 dòng,
      không phải bulk).
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (15
      trang + middleware, không đổi số route).
    - **Không làm gì thêm ngoài phạm vi 3.3-3.5** — không đổi UI xóa 1 dòng ở
      nơi khác, không thêm giới hạn dòng cho các thao tác không phải xóa.

71. **Đợt 4 (audit, mục 66) — 2/4 việc: `error.tsx`/`loading.tsx` + dịch lỗi
    Postgres (2026-08-07)**. 2 việc còn lại của Đợt 4 (trang `/circuit/[id]`,
    gom Sidebar) chưa làm — nội dung gốc audit cho 2 việc đó không còn giữ
    được đầy đủ qua các lần nén ngữ cảnh phiên làm việc, đang chờ người dùng
    dán lại nguyên văn để làm đúng ý thay vì đoán.
    - **`app/error.tsx`** (mới) — error boundary cho toàn bộ `app/` (Next.js
      App Router convention), bắt lỗi ném ra lúc render Server Component
      (trước đây không có gì, 1 lỗi làm sập cả trang thành "Application
      error" trắng xóa, chỉ còn cách F5). Hiện thông điệp đã dịch qua
      `translatePgError` + nút "Thử lại" (`reset()`). Chưa làm
      `app/global-error.tsx` (bắt lỗi ở chính `layout.tsx`) — chưa gặp ca đó
      thật, để sau nếu cần.
    - **`app/loading.tsx`** (mới) — hiện trong lúc Server Component của route
      đang chờ dữ liệu (trước đây màn hình trắng, dễ hiểu lầm app treo).
    - **`lib/translatePgError.ts`** (mới) — dịch các mẫu lỗi Postgres/
      PostgREST hay gặp nhất sang tiếng Việt: vi phạm RLS (rất liên quan sau
      khi khóa 3 cấp quyền ở mục 68-69 — viewer/operator thao tác vượt quyền
      giờ sẽ thấy thông điệp rõ ràng thay vì "row-level security policy..."
      khó hiểu), trùng khóa duy nhất, vi phạm khóa ngoại, JWT hết hạn, lỗi
      mạng. Không nhận diện được mẫu nào thì trả nguyên văn — không che giấu
      lỗi lạ.
    - **Áp dụng vào 54 chỗ `setError(...)` trên 15 file** (dùng 1 agent con
      quét toàn bộ, tự tôi kiểm tra lại bằng `git diff` sau khi xong) — chỉ
      bọc đúng phần `.message` gốc (giữ nguyên câu tiếng Việt viết tay bao
      quanh, không dịch đè), KHÔNG đụng các `setError(...)` là validate tay
      (vd "Vui lòng nhập tên thiết bị") hay `setError(null)`. Riêng
      `app/login/page.tsx` giữ nguyên bản dịch tay có sẵn cho
      "Invalid login credentials" → "Sai email hoặc mật khẩu.", chỉ bọc
      nhánh lỗi CHƯA dịch còn lại.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (tự chạy
      lại, không chỉ tin báo cáo của agent con).
    - **Phát hiện chưa xử lý (ghi lại, chưa sửa)**: `DELETE` bị RLS chặn ở
      Postgres KHÔNG báo lỗi (chỉ lặng lẽ xóa 0 dòng, xem mục 69) — nghĩa là
      nếu 1 tài khoản không đủ quyền bấm nút xóa 1 dòng (không phải bulk),
      UI hiện tại KHÔNG báo lỗi rõ ràng, chỉ có `router.refresh()`/tự đóng
      form như xóa thành công, dòng dữ liệu thật ra vẫn còn. Muốn sửa đúng
      cần thêm `.select()` sau mọi `.delete()` đơn lẻ rồi kiểm tra số dòng
      ảnh hưởng — CHƯA làm vì ngoài phạm vi "dịch lỗi" của Đợt 4, cần bàn
      riêng (ảnh hưởng nhiều file: `PortTable.deleteGroup`,
      `DeviceCircuitList.deleteCircuit`, `DeleteRackButton`...).

72. **Đợt 4 (tiếp) — trang `/circuit/[id]` sửa lại đúng bản gốc (2026-08-07)**.
    Bản đầu (viết khi chưa có lại văn bản audit gốc) chỉ là 1 permalink
    chỉ-xem đơn giản cho 1 luồng — người dùng dán lại nguyên văn
    `HSKT-audit-2026-08-03.md` mục 3.2, hóa ra ý gốc RỘNG hơn nhiều: xem
    **toàn tuyến 1 đấu nối thiết bị↔trung kế trên cùng khung nhìn**, so sánh
    2 hồ sơ cạnh nhau (mockup có chuỗi hình: Thiết bị → ODF thiết bị → ODF
    trung kế → Tuyến cáp, cộng bảng so sánh 2 cột nêu rõ trường nào lệch).
    Viết lại hoàn toàn theo đúng bản gốc:
    - **Cặp ĐÃ liên kết thật** (`mirror_of_id` có sẵn) — tái dùng NGUYÊN
      `findLinkedDeviceTrunkPairs(trunkPorts, deviceCircuits)`
      (`lib/circuitPairSync.ts`, đã có sẵn, không viết logic so sánh mới —
      đúng chỉ định audit gốc "toàn bộ dữ liệu đã có sẵn trong
      CircuitPairDetail... phần lớn công việc chỉ là dựng giao diện"), tìm
      đúng cặp khớp `id` (chấp nhận CẢ `deviceCircuitId` lẫn
      `trunkCircuitId`) rồi dựng: khối chuỗi 4 ô nối mũi tên (Thiết bị/Trib →
      Vị trí ODF thiết bị → Vị trí ODF trung kế → Mã rack tuyến cáp), 2 dòng
      "Phương án ứng cứu"/"Trạm thực hiện" (lấy riêng từ luồng trung kế qua 1
      truy vấn nhỏ — 2 trường này không nằm trong `CircuitPairDetail`, không
      phải trường được đối chiếu 2 bên), và bảng so sánh 2 cột "Hồ sơ đấu
      nối (thiết bị)" / "Hồ sơ ODF trung kế" — mỗi dòng tô vàng khi
      `nameMatch`/`ownPositionMatch`/`nextPositionMatch`/`tribMatch` báo
      lệch (`false`), lấy thẳng từ `CircuitPairDetail`, không tính lại.
    - **Chấp nhận chi phí tải dữ liệu**: hàm `findPair()` tải
      `fetchAllOdfPorts` + `fetchDeviceCircuits` (~9.000 dòng, cùng cỡ
      `app/odf-trunk/[rackId]/page.tsx`) — audit mục 5.1 phê bình đúng chi
      phí này nhưng ở TRANG DANH SÁCH lặp lại nhiều lần; đây là trang chi
      tiết/permalink tải 1 lần khi có người bấm vào, không lặp lại, nên chấp
      nhận được. Tối ưu riêng (RPC/materialized view) để dành Đợt 5.
    - **Không phải cặp đã liên kết thật** (chỉ 1 bên, hoặc "candidate" khớp
      vị trí nhưng CHƯA xác nhận) — rơi về `SingleView` (bản permalink đơn
      giản của lần viết đầu, giữ lại làm fallback thay vì bỏ). Cố tình
      KHÔNG hiện khung so sánh cho candidate — đúng tinh thần tooltip
      `MirrorLinkBadge` hiện có: candidate phải xác nhận qua tab Chất lượng
      dữ liệu trước, tránh trang permalink ngầm định "đã đúng" 1 quan hệ
      chưa ai xác nhận.
    - **`components/ui/MirrorLinkBadge.tsx`** — thêm prop `circuitId`, huy
      hiệu "🔗 Đã liên kết" giờ là `<Link href="/circuit/{id}">` (đúng ý audit
      gốc: "MirrorLinkBadge bấm vào đây" là 1 trong 3 đích đến chính của
      trang này). Ca "candidate" cố tình KHÔNG link (lý do ở trên). Cập nhật
      2 nơi gọi: `PortTable.tsx`, `DeviceCircuitList.tsx`.
    - **CHƯA làm** (đúng 2 đích đến còn lại audit gốc liệt kê): gắn link từ
      kết quả Cmd+K (`CommandPalette.tsx`) và từ các tab "Chất lượng dữ
      liệu" — để riêng, cần khảo sát thêm dữ liệu mỗi nơi đã có sẵn circuit
      id hay chưa trước khi gắn, tránh lan phạm vi 1 lần sửa.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (16
      route — 1 route `/circuit/[id]` duy nhất, không đổi so với bản đầu).

73. **Đợt 4 (tiếp) — gom Sidebar: XÁC NHẬN CÓ MÂU THUẪN THẬT (2026-08-07)**.
    Người dùng dán lại nguyên văn audit mục 3.3 — xác nhận đúng nghi ngờ đã
    ghi trước đó: đề xuất gốc là gộp "ODF Trung kế" + "ODF Thiết bị" (2 mục
    sidebar) thành 1 mục "Hồ sơ" duy nhất, chuyển đổi giữa 2 chế độ xem
    ("Theo rack" / "Theo luồng") bằng nút gạt NGAY TRONG trang thay vì 2 mục
    sidebar riêng — điều này ĐỐI NGHỊCH TRỰC TIẾP với yêu cầu người dùng
    2026-07-28 đã ghi rõ trong chính comment của `components/Sidebar.tsx`:
    tách "Hồ sơ ODF Thiết bị" (xem theo rack) và "Hồ sơ đấu nối" (đổi tên từ
    "Sửa luồng thiết bị", xem/sửa theo luồng) thành 2 mục RIÊNG. Cùng 1 cặp
    trang, 2 yêu cầu ngược chiều nhau ở 2 thời điểm khác nhau. Không tự ý
    chọn bên nào — đây đúng dạng xung đột "audit vs quyết định người dùng đã
    có hiệu lực" từng gặp ở Đợt 3 (mục 66, xung đột nguyên tắc MVP no-auth) —
    phải hỏi lại. Phần còn lại của đề xuất (gộp "Cài đặt"/"Danh mục thiết
    bị"/"Thư viện vị trí thiết bị"/"Import Export" vào 1 nhóm "Quản trị", bỏ
    mục "Tìm kiếm nhanh" khỏi sidebar vì đã có Cmd+K) KHÔNG xung đột gì đã
    biết — có thể làm độc lập nếu người dùng đồng ý, tách riêng khỏi phần
    gộp 2 mục ODF đang mâu thuẫn.

    **Người dùng chọn: giữ "Hồ sơ ODF Thiết bị"/"Hồ sơ đấu nối" tách riêng
    (không gộp), làm phần còn lại.** Đã làm:
    - `components/Sidebar.tsx` — 3 nhóm còn: "Thống kê" (Dashboard), "Hồ sơ"
      (ODF Trung kế, ODF Thiết bị, Hồ sơ đấu nối — CHỈ 3 mục hằng ngày, bỏ
      "Tìm kiếm nhanh"/"Chất lượng dữ liệu"), "Quản trị" (Chất lượng dữ liệu,
      Danh mục thiết bị, **Thư viện vị trí thiết bị** — mục MỚI, trang
      `/odf-device/vi-tri-thiet-bi` đã tồn tại từ trước nhưng CHƯA từng có
      trong Sidebar, chỉ vào được qua URL trực tiếp — audit gốc liệt kê mục
      này trong nhóm Quản trị nên thêm luôn, Import/Export Excel, Cài đặt
      chung).
    - `components/ui/CommandPalette.tsx` — thêm dòng chân "Xem tất cả kết
      quả tìm kiếm (bộ lọc đầy đủ) →" trỏ `/search`, thay chỗ mục "Tìm kiếm
      nhanh" vừa bỏ khỏi Sidebar — giữ trang `/search` còn tới được (có bộ
      lọc theo từng cột mà kết quả rút gọn của palette không có), đúng đề
      xuất audit gốc.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (số
      route không đổi — chỉ đổi điều hướng, không thêm/bớt trang).

74. **Đợt 4 (tiếp) — thêm nút "Thêm thiết bị" ở Danh mục thiết bị (2026-08-07)**.
    `components/devices/DeviceCategoryClient.tsx` trước đây chỉ tạo được
    thiết bị GIÁN TIẾP (qua gõ tên chưa chuẩn ở ô "Thiết bị (tiếp theo)" bên
    luồng, hoặc tự sinh lúc import) — chưa có nút tạo tay trực tiếp tại trang
    danh mục. Thêm nút "+ Thêm thiết bị" hiện form inline (Tên thiết bị *, Tọa
    độ, Lĩnh vực) ngay trước phần lọc "Lĩnh vực" — tự thêm tiền tố `ADN1.`
    nếu chưa gõ, chặn trùng tên qua `normalizeDeviceNameKey()` (bảng
    `devices` không có ràng buộc unique thật ở DB, phải tự kiểm client-side),
    `source: "manual"`. Sửa tên/xóa thiết bị đã có sẵn từ trước (tick chọn
    dòng), không cần viết thêm.
    - **Đồng bộ tên khi sửa/xóa thiết bị sang các tab khác** (yêu cầu người
      dùng): đã kiểm tra, KHÔNG cần thêm code — trường `deviceName` hiển thị
      ở mọi nơi liên kết qua `device_id` (luồng có chọn thiết bị thật) lấy
      bằng JOIN SQL trực tiếp tới `devices.name` lúc tải trang, nên đổi tên
      thiết bị tự động đúng ngay ở mọi nơi, không có bản sao/cache nào cần
      đồng bộ tay. Xóa thiết bị đã có RPC `delete_devices_with_circuits`
      (Đợt 2) xử lý cascade đúng.
    - **CHƯA làm (theo yêu cầu người dùng)**: `circuits.name` là text tự gõ,
      KHÔNG tự suy ra từ `devices.name` — đổi tên thiết bị không rewrite lại
      những luồng cũ có nhắc tên thiết bị trong chuỗi tên luồng. Đã đo thử
      (script tạm, không lưu lại): phần lớn tên luồng KHÔNG chứa nguyên văn
      tên thiết bị dạng khớp được an toàn (lệch dấu, vd "ADN1" ≠ "AĐN1",
      lệch định dạng) — đề xuất tự động thay thế, người dùng từ chối
      ("còn tên cũ thì để đó tôi hiệu chỉnh dần") — để nguyên, không tự động.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch.

75. **Đợt 4 (tiếp) — BUG THẬT: luồng thiết bị mới nhập không hiện ở trang
    rack `/odf-device/{rackId}` (phát hiện + sửa 2026-08-07)**.
    Người dùng báo: nhập luồng mới ở "Hồ sơ đấu nối" (`/odf-device/sua-luong`)
    xong, vào đúng rack ODF/DDF liên quan ở `/odf-device` thì port KHÔNG hiện
    tên luồng — dù xác nhận đã lưu `circuits` thật (không phải hiểu nhầm
    "Thư viện vị trí thiết bị" `/odf-device/vi-tri-thiet-bi` chỉ là bảng gợi ý
    autofill, không tạo luồng thật — điều này ĐÚNG thiết kế, đã giải thích
    riêng, không phải bug).

    Điều tra bằng script tạm (đọc CSDL thật qua service-role key, không sửa
    gì, xóa sau khi xong) xác nhận **root cause thật**: hàm
    `fetchAllDeviceRackPortRefs()` (`lib/deviceRackPorts.ts`) — quét TOÀN BỘ
    bảng `circuits` để đối chiếu ngược "port này có luồng nào nhắc tới không"
    cho các rack `domain='device'` (rack này không có `port_circuit_links`
    thật, xem mục 8) — trước đây gọi `.from("circuits").select(...)`
    **KHÔNG phân trang**. PostgREST mặc định cắt kết quả về tối đa **1000
    dòng**. Bảng `circuits` lúc kiểm tra đã có **2196 dòng** — 1000 dòng
    PostgREST trả về không theo thứ tự `updated_at` (không có `.order()`),
    nên các luồng MỚI nhất (vừa thêm hôm nay) gần như chắc chắn rơi ngoài lô
    1000 dòng đó → bị loại thẳng khỏi map tra cứu → port đúng ra có luồng lại
    hiện trống, y hệt triệu chứng người dùng báo. Xác nhận bằng script: sau
    khi thêm `.order("id").range(...)` phân trang đủ, luồng mới
    (`100GE ADN1.P2 (18/1/6) - 2T9.ASBR1 (13/1/3)`, vị trí "ODF 9/19
    (33,34)") xuất hiện đúng trong map, trước đó thì không.

    Đã rà toàn bộ các chỗ khác gọi `.from("circuits").select(...)` trong
    `lib/`/`app/` (5+1 file) — tất cả đều lọc bằng `.eq()`/`.single()`/`.in()`
    (không bao giờ trả >1000 dòng) hoặc đã tự phân trang sẵn
    (`lib/deviceCircuits.ts fetchDeviceCircuits`) — **chỉ 1 hàm này bị sót**,
    không phải lỗi lặp lại nhiều nơi.

    **Fix**: `lib/deviceRackPorts.ts` — đổi query trong
    `fetchAllDeviceRackPortRefs()` sang vòng lặp phân trang `pageSize=1000` +
    `.order("id").range(from, from+pageSize-1)`, đúng mẫu đã dùng ở
    `fetchDevicePositionMap()`/`fetchDeviceCircuits()` trong cùng dự án —
    không đổi logic đối chiếu (`matchTrunkPosition`, `record()`) nào khác.
    - **Bài học chung**: bất kỳ hàm nào gọi `supabase.from(...).select(...)`
      KHÔNG có `.eq()`/`.single()`/`.limit()` rõ ràng đều PHẢI phân trang —
      PostgREST cắt ngầm ở 1000 dòng, không báo lỗi, không cảnh báo, dữ liệu
      "biến mất" một cách im lặng đúng kiểu lỗi này. Cỡ bảng vượt 1000 dòng
      chỉ là vấn đề thời gian khi dự án còn nhập liệu tiếp — nên soát lại
      định kỳ khi thêm hàm `fetch*` mới.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch. Script tạm xác nhận map tra
      cứu rack "ODF 9/19" từ 6 dòng (thiếu) lên 34 dòng (đủ) sau khi sửa,
      đúng port 33/34/45/46 của các luồng mới thêm hôm nay đã hiện tên luồng.

76. **Ẩn/hiện cột + sinh text báo cáo (tick-to-text) + Lịch sử tra cứu dùng
    chung (2026-08-07)**. Yêu cầu người dùng: (1) ẩn/hiện cột tùy chọn ở cả 3
    bảng port/luồng chính; (2) tick 1 luồng ở Hồ sơ ODF trung kế HOẶC Hồ sơ
    đấu nối ra ngay 1 đoạn text mô tả toàn tuyến theo đúng cú pháp viết tay
    có sẵn (dùng báo cáo lãnh đạo); (3) lưu đoạn text đó vào "Lịch sử tra
    cứu" DÙNG CHUNG cho cả 2 trang (không tách riêng), cập nhật đè khi tra
    lại luồng đã lưu.

    - **`lib/circuitReportText.ts`** (mới, pure function không đụng
      Supabase/React) — 2 hàm sinh text theo 2 cú pháp khác nhau tùy trang:
      - `buildTrunkPortReportText()` (đứng ở 1 port/nhóm port của 1 rack
        trung kế): phân loại bằng ĐÚNG 2 hàm đã dùng sẵn để hiện cột "Chuyển
        tiếp" (`splitOdfDeviceStructure`, `matchBareTrunkLink` —
        `lib/parsers/transit-text.ts`/`lib/trunkPorts.ts`, không viết parser
        mới): có thiết bị tại ADN1 (structure 2 khớp) → `Thiết bị (port) ->
        Vị trí ODF thiết bị -> ODF rack đang xem -> Đối phương` (vị trí port
        trung kế hiện tại KHÔNG kèm tên tuyến cáp, vì Đối phương đã mô tả đủ
        đầu xa); chỉ chuyển tiếp cáp không thiết bị (`matchBareTrunkLink`
        khớp sang rack trung kế khác) → `ODF rack hiện tại - tên tuyến cáp
        (sợi nếu khác port) -> ODF rack đích - tên tuyến cáp đích` (CẢ 2 đầu
        đều kèm tên tuyến cáp, vì không có Đối phương/thiết bị mô tả thay).
      - `buildDeviceCircuitReportText()` (đứng ở 1 dòng luồng thiết bị, Hồ sơ
        đấu nối): ghép thẳng `deviceName (trib) -> devicePositionOwn ->
        devicePositionNext` — `devicePositionNext` GIỮ NGUYÊN VERBATIM (đã
        đúng định dạng sẵn do chính app ghi khi lưu form, không tính lại) TRỪ
        1 trường hợp: nếu nó khớp `splitOdfDeviceStructure` VÀ phần "thiết
        bị" tách ra không phải 1 tên tuyến cáp thật (kiểm bằng
        `matchTrunkPosition(odfPart, trunkPorts).cableRouteName ===
        deviceName` — rack domain='device' luôn `cableRouteName=null` nên
        không bao giờ nhầm) → tách hyphen `"<odf> - <thiết bị>(<port>)"`
        thành 2 đoạn nối mũi tên riêng thay vì giữ nguyên 1 cụm nối bằng "-".
      - **Đã test tay bằng CHÍNH các ví dụ người dùng đưa** (case 1.1, 1.2,
        ví dụ 2.1/2.2/2.3 trong yêu cầu gốc) qua script tạm trước khi lắp vào
        UI — khớp nguyên văn ngoại trừ 2 chỗ cosmetic không phải quy tắc
        thật: (a) khoảng trắng thừa trong ví dụ người dùng gõ tay; (b) số
        port đệm 2 chữ số khi ≥2 port (theo đúng quy ước có sẵn của
        `formatCanonicalOdfPosition`, vd "(01,02)") thay vì không đệm như ví
        dụ gõ tay "(1,2)" — giữ theo quy ước app cho nhất quán.
    - **`lib/useColumnVisibility.ts`** (mới) — copy y hệt cấu trúc
      `lib/useColumnWidths.ts` (localStorage, `Record<K, boolean>`) —
      **`components/ui/ColumnPicker.tsx`** (mới) — dropdown checkbox phẳng
      "Cột hiển thị (n/m)", copy pattern "bấm ra ngoài để đóng" từ
      `GroupedMultiSelect.tsx` (đơn giản hơn — không nhóm/tìm kiếm, mỗi bảng
      <10 cột). Áp vào `PortTable.tsx` (7 cột tùy chọn, storage key
      `"odf-trunk-col-visibility"`), `DeviceCircuitList.tsx` (6 cột tùy
      chọn, `"device-circuit-col-visibility"` — cột "Thiết bị" giữ NGUYÊN cơ
      chế ẩn/hiện riêng đã có theo bộ lọc thiết bị, không trộn 2 cơ chế),
      `DeviceRackPortView.tsx` (chỉ cột "Ghi chú",
      `"device-rack-port-col-visibility"` — đổi thành `"use client"` để có
      state, kéo theo phải đổi prop `portRefs: Map<...>` → `portRefEntries:
      [number, DeviceRackPortRefs][]` vì Map không nên truyền qua ranh giới
      Server→Client Component, page.tsx gọi `[...map.entries()]` trước khi
      truyền xuống). `PortTable.tsx`/`DeviceCircuitList.tsx` phải tính lại
      `colSpan` ĐỘNG cho các dòng gộp-toàn-hàng (EditRow/MoveRow/dòng trống)
      theo đúng số cột ĐANG hiện — trước đây hardcode `10`/`8`/`columnCount`
      cố định.
    - **Tick chọn + panel xem trước** — `PortTable.tsx` (trước đây CHƯA có
      cột tick, thêm mới trước cột "Port", khóa theo `circuit.id` — 1 luồng
      chiếm 2 port không liền kề (2 group hiển thị riêng) tick/bỏ đồng bộ cả
      2 dòng vì cùng khóa) và `DeviceCircuitList.tsx` (TÁI DÙNG nguyên
      `selected: Set<string>` đã có sẵn cho xóa hàng loạt — không tạo state
      chọn mới, tick 1 luồng vừa phục vụ xóa vừa phục vụ sinh báo cáo cùng
      lúc). **`components/ui/CircuitReportPanel.tsx`** (mới, dùng chung 2
      nơi) — GỘP TẤT CẢ đoạn text của mọi luồng đang tick thành 1 danh sách
      (quyết định người dùng qua AskUserQuestion 2026-08-07, không chỉ giữ
      luồng tick gần nhất — phục vụ copy báo cáo nhiều luồng cùng lúc), mỗi
      dòng có nút Copy riêng (+ nút "Copy tất cả") và tick "Lưu vào lịch sử"
      (chỉ lưu khi tick, không tự lưu lúc vừa chọn luồng).
    - **Lịch sử tra cứu dùng chung** — migration mới
      `supabase/migrations/20260808000001_report_history.sql` (bảng
      `report_history`: `circuit_id` (FK `circuits`, `on delete cascade`),
      `report_text`, `accessed_at`, **`unique(circuit_id)`** — cơ chế cho
      "cập nhật đè" người dùng chọn: client dùng `.upsert(...,{onConflict:
      "circuit_id"})` thay vì tự kiểm tra tồn tại trước; RLS copy khung 3
      cấp quyền `20260807000001` — select mọi authenticated, insert/update/
      delete operator+admin). **`lib/reportHistory.ts`** (mới) —
      `fetchReportHistory`/`upsertReportHistory`/`deleteReportHistoryEntry`.
      **`components/ui/ReportHistoryDrawer.tsx`** (mới) — khung TRƯỢT (tái
      dùng `SlideOverPanel.tsx` có sẵn), KHÔNG phải trang riêng/không thêm
      mục Sidebar (quyết định người dùng qua AskUserQuestion — mở từ 1 nút
      "Lịch sử tra cứu" đặt cạnh `ColumnPicker` trên CẢ 2 trang, cùng data
      dù mở từ trang nào vì không lọc theo nguồn). Bảng gọn: đoạn text +
      "Truy xuất lúc" (`formatLastUpdated`, tái dùng hàm định dạng ngày giờ
      có sẵn, không viết hàm "X phút trước" riêng) + nút Copy/Xóa từng dòng.
    - **Người dùng cần tự chạy migration `20260808000001_report_history.sql`
      trong Supabase SQL Editor TRƯỚC** — thiếu bảng này thì tick "Lưu vào
      lịch sử" và khung "Lịch sử tra cứu" báo lỗi (bảng chưa tồn tại), còn
      lại (ẩn/hiện cột, tick sinh text, Copy) hoạt động bình thường không
      cần migration.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (15
      route, không đổi). Logic sinh text đã test khớp ví dụ thật (xem trên).
      **Chưa test được UI thật bằng trình duyệt** trong phiên này (không có
      công cụ tự động hóa trình duyệt) — cần người dùng tự bấm thử qua `npm
      run dev`/production sau khi chạy migration.

77. **Export Excel — làm trước Import (2026-08-07)**. `app/import-export/page.tsx`
    trước đây chỉ là `PagePlaceholder`. Người dùng xác nhận qua hỏi đáp: làm
    **Export trước** (chỉ đọc, an toàn) — **Import (đọc file sửa tay, diff rồi
    xác nhận mới ghi) để riêng 1 đợt sau**, không làm trong đợt này.
    - **`lib/trunkExportData.ts`** (mới) — `fetchTrunkExportRows(client)`:
      query RIÊNG (không đụng `TrunkPortRow` dùng chung nhiều nơi, vì export
      cần thêm `execution_station_text`/`notes` mà type đó không mang) — copy
      cấu trúc từ `getRackAndPorts()` (`app/odf-trunk/[rackId]/page.tsx`)
      nhưng bỏ giới hạn 1 rack, lọc `racks.domain = 'trunk'` qua
      `racks!inner(...).eq("racks.domain","trunk")`. 1 dòng = 1 port (không
      gộp Tx/Rx — CLAUDE.md nguyên tắc #1). Phân trang theo `id` (con trỏ ổn
      định) rồi **sắp lại 1 lần ở cuối** theo `rackCode` rồi `portNumber` cho
      file dễ đọc (id không theo đúng thứ tự rack/port). Đã test bằng script
      tạm đọc CSDL thật: 2016 dòng, 41 rack trung kế, dữ liệu đúng.
    - **Cột ODF trung kế** (đúng file gốc, đã bỏ "Mức Độ ưu tiên" theo quyết
      định cũ, xác nhận lại cả từ `architecture.md` mục 3.9 lẫn header thật
      của `data/Cáp quang/...xls`): `Rack-sub ODF | Port | Sợi | Tên luồng |
      Giao tiếp | Chuyển tiếp | Đối phương | Phương án ứng cứu | Trạm thực
      hiện | Ghi chú`.
    - **Cột ODF thiết bị** — người dùng CHỌN xuất theo cấu trúc HIỆN TẠI của
      app (không cố tách lại 3 cột cũ "ODF chuyển tiếp/Thiết bị chuyển
      tiếp/TBi đầu cuối" của file gốc — dữ liệu đã gộp vào `notes` từ lúc
      `import-device-v2.ts` chạy, tách lại không đáng tin): `Tên luồng | Trib
      | Thiết bị | Vị trí ODF (thiết bị) | Vị trí ODF (tiếp theo) | Giao tiếp
      | Đối phương | Ghi chú` — khớp đúng cột đang hiện ở
      `DeviceCircuitList.tsx`, lấy thẳng từ `DeviceCircuitRow`
      (`lib/deviceCircuits.ts` `fetchDeviceCircuits`, tái dùng nguyên, không
      viết query mới).
    - **`lib/exportExcel.ts`** (mới) — `exportTrunkExcel(rows, rackIds)` /
      `exportDeviceExcel(rows, deviceNames)`: lọc theo phạm vi (`null` = tất
      cả), `XLSX.utils.aoa_to_sheet` với header cố định đúng thứ tự đã chốt
      (không suy từ object keys — tránh lệch thứ tự nếu sau này thêm field),
      `XLSX.writeFile(wb, "...xlsx")` — SheetJS tự tạo Blob + trigger tải
      xuống trong trình duyệt, không cần viết thêm helper download riêng
      (dự án chưa có helper này, đã kiểm tra).
    - **Phạm vi chọn khi xuất** — tái dùng NGUYÊN `GroupedMultiSelect.tsx`
      (dropdown chọn nhiều có nhóm + tìm kiếm, `selected=null`="tất cả",
      cùng pattern `DeviceCircuitList.tsx` đang dùng cho bộ lọc thiết bị):
      - ODF trung kế: items = rack (label=mã rack, group=tên tuyến cáp) — tự
        nhiên có CẢ "theo rack" (bỏ tick 1 rack) LẪN "theo tuyến cáp" (gõ tìm
        tên tuyến, "Chọn tất cả" trong nhóm lọc), không cần 2 UI riêng.
      - Hồ sơ đấu nối: items = tên thiết bị (group=Lĩnh vực, qua
        `deviceCategoryLabel`) — **KHÔNG có "theo rack"** cho domain này:
        `circuits` (luồng thiết bị) không có FK thật tới rack/port (chỉ text
        tự do), và chính `DeviceCircuitList.tsx` hiện tại cũng CHƯA từng lọc
        theo rack (chỉ theo thiết bị/lĩnh vực) — export dùng đúng quy ước lọc
        đã có, không bịa khái niệm phạm vi mới.
    - **`components/import-export/ImportExportClient.tsx`** (mới, `"use
      client"`) — 2 khối độc lập (ODF trung kế / Hồ sơ đấu nối), mỗi khối có
      `GroupedMultiSelect` + hiện số dòng sẽ xuất theo phạm vi đang chọn +
      nút "Xuất Excel" (khóa khi 0 dòng). `app/import-export/page.tsx` viết
      lại thành Server Component: tải hết 1 lần (`fetchTrunkExportRows` +
      `fetchDeviceCircuits` + `fetchDevices`, `Promise.all`), lọc phạm vi làm
      ở client — không round-trip lại server mỗi lần đổi lựa chọn (chấp nhận
      chi phí tải hết 1 lần, cùng mức đã chấp nhận ở các trang khác trong dự
      án, xem mục 72).
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (route
      `/import-export` từ 146B lên 96.1kB First Load JS — do bundle gói
      `xlsx` phía client, hợp lý vì cần build file .xlsx ngay trên trình
      duyệt). Query `fetchTrunkExportRows` đã test qua script tạm đọc CSDL
      thật (service-role key, không sửa gì, xóa script sau khi xong): 2016
      dòng port trung kế, 41 rack, dữ liệu đúng. **Chưa test được UI thật
      bằng trình duyệt** (không có công cụ tự động hóa trình duyệt trong môi
      trường này) — cần người dùng tự bấm thử qua `npm run dev`/production.
    - **Ngoài phạm vi đợt này**: Import Excel ngược lại (đọc file đã sửa tay,
      so sánh/diff với dữ liệu hiện có, xác nhận từng thay đổi rồi mới ghi) —
      người dùng đã chọn rõ để đợt sau, cần lập kế hoạch riêng.

78. **2 lỗi người dùng phát hiện sau khi dùng thử Export + Tìm kiếm
    (2026-08-08)**.
    - **"Chọn tất cả" ở khung Export không rõ ràng**: `GroupedMultiSelect`
      dùng `selected=null` ngầm định nghĩa "đã chọn hết" — đúng về logic
      (không chọn gì = xuất toàn trạm) nhưng người dùng không nhận ra, tưởng
      phải tick từng rack/thiết bị một trong dropdown 41 rack. **Fix**:
      `components/import-export/ImportExportClient.tsx` — thêm 1 checkbox
      RIÊNG "Toàn trạm"/"Tất cả thiết bị" ở mỗi khối, mặc định BẬT (ẩn hẳn
      `GroupedMultiSelect` lúc này); tắt checkbox mới hiện khung chọn cụ thể.
      Rõ ràng hơn hẳn so với dựa vào ngữ nghĩa ngầm của dropdown.
    - **"Xem tất cả kết quả tìm kiếm" (`/search`) chỉ có ODF trung kế, thiếu
      Hồ sơ đấu nối thiết bị** — đúng vậy: cả `app/search/page.tsx`
      (`fetchAllTrunkPorts` only) lẫn `CommandPalette.tsx` (Cmd+K, chỉ có
      `fetchAllTrunkPorts` + `fetchDevices` — có danh mục thiết bị nhưng
      KHÔNG có luồng thiết bị thật) đều chưa từng đụng tới
      `fetchDeviceCircuits`. **Fix**:
      - `CommandPalette.tsx` — thêm `fetchDeviceCircuits` vào lượt tải lười
        lúc mở lần đầu, thêm `ResultKind` mới `"device-circuit"`, neo tới
        `/odf-device/sua-luong#${rowAnchor(id)}` (tái dùng `rowAnchor()` có
        sẵn — `DeviceCircuitList.tsx` đã tự đọc hash này để cuộn/tô sáng
        đúng dòng, không cần thêm gì ở đó).
      - `/search` — **KHÔNG gộp chung 1 bảng** với ODF trung kế (2 domain
        cấu trúc cột khác hẳn: trung kế có Port/Sợi/Trạng thái cổng trống
        thật qua `port_circuit_links`; thiết bị chỉ có vị trí ODF dạng text,
        không có khái niệm "cổng trống" — gộp cưỡng ép ra bảng nhiều cột rỗng
        vô nghĩa). Thay bằng **`components/search/SearchTabs.tsx`** (mới,
        `"use client"`) chuyển đổi 2 tab "ODF trung kế"/"Hồ sơ đấu nối", mỗi
        tab 1 bảng riêng: `SearchClient.tsx` (giữ nguyên, trung kế) và
        **`components/search/DeviceSearchClient.tsx`** (mới) — copy đúng cấu
        trúc `SortableTh`/`ResizableTh`/`FilterInput`/`useColumnWidths` từ
        `SearchClient.tsx` cho đồng nhất, cột theo `DeviceCircuitRow` (Tên
        luồng/Thiết bị/Trib/Vị trí ODF thiết bị/Vị trí ODF tiếp theo/Đối
        phương), lọc "Đường dự phòng" qua `isStandbyCircuitName()` có sẵn
        (bỏ "Cổng trống" — không áp dụng domain này). `app/search/page.tsx`
        tải cả 2 nguồn 1 lần (`Promise.all`), truyền xuống `SearchTabs`.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch
      (`/search` 4.83kB, `/import-export` không đổi đáng kể). Chưa test UI
      thật bằng trình duyệt (không có công cụ tự động hóa trình duyệt trong
      môi trường này).

79. **"Cài đặt chung" (2026-08-08)** — thay `PagePlaceholder` cũ (nội dung lỗi
    thời "auth chưa cần ở MVP", trong khi auth 3 cấp đã bật từ mục Đợt 3,
    2026-08-06). Người dùng chọn 3 việc qua AskUserQuestion: thông tin tài
    khoản + đổi mật khẩu, quản lý tài khoản (chỉ Admin), ẩn nút Sửa/Xóa/Thêm
    theo vai trò.
    - **`lib/roleLabel.ts`** (mới) — tách `ROLE_LABEL` ra khỏi
      `components/Sidebar.tsx` để dùng chung với `app/settings/page.tsx`.
    - **Tài khoản + đổi mật khẩu**: `app/settings/page.tsx` viết lại (Server
      Component, lấy `user` qua `createSupabaseServerClient()` +
      `auth.getUser()` — đúng pattern `app/layout.tsx`), hiện email/vai
      trò/ngày tạo/lần đăng nhập gần nhất. `components/settings/
      ChangePasswordForm.tsx` (mới) gọi thẳng `supabase.auth.updateUser({
      password })` phía client (sửa CHÍNH tài khoản đang đăng nhập, không cần
      route API/service role).
    - **Quản lý tài khoản (chỉ Admin)** — LẦN ĐẦU đưa `SUPABASE_SERVICE_ROLE_KEY`
      vào runtime Next.js (trước đây chỉ dùng trong script CLI qua
      `scripts/lib/supabaseAdmin.ts`):
      - **`lib/supabaseAdminServer.ts`** (mới) — bản runtime của
        `getSupabaseAdmin()`, chỉ được import từ Route Handler.
      - **`lib/requireAdminApi.ts`** (mới) — helper dùng chung cho mọi route
        `app/api/admin/**`: xác minh qua cookie phiên thật (không tin tham số
        client) người gọi đã đăng nhập VÀ role=admin trước khi cho chạm tới
        client service-role.
      - **`app/api/admin/users/route.ts`** (mới) — `GET` (`auth.admin.
        listUsers`) + `POST` (`auth.admin.createUser` với `app_metadata.role`,
        đúng cách `scripts/create-role-test-accounts.ts` đang tạo tài khoản
        test).
      - **`app/api/admin/users/[userId]/route.ts`** (mới) — `PATCH` đổi vai
        trò (`auth.admin.updateUserById`, merge với `app_metadata` hiện có
        qua `getUserById` trước khi ghi đè). CHẶN tự đổi vai trò của chính
        mình (`userId === caller.id`) — tránh tự khóa quyền admin do bấm
        nhầm, disable luôn ở UI (`components/settings/UserManagementPanel.tsx`,
        mới) kèm chú thích lý do.
      - Không làm: xóa tài khoản qua UI (vẫn qua Supabase Dashboard — thao
        tác hiếm, rủi ro cao hơn lợi ích).
    - **Ẩn nút Sửa/Xóa/Thêm theo vai trò** — trước đó CHƯA có primitive nào
      (0 kết quả grep `useRole`/`RequireRole`), CLAUDE.md ghi rõ đây là việc
      "chưa làm". Thêm mới:
      - **`components/RoleProvider.tsx`** — Context nhận `role` làm PROP từ
        `app/layout.tsx` (dùng lại đúng `userRole` đã tính sẵn ở đó cho
        Sidebar, KHÔNG gọi lại Supabase phía client — tránh round-trip mạng
        thừa/tránh nháy nút trước khi ẩn), export `useRole()`.
      - **`components/ui/RoleGate.tsx`** — `<RoleGate allow={[...]}>` ẩn hẳn
        (không disable+tooltip) nội dung con nếu role hiện tại không nằm
        trong `allow`; role null (chưa gán quyền) luôn bị coi là không đủ
        quyền.
      - Áp vào TOÀN BỘ nút/khối ghi dữ liệu tìm được qua grep
        `supabase\.(from|rpc)\(` trong `components/` (9 file gọi trực tiếp +
        2 file dùng qua `lib/*` như `TrunkMissingDeviceMirrorTab.tsx`,
        `DataQualityClient.tsx`): `PortTable.tsx`, `DeviceCircuitList.tsx`,
        `DeviceCategoryClient.tsx`, `DevicePositionMapClient.tsx`,
        `RackHeader.tsx`, `RackAdminPanel.tsx` (cả khối — chỉ thao tác
        rack/port), `AddDeviceRackForm.tsx`, `DeleteRackButton.tsx`,
        `TransitFormatWarning.tsx`, `TrunkMissingDeviceMirrorTab.tsx`,
        `DataQualityClient.tsx`, `ReportHistoryDrawer.tsx`,
        `CircuitReportPanel.tsx`. Allow-list chọn ĐÚNG theo ranh giới RLS đã
        có (không bịa luật mới): `allow={["operator","admin"]}` cho
        Thêm/Sửa/Xóa-từng-luồng (`write_operator_admin`/`update_operator_
        admin`/`operator_delete` — bảng `circuits`, `port_circuit_links`,
        `transit_links`, `device_position_map`, `report_history`);
        `allow={["admin"]}` cho xóa CẢ rack/thiết bị (`admin_delete` — bảng
        `devices`, `ports`, `racks`, gồm cả "Gộp thiết bị" ở
        `DataQualityClient.tsx` vì `mergeDeviceInto()` xóa thẳng 1 dòng
        `devices`). Link điều hướng thuần túy (xem, không ghi) KHÔNG gate —
        chỉ gate nút hành động THẬT.
      - RLS ở CSDL vẫn là nơi chặn thật (như badge role ở Sidebar từ trước) —
        `RoleGate` chỉ là UI thuận tiện, không thay thế RLS.
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch (2 route
      mới `/api/admin/users`, `/api/admin/users/[userId]` lên đúng, `/settings`
      179B→2.91kB). Chưa test UI thật bằng trình duyệt (không có công cụ tự
      động hóa trình duyệt trong môi trường này) — cần người dùng tự đăng
      nhập lần lượt viewer/operator/admin (`npm run create-role-accounts`) để
      xác nhận đúng nút bị ẩn theo đúng vai trò, và tự thử đổi mật khẩu/quản
      lý tài khoản trên trang `/settings`.

80. **Chuẩn hóa bảng dữ liệu + mở rộng Quản lý tài khoản + đổi tên + thu gọn
    panel "Phát hiện..." (2026-08-08)** — yêu cầu người dùng: 9 bảng dữ liệu lớn
    trong app làm sort/filter/resize/ẩn-hiện-cột không đồng nhất (2 pattern
    header khác nhau, chỉ 3/9 bảng có ẩn/hiện cột), lỗi ô filter lệch hàng khi
    resize cột, thiếu nút Xuất Excel trên từng bảng, bảng load hết dữ liệu
    ngay khi mở tab (chậm), nút thao tác nên là icon, và admin chưa quản lý
    được tài khoản cấp dưới đầy đủ.
    - **Quy định chung cho MỌI bảng dữ liệu từ nay** (áp dụng lại cho 9 bảng
      hiện có, dùng làm chuẩn cho bảng mới sau này):
      - Header: `components/ui/DataTh.tsx` (mới) — 1 component gộp
        nhãn+sắp xếp+lọc+kéo dãn vào ĐÚNG 1 `<th>` sticky, THAY THẾ
        `SortableTh`/`ResizableTh` (2 file cũ — đã XÓA hẳn, không còn nơi nào
        dùng sau khi đổi hết 9 bảng) VÀ các bản viết tay riêng (`Th` ở
        `PortTable.tsx`, `SortFilterTh`/`FilterOnlyTh` ở
        `DeviceCircuitList.tsx`). **Sửa đúng gốc lỗi lệch
        hàng khi resize**: nhãn cột trong `DataTh` LUÔN `truncate` (1 dòng,
        cắt bằng "...", có `title` đầy đủ) — cột hẹp trước đây làm nhãn dài
        xuống 2 dòng, đẩy `FilterInput` ở cột đó lệch xuống so với cột bên
        cạnh (label 1 dòng); nay nhãn không bao giờ đổi chiều cao `<th>`.
      - `<table className="table-fixed">` + `<colgroup>` bắt buộc mọi bảng
        (đã đúng ở 8/9, riêng `DashboardClient.tsx` (`TableView`) trước đây
        `min-w-full` không `colgroup` — đã sửa, resize giờ mới có tác dụng).
      - Ẩn/hiện cột: `components/ui/ColumnPicker.tsx` đổi nút chữ "Cột hiển
        thị (n/m)" thành icon Gear (badge số cột đang ẨN, không phải đang
        hiện) — áp dụng `useColumnVisibility` cho toàn bộ 9 bảng (trước chỉ
        3/9 có: `PortTable`, `DeviceCircuitList`, `DeviceRackPortView`).
      - Xuất Excel theo cột đang hiển thị: `lib/exportExcel.ts` thêm hàm
        generic `exportRowsToExcel<T>(columns, rows, opts)` (2 hàm cũ
        `exportTrunkExcel`/`exportDeviceExcel` GIỮ NGUYÊN, chỉ dùng ở trang
        `/import-export` riêng, không đụng) + `components/ui/
        ExportExcelButton.tsx` (mới, icon Download) gói lại thành 1 nút dùng
        chung — mỗi bảng tự truyền `columns` đã lọc theo `visible` +
        `rows` đã qua sort/filter hiện tại, xuất ĐÚNG những gì đang thấy trên
        màn hình (không phải 1 view cố định khác như trang Import/Export).
      - Icon hóa nút thao tác: `components/ui/icons.tsx` (mới) — SVG inline
        tay vẽ (`IconPin`/`IconPinOff`/`IconEdit`/`IconTrash`/`IconCheck`/
        `IconGear`/`IconDownload`), KHÔNG thêm thư viện icon ngoài. Áp dụng
        cho nút Ghim/Bỏ ghim (`Sidebar.tsx`) và mọi nút Sửa/Xóa/Ack (giữ
        `title`/`aria-label` đầy đủ tên thao tác — chỉ ẩn chữ khỏi hiển thị,
        không bỏ hẳn; vài chỗ đứng riêng lẻ ngoài bảng — vd "Xóa rack này",
        "Sửa tên tuyến" — giữ icon+chữ vì có ngữ cảnh câu văn xung quanh,
        không phải ô hẹp trong bảng).
      - **Mặc định KHÔNG hiện dữ liệu tới khi chọn lọc** — `components/ui/
        EmptyUntilFiltered.tsx` (mới, dùng chung): hiện khung "Chọn ... để
        xem, hoặc" + nút "Xem tất cả" — bấm 1 trong 2 mới render bảng. Áp
        dụng ở `DeviceCircuitList.tsx`, `SearchClient.tsx`,
        `DeviceSearchClient.tsx`, `DeviceCategoryClient.tsx`,
        `DevicePositionMapClient.tsx` (đều thêm state `viewAll` tách biệt
        với bộ lọc lĩnh vực/thiết bị hiện có — bấm nút lọc "Tất cả" cũng coi
        như đã chọn xem, không chỉ riêng nút "Xem tất cả"). `/odf-trunk`
        (`RackListTable` qua rack trung kế): trước đây KHÔNG có slicer nào,
        hiện thẳng 41 rack — thêm `components/odf-trunk/
        TrunkRackListPanel.tsx` (mới) dùng `GroupedMultiSelect` theo tuyến
        cáp (tái dùng y hệt cách `ImportExportClient.tsx` đã chọn rack trung
        kế) + `EmptyUntilFiltered`. `/odf-device` (rack thiết bị, 112 dòng):
        theo lựa chọn người dùng — KHÔNG bắt buộc chọn trước (bảng nhỏ hơn
        nhiều so với 2000+ dòng luồng), giữ nguyên hành vi hiện toàn bộ, chỉ
        hưởng lợi gián tiếp từ `RackListTable.tsx` đã có sẵn ô lọc "Mã rack".
        **KHÔNG đụng** các khung "Phát hiện..." (`data-quality/*`) — giữ
        nguyên để xem tốc độ phản hồi trước, đúng yêu cầu người dùng.
      - `RackListTable.tsx` (dùng chung 2 nơi) viết lại đầy đủ theo quy định
        trên (`DataTh`, `ColumnPicker`, `ExportExcelButton`) — không đổi
        props/hành vi lọc theo cột đã có.
    - **Mở rộng "Quản lý tài khoản" (Admin)** — 3 việc người dùng nêu chưa
      làm được ở đợt 79: xóa tài khoản cấp dưới, đặt lại mật khẩu tài khoản
      cấp dưới, liệt kê rõ quyền từng vai trò.
      - `app/api/admin/users/[userId]/route.ts` — thêm `DELETE` (chặn tự
        xóa chính mình, cùng pattern guard với PATCH đổi vai trò đã có).
      - `app/api/admin/users/[userId]/password/route.ts` (mới) — `POST
        {password}`, `admin.auth.admin.updateUserById(userId, {password})`
        (KHÔNG chặn tự đặt lại mật khẩu chính mình — khác đổi vai trò, không
        có rủi ro tự khóa quyền).
      - `components/settings/UserManagementPanel.tsx` — thêm cột "Thao tác"
        mỗi dòng (icon Edit = đặt lại mật khẩu inline, icon Trash = xóa,
        disable ở dòng chính mình), và khối tĩnh phía trên bảng liệt kê ĐÚNG
        quyền từng vai trò (khớp thật với RLS — `supabase/migrations/
        20260806000001_authenticated_rls.sql`/`20260807000001_fix_role_
        policies.sql`, không phải mô tả tự suy diễn) để admin biết chính xác
        đang cấp/thu hồi gì.
      - `lib/roleLabel.ts` — đổi nhãn hiển thị `"Viewer (chỉ xem)"` →
        `"View (chỉ xem)"` (yêu cầu người dùng "không dùng khái niệm
        viewer") — CHỈ đổi chữ, giá trị `"viewer"` lưu thật ở
        `app_metadata.role`/RLS/API GIỮ NGUYÊN (đổi cả giá trị đó rủi ro cao
        hơn nhiều, người dùng chọn không làm).
    - **Đổi tên (3 chỗ)**: `app/odf-trunk/page.tsx` "ODF Trung kế" → "Hồ sơ
      ODF Trung kế"; `app/odf-device/vi-tri-thiet-bi/page.tsx` "Vị trí thiết
      bị → ODF/DDF" → "Thư viện vị trí thiết bị"; `components/Sidebar.tsx` +
      `app/import-export/page.tsx` "Import / Export Excel" → "Import/Export
      dữ liệu".
    - **Thu gọn khung "Phát hiện..." — ĐÃ LÀM** (đề xuất ở lần cập nhật đầu
      của mục này, người dùng xác nhận làm luôn ngay sau đó): `lib/
      useCollapsed.ts` (mới) — `useCollapsed(storageKey, defaultCollapsed=
      true)`, rập khuôn lazy-init localStorage của `lib/useColumnVisibility.ts`
      (đọc NGAY trong `useState` initializer, không nháy khung hình mặc định
      rồi mới lật sang giá trị đã lưu). Áp trực tiếp vào 11 khung "Phát
      hiện..." (không tách component `CollapsiblePanel` dùng chung được vì
      mỗi khung có 1 tông màu Tailwind riêng — `border-sky-200`/`border-
      violet-200`/`border-rose-200`/`border-red-200`/`border-amber-200` —
      Tailwind JIT cần thấy đúng class tĩnh trong source, không ghép được
      `border-${color}-200` động; mỗi file tự thêm `useCollapsed()` + nút
      +/− cạnh `<h2>`, giữ nguyên class màu tĩnh của chính nó):
      `components/odf-trunk/TransitFormatWarning.tsx`,
      `components/data-quality/TrunkMissingDeviceMirrorTab.tsx`,
      `UnlinkedMirrorPairsTab.tsx`, `MismatchedLinkedPairsTab.tsx`,
      `UnlinkedDeviceMirrorPairsTab.tsx`, `TransitPositionMismatchTab.tsx`,
      `DeviceLibraryMismatchTab.tsx`, `DivergentTransitTab.tsx`, và 3 khung
      viết trực tiếp trong `DataQualityClient.tsx` (`DeviceDupTab`,
      `PositionConflictsTab`, `OwnPositionDuplicatesTab`). Mặc định ĐÓNG,
      tiêu đề (kèm số đếm, vd "Phát hiện 12 dòng...") LUÔN hiện dù đóng hay
      mở — biết có gì mà không cần mở; nút +/− nhớ trạng thái riêng từng
      khung (key `hskt:collapsed:<tên khung>`). Đóng/mở chỉ ẩn/hiện DOM —
      KHÔNG giảm chi phí tải dữ liệu phía server (`app/data-quality/page.tsx`
      vẫn tính TOÀN BỘ dữ liệu phát hiện trước khi trả HTML, như đã ghi ở đề
      xuất ban đầu) — giảm thật cần đổi kiến trúc trang sang tải-khi-mở, lớn
      hơn nhiều, KHÔNG làm đợt này (chưa có yêu cầu).
    - **Kiểm chứng**: `npx tsc --noEmit` sạch, `npm run build` sạch. Bundle
      từng route tăng đáng kể (vd `/dashboard` 195kB→292kB) — do `xlsx`
      (SheetJS) giờ được import ở 8+ trang thay vì chỉ `/import-export`, mỗi
      route tự bundle riêng phần đó thay vì dùng chung 1 chunk (Next.js chưa
      gom vào nhóm "shared by all") — hợp lý, đánh đổi cần thiết để mọi bảng
      export được, không phải rò rỉ/lỗi. Chưa test UI thật bằng trình duyệt
      (không có công cụ tự động hóa trong môi trường này) — cần người dùng tự
      bấm thử: resize cột hẹp xem ô lọc còn thẳng hàng không, xuất Excel thử
      vài bảng, vào `/odf-trunk` xem mặc định rỗng + chọn tuyến cáp, vào
      `/settings` (admin) thử xóa/đặt lại mật khẩu 1 tài khoản test, và vào
      `/data-quality` bấm +/− vài khung "Phát hiện..." xem đóng/mở đúng +
      reload lại trang xem có nhớ đúng trạng thái đã đóng/mở không.

    - **Đợt tiếp (2026-08-08) — tối ưu tốc độ vào "Hồ sơ ODF Trung kế"
      (`/odf-trunk`)**: người dùng hỏi việc mở rộng khung "Phát hiện..." có
      phải nguyên nhân làm chậm khi vào các tab khác không. Khảo sát cho thấy
      2 trang có khung "Phát hiện..." nhưng tình trạng KHÁC hẳn nhau:
      - `DeviceCircuitList.tsx` ("Hồ sơ đấu nối"): khung "Phát hiện vị trí
        DDF/ODF trùng" chỉ là `useMemo(() => findDevicePositionConflicts
        (circuits), [circuits])` — tính ngay ở trình duyệt từ `circuits` ĐÃ
        tải sẵn cho bảng chính, KHÔNG gọi thêm Supabase. Không phải nguyên
        nhân chậm — không sửa gì ở đây.
      - `app/odf-trunk/page.tsx` ("Hồ sơ ODF Trung kế", trang danh sách
        rack): NGƯỢC LẠI, đây đúng là nguyên nhân thật. Trang này gọi
        `fetchAllOdfPorts()` (toàn bộ port toàn trạm) rồi
        `fetchNonConformingTransitLinks()` CHỈ để phục vụ khung
        `TransitFormatWarning` — danh sách rack chính
        (`TrunkRackListPanel`/`getRacks()`) có query riêng, nhẹ hơn nhiều,
        không cần 2 lời gọi đó. Trước sửa, toàn bộ `Promise.all(...)` +
        `await fetchNonConformingTransitLinks(...)` phải xong hết thì Next
        mới trả HTML — nghĩa là danh sách rack (đã sẵn sàng sớm) vẫn phải
        đợi đúng bằng thời gian của khung cảnh báo (chậm hơn nhiều) mới hiện
        ra, kể cả khi khung đó đang thu gọn/người dùng không quan tâm.
      - **Cách sửa**: KHÔNG chuyển sang "tải khi bấm mở" (sẽ mất tính năng đã
        làm ở đợt trước — tiêu đề collapsed vẫn hiện số đếm ngay cả khi chưa
        mở) — thay vào đó dùng `<Suspense>` (React/Next.js App Router chuẩn):
        tách phần tính `nonConformingTransit` ra 1 async Server Component
        con (`TransitWarningSection`) bọc trong `<Suspense fallback=
        {<TransitWarningSkeleton />}>`, còn `getRacks()` await trực tiếp
        NGOÀI Suspense. Kết quả: HTML danh sách rack trả về NGAY khi
        `getRacks()` xong (không đợi phần chậm), khung cảnh báo tự "trôi"
        vào sau khi `fetchAllOdfPorts`/`fetchNonConformingTransitLinks` xong
        — KHÔNG đổi dữ liệu/hành vi hiển thị (vẫn đủ số đếm, vẫn Ack được),
        chỉ đổi THỜI ĐIỂM nó xuất hiện trên trang. Rủi ro thấp hơn nhiều so
        với thêm API route + fetch phía client (không cần viết lại
        `TransitFormatWarning.tsx`/thêm route mới/nhân đôi logic auth).
      - Trang chi tiết 1 rack (`app/odf-trunk/[rackId]/page.tsx`) KHÔNG đụng
        — ở đó `trunkPorts` cần cho nhiều tính năng khác (badge liên kết,
        "Kiểm tra đồng bộ") nên không phải phí riêng của khung cảnh báo, và
        câu truy vấn `fetchNonConformingTransitLinks` đã lọc theo đúng
        `rack.id` từ đợt tối ưu 2026-08-01 — đã rẻ sẵn.
      - File sửa: `app/odf-trunk/page.tsx` — thêm `TransitWarningSection`
        (async) + `TransitWarningSkeleton`, `getRacks()` await riêng, không
        còn gộp `Promise.all` với `fetchAllOdfPorts`.
      - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa đo thời
        gian tải thật (không có công cụ trình duyệt) — người dùng tự vào
        `/odf-trunk` xem danh sách rack có hiện nhanh hơn, khung "Phát hiện
        Chuyển tiếp chưa chuẩn form" có tự hiện vào ngay sau đó (không bị mất
        hẳn) hay không.
      - Cùng kỹ thuật (`<Suspense>` tách phần chậm) có thể áp dụng tiếp cho
        `/data-quality` (11 khung tính hết trong 1 Server Component, xem đề
        xuất chưa làm ở trên) để giảm thời gian vào trang đó — CHƯA làm, chỉ
        ghi lại hướng đi nếu người dùng cần sau này.

- **Mục 81 (2026-08-08) — Mở rộng Suspense sang 3 trang còn lại, cột "Liên
  kết" dạng icon lọc được, đồng hồ thời gian tải trang, tiêu đề tab theo
  từng trang, chuẩn hóa lại style thật sự giữa các bảng.** Người dùng chỉ ra
  "Hồ sơ ODF Trung kế"/"Hồ sơ đấu nối" cũng có khung "Phát hiện..." như
  `/data-quality`, hỏi có phải nguyên nhân chậm khi vào các trang đó không
  (khác câu hỏi đợt trước chỉ hỏi về `/data-quality`).

  1. **Suspense cho 3 trang còn lại** (cùng kỹ thuật mục 80, theo brief
     `FIX-suspense-odf-device-rack-detail.md` người dùng cung cấp, có điều
     chỉnh nhỏ khi thấy cách đơn giản hơn mà vẫn đạt mục tiêu):
     - `app/odf-device/page.tsx`: tách `RackListSection` (async, gọi
       `getRacks()` — vốn cần `fetchAllOdfPorts` toàn trạm để tính Đang
       dùng/Dự phòng) bọc `<Suspense>`; `<AddDeviceRackForm>` (không cần dữ
       liệu rack) render ngay, không đợi. Đơn giản hơn phương án "tách
       racks-cơ-bản/đầy-đủ" trong brief gốc — không cần vì trang này không
       có nội dung nào khác dùng riêng `racks` cơ bản.
     - `app/odf-trunk/[rackId]/page.tsx`: `RackHeader`/`RackAdminPanel`/
       `DangerZone` render ngay (chỉ cần `getRackAndPorts` đã lọc theo
       rackId + 4 fetch nhẹ: `fetchCircuitOptions`/`fetchDevices`/
       `fetchDeviceAliases`/`fetchDevicePositionMap`). Toàn bộ phần nặng
       (`fetchAllOdfPorts`, `fetchDeviceCircuits`, `findUnlinkedMirrorPairs`,
       `findUnlinkedDeviceDevicePairs`, `computeMirrorLinkStatuses`,
       `findAllDeviceTrunkPairs`, `fetchNonConformingTransitLinks`,
       `fetchDeviceRackPortRefs`) gộp CHUNG 1 async component
       `RackDetailBody` bọc 1 `<Suspense>` duy nhất (Cách A trong brief —
       không tách riêng `PortTable`/`TransitFormatWarning` thành 2 Suspense
       để tránh gọi `fetchAllOdfPorts`/`fetchDeviceCircuits` 2 lần).
     - `app/odf-device/sua-luong/page.tsx`: `DeviceCircuitSection` (async,
       gồm `fetchAllOdfPorts` + các hàm rà soát nặng) bọc `<Suspense>`;
       `circuits`/`devices`/`devicePositionMap`/`deviceAliases` (4 fetch nhẹ,
       độc lập) await riêng ở ngoài, đủ để hiện tiêu đề + số đếm luồng ngay.
     - Không đụng `app/odf-trunk/page.tsx` (đã tối ưu mục 80).
     - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch sau mỗi bước.

  2. **Cột "Liên kết" dạng icon, lọc/sắp xếp được** (thay ký hiệu
     "🔗 Đã liên kết"/"⚠️ Chưa liên kết" gắn cạnh TÊN luồng — người dùng yêu
     cầu bỏ hẳn kiểu cũ, chuyển thành 1 CỘT riêng):
     - `components/ui/MirrorLinkBadge.tsx` (cũ) → xóa, thay bằng
       `components/ui/MirrorLinkStatusIcon.tsx` (mới) — vẫn nhận đủ 3 trạng
       thái từ `lib/mirrorLinkStatus.ts` (`linked`/`candidate`/không có gì),
       icon `IconLink`/`IconLinkOff` (mới, `components/ui/icons.tsx`) +
       chữ nhỏ, màu phân biệt (emerald/amber/slate) giữ đúng ý nghĩa cũ,
       bấm vào ca "linked" vẫn nhảy `/circuit/[id]` như trước.
     - `lib/mirrorLinkStatus.ts` thêm `mirrorLinkStatusLabel()` — gộp
       "candidate" + "không có gì" thành 1 chữ hiển thị/lọc "Chưa liên kết"
       (đúng yêu cầu "lọc được Đã/Chưa liên kết" — chỉ 2 giá trị lọc, icon
       vẫn phân biệt 3 trạng thái nội bộ).
     - `PortTable.tsx`: thêm `"linkStatus"` vào `SortKey`/`FilterKey`/
       `VisibleCol` (toggle được như 7 cột khác, mặc định hiện), cột đặt
       ngay sau "Tên luồng" (rowSpan gộp theo circuit như cột tên); bỏ
       `<MirrorLinkBadge>` khỏi ô tên; thêm vào `exportColumns`.
     - `DeviceCircuitList.tsx`: cùng cách làm (`cellText`/`compareByKey`
       nhận thêm tham số `mirrorLinkStatuses`), cột đặt sau "Tên luồng".
     - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch.

  3. **Đồng hồ thời gian tải trang** (`components/ui/PageLoadTimer.tsx`,
     mới) — mount 1 lần ở `app/layout.tsx` (như `CommandPalette`), hiện góc
     dưới-phải MỌI trang (không phụ thuộc Sidebar ghim/ẩn). Next.js 14 App
     Router chưa có hook chính thức đo thời gian điều hướng giữa 2 trang —
     cách đo: bắt thời điểm bấm vào `<a href="/...">` nội bộ (capture phase,
     `document.addEventListener("click", ..., true)`), tính khoảng cách tới
     lúc `usePathname()` đổi sang route mới; lần tải ĐẦU (F5/gõ URL) dùng
     Navigation Timing API (`performance.getEntriesByType("navigation")`)
     vì không có click nào để bắt. Với các trang dùng `<Suspense>` (mục 80,
     81.1), mốc này rơi vào lúc PHẦN NHANH commit xong, CHƯA tính khung phụ
     còn tải sau — chủ đích (đúng cái người dùng muốn thấy: "bao lâu thấy
     được nội dung chính"), có ghi rõ trong tooltip của chính đồng hồ.

  4. **Tiêu đề tab trình duyệt theo từng trang** — trước đó MỌI trang đều kế
     thừa `title: "Hồ sơ kỹ thuật"` tĩnh từ `app/layout.tsx`. Thêm
     `export const metadata: Metadata = { title: "..." }` vào từng
     `page.tsx` (Next.js: title con ghi đè hoàn toàn title cha, không dùng
     `title.template`): Dashboard, Chất lượng dữ liệu, Danh mục thiết bị,
     Import/Export dữ liệu, Thư viện vị trí thiết bị, Hồ sơ ODF Trung kế, Hồ
     sơ ODF Thiết bị, Hồ sơ đấu nối, Tìm kiếm nhanh, Cài đặt chung, Chi tiết
     luồng (`/circuit/[id]`, tĩnh — không `generateMetadata` lấy tên luồng
     thật vì sẽ phải fetch lại y hệt `findPair`/`fetchCircuitDetail`, tốn
     thêm 1 lượt tải chỉ cho tiêu đề, trang permalink này không đáng). Riêng
     `/odf-trunk/[rackId]` dùng `generateMetadata` với 1 query nhỏ riêng
     (chỉ `select("code")`) để tiêu đề ghi đúng "Rack <mã>". `/login` là
     Client Component (không tự export `metadata` được) — thêm
     `app/login/layout.tsx` (Server Component) chỉ để khai báo title.
     Trang chủ `/` giữ nguyên title mặc định (khớp đúng `<h1>` của chính nó).

  5. **Chuẩn hóa lại style THẬT SỰ giữa các bảng** — người dùng chỉ ra header
     dùng chung `DataTh` không đồng nghĩa cả bảng nhìn giống nhau. Dùng 1
     agent đọc toàn bộ 9 file bảng + 5 file "chuẩn chung" để liệt kê khác
     biệt thật (không đoán), rồi sửa theo canonical chọn = giá trị đã dùng ở
     ĐA SỐ file hoặc đúng giá trị `DataTh.tsx` đã tự áp (báo hiệu đây mới là
     "chuẩn" thật sự đang tồn tại, các nơi lệch mới là chưa theo đúng):
     - **Khung bọc bảng**: `max-h-[70vh] overflow-auto rounded-lg border
       border-slate-200 bg-white` (thiếu `max-h`+`overflow-auto` thì sticky
       header KHÔNG hoạt động, chỉ trang tự cuộn thay — lỗi CHỨC NĂNG, không
       chỉ thẩm mỹ) — áp cho `RackListTable`, `SearchClient`,
       `DeviceSearchClient`, `DevicePositionMapClient`, `DashboardClient`
       (TableView), `DeviceRackPortView` (6 file trước đó chỉ có
       `overflow-x-auto`).
     - **Padding `<td>`/`<th>` viết tay** (không qua `DataTh`): chuẩn hóa về
       `px-3 py-2` (đúng giá trị `DataTh.tsx` đã tự dùng cho mọi `<th>` —
       trước đó 7/9 file dùng `px-4 py-2` cho `<td>`, lệch với chính header
       của mình). `<th>` viết tay (cột tick/"Thao tác", không qua `DataTh`)
       chuẩn hóa về `px-3 py-2 text-left align-top font-semibold`.
     - **Màu hover dòng**: `hover:bg-primary-50/50` — sửa `PortTable.tsx`
       (đang `/30`), thêm hover còn thiếu ở `DashboardClient` TableView và
       `DeviceRackPortView` (trước đó không có hover nào).
     - **`DeviceRackPortView.tsx`**: trước đó header không `sticky` (viết
       tay hoàn toàn khác `DataTh`, `font-medium` thay vì `font-semibold`) —
       sửa `sticky top-0 z-10 bg-primary-50` + `font-semibold` khớp `DataTh`.
     - **Độ rộng cột tick** trong `<colgroup>`: 40px (khớp `PortTable`/
       `DeviceCategoryClient`) — sửa `DeviceCircuitList.tsx` (đang 32px).
     - **Chữ khi lọc không ra kết quả**: thống nhất "Không tìm thấy {X} nào
       khớp bộ lọc." — sửa `DeviceCircuitList.tsx` ("...kết quả nào...") và
       `DevicePositionMapClient.tsx` ("Chưa có dòng nào...").
     - **Toolbar trên bảng**: thống nhất 1 dòng `mb-2 flex flex-wrap
       items-center gap-3` — đếm "x/y ..." + "Xóa bộ lọc" (nếu có) bên trái,
       cụm nút (Lịch sử tra cứu/Export/ColumnPicker...) bọc
       `<div className="ml-auto flex gap-2">` bên phải. `PortTable.tsx`
       trước đó tách 2 khối riêng (không có dòng đếm, toolbar chính
       `justify-end`) — gộp lại đúng 1 dòng theo mẫu chung, thêm dòng đếm
       "x/y port". `DeviceCategoryClient.tsx` đổi `mb-3`→`mb-2` khớp các
       bảng khác (bộ nút bấm mỗi bảng vẫn khác nhau tùy tính năng riêng —
       KHÔNG ép giống hệt, chỉ ép phần khung/khoảng cách dùng chung).
     - Đã đủ dữ liệu nhưng CHƯA sửa (không đáng, không ảnh hưởng hiển thị):
       thứ tự class trong `className="w-full table-fixed text-sm"` (đã tiện
       sửa luôn ở `PortTable.tsx` vì đang sửa toolbar cùng chỗ, nhưng đây là
       thay đổi trung tính, không sinh khác biệt CSS thật).
     - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch sau khi sửa hết
       9 file.

  Chưa test UI thật bằng trình duyệt (không có công cụ tự động hóa trong
  môi trường này) — cần người dùng tự bấm thử: vào `/odf-device`,
  `/odf-trunk/<1 rack>`, `/odf-device/sua-luong` xem phần đầu trang (form
  thêm rack/tiêu đề rack/tiêu đề+số đếm luồng) hiện nhanh, phần bảng port/
  khung cảnh báo tự trôi vào sau; xem cột "Trạng thái" mới ở 2 bảng (thử
  dropdown lọc, không phải gõ chữ); để ý góc dưới-phải màn hình có đồng hồ
  "⏱ Xms/Ys" đổi theo mỗi lần chuyển trang; xem tiêu đề tab trình duyệt đổi
  đúng theo từng trang; so sánh cảm quan style giữa vài bảng (RackListTable,
  PortTable, DeviceCircuitList) xem đã đều tay hơn chưa.

  **Sửa tiếp cùng ngày** (người dùng phản hồi sau khi xem lại): đổi tên cột
  "Liên kết" → "Trạng thái"; ô lọc đổi từ gõ chữ tự do sang CHỌN SẴN (dropdown)
  — thêm `components/ui/FilterSelect.tsx` (mới) + `DataTh.tsx` thêm prop
  `filterOptions?` (có thì render `FilterSelect` thay `FilterInput`, dùng
  chung vị trí/kích thước trong `<th>`, không lệch hàng với cột khác). Giá
  trị lọc tách lại đủ 3 khóa `"linked"|"candidate"|"none"`
  (`lib/mirrorLinkStatus.ts` — `mirrorLinkFilterKey()`,
  `MIRROR_LINK_FILTER_OPTIONS`) thay vì gộp còn 2 như đợt trước, khớp đúng 3
  màu thật đang hiện (emerald/amber/slate). Icon trong bảng (component
  `MirrorLinkStatusIcon.tsx`) bỏ hẳn chữ "Đã/Chưa liên kết" đi kèm — chỉ còn
  icon + màu, giữ `title` (tooltip) để vẫn tra được ý nghĩa khi rê chuột.
  Riêng cột xuất Excel vẫn giữ chữ người đọc được ("Đã liên kết"/"Chưa liên
  kết", qua `mirrorLinkStatusLabel()` — không đổi, khác mục đích với khóa lọc
  UI). Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch.

- **Mục 82 (2026-08-08) — Kéo-thả đổi thứ tự cột cho CẢ 9 bảng dữ liệu.**
  Người dùng: "table view cho phép sắp xếp các cột không theo tuần tự hiện
  tại, có thể kéo cột này ra trước cột kia ra sau" — chọn làm tất cả 9 bảng
  cùng lúc (không làm thử 1-2 bảng trước).

  - **Hạ tầng dùng chung** (áp dụng quy định chung mọi bảng, giống
    `useColumnVisibility`/`useColumnWidths`):
    - `lib/useColumnOrder.ts` (mới) — `useColumnOrder(storageKey, defaultOrder):
      {order, moveColumn, reset}`, nhớ thứ tự qua localStorage (lazy init
      giống 2 hook kia). `moveColumn(dragged, target)` chèn `dragged` vào
      NGAY TRƯỚC `target`. Khi tải lại thứ tự đã lưu: lọc bỏ key không còn
      tồn tại + tự thêm key MỚI (cột thêm sau này) vào cuối — không bao giờ
      mất cột dù đổi code sau khi người dùng đã lưu thứ tự cũ.
    - `components/ui/DataTh.tsx` — thêm `reorderKey?`/`onReorderColumn?`.
      CHỈ icon 6-chấm mới `draggable` (không phải cả `<th>`) để không đụng
      vùng click-sort/gõ ô lọc/kéo resize đã có; `<th>` là vùng THẢ
      (`onDragOver`/`onDrop`, tô `bg-primary-200` khi đang kéo qua) — dễ
      nhắm hơn nhiều so với chỉ được thả trúng icon nhỏ. Icon mới
      `IconGripVertical` (`components/ui/icons.tsx`).
    - `components/ui/ColumnPicker.tsx` — thêm prop `onResetOrder?`, có thì
      hiện nút "Đặt lại thứ tự cột" cuối dropdown (chỗ hoàn tác nếu lỡ kéo
      sai, không phải tự kéo tay lại từng cột).
  - **Áp dụng cho 8/9 bảng** (mỗi bảng: hook `useColumnOrder` lấy đúng tập
    `VisibleCol`/`COLUMN_ITEMS` đã có sẵn làm `defaultOrder`, thêm
    `orderedVisible = order.filter(k => visible[k])`, viết lại
    `<colgroup>`/hàng tiêu đề/hàng dữ liệu từ "liệt kê cứng từng cột theo
    thứ tự cố định trong JSX" sang "map qua `orderedVisible`" — đổi kiến
    trúc bắt buộc phải làm mới kéo-thả được, không có cách thêm tính năng
    này mà giữ nguyên JSX cũ):
    `RackListTable.tsx`, `DashboardClient.tsx` (TableView), `SearchClient.tsx`,
    `DeviceSearchClient.tsx`, `DevicePositionMapClient.tsx`,
    `DeviceCategoryClient.tsx`, `DeviceCircuitList.tsx`, `PortTable.tsx`.
    - `PortTable.tsx` (phức tạp nhất — nhóm port Tx/Rx rowSpan): `renderCell(key,
      {port, idx, group, circuit, transitMerged})` xử lý 3 kiểu render khác
      nhau trong cùng 1 hàm: "Sợi" luôn hiện riêng từng port (không rowSpan,
      gắn với TỪNG port vật lý chứ không phải thuộc tính của luồng); 6/8 cột
      còn lại dùng `idx===0 → rowSpan={group.ports.length}, else → null`
      (rowSpan đã che dòng dưới); riêng "Chuyển tiếp" dùng luật gộp RIÊNG
      (`transitMerged`, rowSpan=2 CHỈ khi 2 port cùng nhóm có ĐÚNG cùng nội
      dung — khác hẳn các cột kia, không rowSpan theo cả nhóm).
    - `components/odf-device/DeviceRackPortView.tsx` — CHỦ Ý KHÔNG làm: chỉ
      có 1 cột tùy chọn duy nhất ("Ghi chú"), kéo-thả 1 phần tử không có ý
      nghĩa gì để đổi thứ tự.
  - Xuất Excel KHÔNG theo thứ tự đã kéo — luôn theo đúng thứ tự cố định
    trong `COLUMN_ITEMS`/`exportColumns` (đơn giản hơn, nhất quán ở mọi
    bảng — không bảng nào trước đó làm export theo thứ tự cột trên màn
    hình, không đổi hành vi này riêng cho tính năng mới).
  - Ép kiểu `activeSortKey`/`onSort` sang đúng kiểu cột tùy chọn (thay vì
    kiểu `SortKey` rộng hơn bao gồm cả cột luôn hiện như "code"/"name") ở
    MỌI file — cần thiết để TypeScript suy luận đúng generic `K` cho
    `<DataTh>` khi dùng props rải rác qua object `common` — an toàn vì so
    sánh `===` bên trong `DataTh` không lỗi dù giá trị thật không khớp bất
    kỳ khóa nào (chỉ đơn giản không tô đậm mũi tên sắp xếp).
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch sau mỗi bảng (làm
    tuần tự, bảng dễ trước — `RackListTable.tsx` làm thử nghiệm cách trước,
    xác nhận đúng rồi mới áp dụng lặp lại cho 7 bảng còn lại). Chưa test kéo
    thả bằng chuột thật (không có công cụ trình duyệt trong môi trường này)
    — cần người dùng tự thử: kéo icon 6-chấm cạnh tên cột sang cột khác, xem
    có đổi đúng vị trí không, tải lại trang xem có nhớ đúng thứ tự đã kéo,
    bấm "Đặt lại thứ tự cột" trong dropdown Cài đặt cột xem có về đúng thứ
    tự mặc định không — thử riêng ở `PortTable.tsx` (rack có luồng ghép 2
    port liền kề) để chắc rowSpan/"Chuyển tiếp" vẫn đúng sau khi kéo cột
    khác qua lại nhiều lần.
  - **Bổ sung 2026-08-08 (cùng ngày, phản hồi người dùng)** — 2 việc:
    1. **Bỏ 2 ngoại lệ "cột không kéo-thả được"**: người dùng phản hồi "đã
       kéo thả thì kéo thả được hết chứ sao chừa lại một vài cột" — cả 2
       ngoại lệ ban đầu (Sợi/`PortTable.tsx`, Thiết bị/`DeviceCircuitList.tsx`)
       giờ kéo-thả được như mọi cột khác:
       - `PortTable.tsx`: `type ReorderableCol = VisibleCol` (bỏ
         `Exclude<..., "fiber">`), "Sợi" vào thẳng `REORDERABLE_COLUMNS`.
         `renderCell()` thêm nhánh riêng cho `key === "fiber"` (render trước
         nhánh `transit`, trước cả gate `idx!==0 → null` chung) — vẫn không
         rowSpan, đúng bản chất "thuộc tính của port" chứ không đổi. Dòng
         placeholder "đang được ghép/sửa cùng port..." (khi 1 port của cặp
         không liền kề đang có form mở ở dòng khác) đổi từ tự vẽ riêng ô Sợi
         + colSpan phần còn lại → chỉ còn tick+Port rồi colSpan HẾT phần sau
         (đơn giản hơn, vì Sợi giờ nằm chung dòng `orderedVisible` như mọi
         cột).
       - `DeviceCircuitList.tsx`: "Thiết bị" vào thẳng `VisibleCol`/
         `COLUMN_ITEMS` (đứng đầu danh sách) thay vì tách riêng. Hành vi TỰ
         ẨN khi đã lọc còn đúng 1 thiết bị (`showDeviceColumn`) **vẫn giữ
         nguyên** — không phải bỏ tính năng thông minh này, chỉ gộp cách
         kiểm tra: `effectiveVisible.device = visible.device &&
         showDeviceColumn` (2 điều kiện cùng đúng — tick người dùng ở Cài đặt
         cột, mặc định bật, VÀ bộ lọc hiện có nhiều hơn 1 thiết bị). Toàn bộ
         `orderedVisible`/`columnCount`/`exportColumns` đổi từ dùng `visible`
         trực tiếp sang `effectiveVisible` để nhất quán.
    2. **Kéo-thả NGAY TRONG dropdown Cài đặt cột (Gear)**: người dùng: "các
       cột đánh từ trái sang phải thì trong nút Gear vẫn có thể kéo thả để
       sắp xếp cột được chỉ khác là từ trên xuống dưới thì tương ứng với từ
       trái sang phải trong bảng". `ColumnPicker.tsx` thêm 2 prop mới —
       `order?: K[]` (thứ tự hiện tại, dùng `colOrder` có sẵn từ
       `useColumnOrder`) và `onReorderColumn?: (dragged, target) => void`
       (dùng thẳng `moveColumn` có sẵn — CÙNG state với header, không tạo
       state riêng) — có mặt thì render danh sách checkbox theo ĐÚNG `order`
       (không phải thứ tự khai báo tĩnh trong `items`) kèm icon kéo
       `IconGripVertical` đầu mỗi dòng, thả vào dòng khác gọi
       `onReorderColumn` y hệt cơ chế ở `DataTh.tsx`. Cả 2 optional (mặc
       định fallback về `items` order, không kéo được) để
       `DeviceRackPortView.tsx` (không dùng `useColumnOrder`, chỉ 1 cột tùy
       chọn) không cần đổi gì. Áp dụng `order`/`onReorderColumn` cho 8/9
       bảng còn lại — 2 cách kéo (ở tiêu đề cột VÀ ở dropdown Gear) dùng
       chung 1 nguồn `moveColumn`/`colOrder`, luôn đồng bộ.
    - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test kéo
      thả bằng chuột thật (không có công cụ trình duyệt) — cần người dùng tự
      thử kéo "Sợi" sang vị trí khác ở `PortTable.tsx` (rack có luồng ghép 2
      port liền kề, xác nhận rowSpan/"Chuyển tiếp" vẫn đúng), kéo "Thiết bị"
      ở `DeviceCircuitList.tsx`, và thử kéo-thả ngay trong dropdown Gear ở ít
      nhất 1-2 bảng để xác nhận thứ tự đổi đúng đồng bộ với tiêu đề cột.

- **Mục 83 (2026-08-08) — Checkbox chọn CẢ NHÓM trong `GroupedMultiSelect.tsx`.**
  Người dùng: ở khung lọc "Tuyến cáp / rack" tại `/odf-trunk`
  (`TrunkRackListPanel.tsx`, xem Mục 81) — chọn 3 rack "ODF 1/8", "ODF 1/9",
  "ODF 1/10" đều thuộc chung 1 tuyến "144FO#1 ADN1 - 2T9" đang phải tick 3
  lần, muốn có cách chọn cả tuyến 1 lần. Sửa ở đúng component DÙNG CHUNG
  `components/ui/GroupedMultiSelect.tsx` (không phải sửa riêng
  `TrunkRackListPanel.tsx`) — cùng lúc có lợi cho 2 nơi khác đang dùng chung
  component này với cách nhóm y hệt (nhóm = tuyến cáp/lĩnh vực):
  `ImportExportClient.tsx` (chọn rack/thiết bị để import/export) và
  `DeviceCircuitList.tsx` (bộ lọc lĩnh vực/thiết bị).
  - Thêm `toggleGroup(groupItems)`: đang chọn HẾT mọi item trong nhóm → bấm
    để BỎ hết; còn lại (chưa chọn hết, kể cả đang chọn 0) → bấm để CHỌN hết
    — cùng logic 2 trạng thái với "Chọn tất cả"/"Bỏ chọn" đã có, chỉ thu hẹp
    phạm vi về đúng 1 nhóm.
  - Tiêu đề mỗi nhóm đổi từ `<div>` chữ thường thành `<label>` bọc
    `<input type="checkbox">` — tick phản ánh đúng trạng thái nhóm: tick đủ
    (mọi item đã chọn), *indeterminate* (chọn dở dang — gán qua `ref`
    callback vì thuộc tính `indeterminate` không có trong JSX/HTML attribute
    chuẩn, phải set trực tiếp lên DOM element), hoặc trống (chưa chọn gì).
    Chỉ hiện checkbox nhóm khi nhóm có **>1 mục** — nhóm chỉ 1 mục thì
    checkbox riêng của mục đó đã đủ, thêm 1 checkbox nhóm nữa chỉ dư thừa/rối
    mắt (bố cục — yêu cầu người dùng "chú ý bố cục cho hợp lý").
  - Các item con thụt lề `pl-5` dưới tiêu đề nhóm để phân biệt rõ 2 cấp
    (nhóm/tuyến cáp — item/rack lẻ) bằng mắt, không chỉ dựa vào cỡ chữ.
  - Không đổi API component ra ngoài (props `items`/`selected`/`onChange`/
    `buttonLabel` giữ nguyên) — cả 3 nơi dùng tự động có tính năng mới, không
    cần sửa gì thêm ở file gọi.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test chuột
    thật — cần người dùng tự mở dropdown "Tuyến cáp / rack" ở `/odf-trunk`,
    bấm vào tên tuyến "144FO#1 ADN1 - 2T9" xem có tick/bỏ tick cả 3 rack
    cùng lúc không, tick dở dang 1/3 rack rồi mở lại xem checkbox nhóm có
    hiện đúng trạng thái *indeterminate* (dấu gạch ngang) không.

- **Mục 84 (2026-08-08) — `PortTable.tsx`: kéo-thả TOÀN BỘ cột (kể cả 4 cột
  cấu trúc) + sửa lỗi thứ tự mặc định bị lệch.** Người dùng phát hiện: vào
  `/odf-trunk/[rackId]`, thứ tự mặc định KHÔNG còn đúng như từ lúc làm
  project (tick, Port, **Sợi**, Tên luồng, Trạng thái, Giao tiếp, Chuyển
  tiếp, ..., Thao tác) — "Sợi" bị tụt xuống SAU "Tên luồng". Nguyên nhân: Mục
  82 bổ sung (bỏ ngoại lệ "Sợi", cùng ngày) gộp "Sợi" vào `orderedVisible`,
  nhưng khối đó vẫn render SAU vị trí cố định cứng của "Tên luồng" trong JSX
  — bỏ ngoại lệ nhưng JSX xung quanh vẫn còn cố định, chỉ dời được lỗi đi
  chỗ khác. Người dùng đồng thời yêu cầu thẳng: "phải cho kéo thả hết toàn
  bộ chứ" — không chỉ 8 cột tùy chọn, mà cả 4 cột trước giờ luôn cố định
  ("✓"/tick, "Port", "Tên luồng", "Thao tác").
  - Giải pháp TRIỆT ĐỂ (không vá tiếp từng trường hợp lẻ): gộp CẢ 12 cột (4
    cấu trúc + 8 tùy chọn) vào 1 kiểu `AllCol` DUY NHẤT với 1 mảng thứ tự
    mặc định tường minh `DEFAULT_ALL_ORDER` (đúng thứ tự người dùng xác nhận
    lại) — không còn bất kỳ vị trí nào cố định trong JSX nữa, `<colgroup>`/
    `<thead>`/hàng dữ liệu đều chỉ còn 1 dòng `{orderedAll.map(...)}` duy
    nhất (trước đây mỗi nơi có 2-4 chỗ JSX cố định xen giữa các đoạn map).
    - `STRUCTURAL_COLUMNS` (tick/port/name/actions) — LUÔN có mặt trong
      `orderedAll` bất kể `visible` (không có checkbox ẩn/hiện ở Gear —
      4 cột này không ẩn được, chỉ đổi VỊ TRÍ được).
    - `<ColumnPicker>` (Gear) vẫn CHỈ liệt kê 8 cột tùy chọn như cũ — lọc
      `colOrder` (kiểu `AllCol`) xuống còn `VisibleCol` trước khi truyền
      (`order={colOrder.filter(OPTIONAL_COL_SET.has)}`) vì Gear là danh sách
      "ẩn/hiện", 4 cột cấu trúc không thuộc phạm vi đó — vẫn kéo-thả được ở
      NGAY TIÊU ĐỀ CỘT của chúng (đã có `reorderKey`/`onReorderColumn` như
      mọi cột khác), chỉ không xuất hiện trong dropdown Gear.
    - `renderCell()` gộp thêm case `"tick"`/`"name"`/`"actions"` (rowSpan
      theo nhóm, y hệt logic đã có) và `"port"` (không rowSpan, luôn hiện
      riêng port — chuyển từ code cũ ở body sang, không đổi hành vi).
      "actions" cần thêm `groupKey` vào `ctx` (chuỗi id các port nối nhau,
      dùng so sánh `dangerOpenKey`) vì tên tham số cột đổi từ `key` sang
      `col` để tránh nhầm với biến `key` (hash nhóm) ở scope ngoài.
    - `DataTh.tsx` thêm prop `title?` (ghi đè tooltip mặc định) — cột "✓"
      cần tooltip riêng "Tick để sinh đoạn text báo cáo" thay vì tooltip mặc
      định (chỉ lặp lại label "✓", vô nghĩa).
    - Đổi `storageKey` thứ tự cột từ `"odf-trunk-col-order"` sang
      `"-v2"` — key cũ chỉ có 8 phần tử (không có 4 cột cấu trúc); nếu tái
      dùng, `loadOrder()` (lib/useColumnOrder.ts) sẽ đẩy 4 cột MỚI xuống
      CUỐI mảng đã lưu (SAI mặc định mong muốn, tick/Port phải đứng ĐẦU) —
      đổi key để mọi người về đúng `DEFAULT_ALL_ORDER`, chấp nhận mất tùy
      chỉnh thứ tự cũ (bảng vừa đổi kiến trúc kéo-thả 2 lần trong 1 ngày).
    - 2 dòng placeholder "đang được ghép/sửa cùng port... ở dòng khác" đơn
      giản hóa thành 1 ô `colSpan={visibleColCount}` duy nhất (trước đây tự
      vẽ riêng ô tick+Port rồi mới colSpan phần còn lại — không còn đúng khi
      Port có thể ở BẤT KỲ vị trí nào, đơn giản hóa luôn thể).
  - **Sidebar.tsx** (cùng lượt, người dùng báo trong cùng tin nhắn): tiêu đề
    "Hồ sơ kỹ thuật" bị xuống dòng ("Hồ sơ kỹ" / "thuật") vì cùng hàng với 2
    icon 🔍/ghim chiếm hết chỗ ngang trong khung `w-64`. Sửa: tách tiêu đề ra
    HÀNG RIÊNG (luôn đủ rộng, không tranh chỗ với gì), 2 icon xuống hàng dưới
    canh phải — đồng thời bỏ border/rút gọn padding 2 nút (`p-1.5`, không
    còn khung viền) để gọn hơn, còn dư chỗ cho icon khác sau này mà không
    lặp lại lỗi này.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test chuột
    thật — cần người dùng tự vào 1 rack cụ thể ở `/odf-trunk`, xác nhận thứ
    tự mặc định đúng lại (tick, Port, Sợi, Tên luồng, Trạng thái, Giao tiếp,
    Chuyển tiếp, ...), thử kéo CẢ cột "✓"/"Port"/"Tên luồng"/"Thao tác" sang
    vị trí khác xem có hoạt động đúng không (đặc biệt rowSpan khi rack có
    luồng ghép 2 port liền kề), và xác nhận Sidebar hết bị xuống dòng.

- **Mục 85 (2026-08-08) — Nhân rộng "kéo-thả TOÀN BỘ cột" (Mục 84) cho 8
  bảng còn lại + `DeviceRackPortView.tsx`.** Hỏi lại người dùng qua
  `AskUserQuestion` sau khi sửa xong `PortTable.tsx`: áp dụng luôn cho 8
  bảng còn lại hay chỉ riêng bảng vừa báo lỗi — người dùng chọn **"Áp dụng
  cho tất cả 9 bảng"** (đúng tinh thần "quy định chung" xuyên suốt phiên
  này). Cùng 1 công thức cho mọi file: gộp cột "cấu trúc" (trước giờ cố định
  đầu/cuối bảng, không qua `ColumnPicker`) vào chung 1 kiểu `AllCol` với các
  cột tùy chọn sẵn có, đổi `storageKey` của `useColumnOrder` sang `"-v2"`
  (tránh cột cấu trúc MỚI bị `loadOrder()` đẩy xuống cuối mảng đã lưu — xem
  lý do đầy đủ ở Mục 84), `<ColumnPicker>` vẫn chỉ liệt kê cột TÙY CHỌN (lọc
  `colOrder` xuống còn `VisibleCol` bằng `OPTIONAL_COL_SET`, ép kiểu
  `moveColumn as (dragged: VisibleCol, target: VisibleCol) => void`).
  - `DeviceCircuitList.tsx` (giống `PortTable.tsx` nhất — cũng có nút Thao
    tác/tick chọn hàng loạt): `StructuralCol = "tick" | "name" | "actions"`.
    Cột "tick" cần hiển thị 1 checkbox "chọn tất cả" ở HEADER (không phải chỉ
    chữ) — `DataTh.tsx` thêm prop mới `labelContent?: ReactNode` (thay THỨ
    HIỂN THỊ trong khi `label` (string, bắt buộc) vẫn giữ nguyên làm tooltip/
    định danh cột — tránh đổi `label` sang kiểu `ReactNode` sẽ phá vỡ chỗ
    dùng làm chuỗi ở `title`/"label — bấm để sắp xếp" của MỌI cột chữ khác).
  - `RackListTable.tsx`/`SearchClient.tsx`/`DeviceSearchClient.tsx`: chỉ 1
    cột cấu trúc (`"code"`/`"rack"`/`"name"` — mã rack/tên luồng, không có
    nút Thao tác riêng ở 3 bảng này). Tình cờ ở cả 3 file, `SortKey` khai báo
    sẵn ĐÃ gồm đúng cột cấu trúc + toàn bộ `VisibleCol` (vì cột đó vốn đã
    sort/filter được từ trước, chỉ chưa kéo-thả được) — `AllCol` trùng hệt
    `SortKey`, không cần ép kiểu `sortKey`/`onSort` riêng như các file khác
    (khác `PortTable.tsx`/`DeviceCircuitList.tsx`/`DeviceCategoryClient.tsx`,
    nơi cột cấu trúc mới thêm — "tick"/"actions" — KHÔNG có trong `SortKey`).
  - `DevicePositionMapClient.tsx`: `StructuralCol = "deviceName" | "actions"`
    — bảng có 2 kiểu dòng (xem-thường/đang sửa inline) nên `renderEditCell`/
    `renderViewCell` (đã tách sẵn từ đợt trước) đều phải thêm case
    `"deviceName"` (ô input tên khi sửa) và `"actions"` (nút Lưu/Hủy khi
    sửa, nút Sửa/Xóa khi xem) — không dùng `renderCell` chung 1 hàm như các
    bảng không có chế độ sửa inline.
  - `DeviceCategoryClient.tsx`: `StructuralCol = "tick" | "name"` — cùng kiểu
    checkbox "chọn tất cả" ở header cột tick như `DeviceCircuitList.tsx`
    (dùng lại `labelContent` mới thêm ở `DataTh.tsx`). Không có cột Thao
    tác riêng (Sửa/Xóa/Gộp là thanh hành động PHÍA TRÊN bảng khi có tick
    chọn, không phải nút trên từng dòng).
  - `DashboardClient.tsx` (`TableView`): `StructuralCol = "route"` — bảng
    này VỐN đã không có sort theo cột (dùng chung dropdown "sortBy" ở khung
    cha, xem comment cũ ở khai báo `VisibleCol`) nên không có `common`
    sort-related nào để ép kiểu, đơn giản nhất trong 8 file.
  - `DeviceRackPortView.tsx`: **đổi quyết định trước đó** (Mục 82 ghi "CHỦ Ý
    KHÔNG làm — chỉ 1 cột tùy chọn, kéo-thả 1 phần tử vô nghĩa"). Giờ với
    2 cột cấu trúc ("Port"/"Tên luồng") + 1 cột tùy chọn ("Ghi chú") gộp
    chung 1 thứ tự kéo-thả thì đã có ĐỦ 3 cột để đổi thứ tự có ý nghĩa —
    thêm mới hoàn toàn `useColumnOrder`/`DataTh` (trước đây dùng `<th>` viết
    tay trần, không sort/filter gì cả, giờ vẫn không sort/filter nhưng có
    `reorderKey`/`onReorderColumn` để kéo được).
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch sau mỗi file (làm
    tuần tự, không dồn). Chưa test chuột thật — cần người dùng tự thử kéo cả
    cột tick/tên/thao tác ở từng bảng trong số 8 bảng này, đặc biệt
    `DevicePositionMapClient.tsx` (xác nhận hàng đang sửa inline vẫn đúng
    cột sau khi đổi thứ tự) và `DeviceRackPortView.tsx` (tính năng kéo-thả
    hoàn toàn mới, chưa ai dùng thử).

- **Mục 86 (2026-08-09) — Xuất Excel CHI TIẾT nhiều rack ODF trung kế cùng
  lúc, ngay tại `/odf-trunk`.** Người dùng: trước đây muốn xem/xuất chi tiết
  từng port/sợi/tên luồng của 1 ODF phải bấm vào đúng mã rack đó (trang
  `/odf-trunk/[rackId]`, nút Export ở `PortTable.tsx`) — không có cách xuất
  CHI TIẾT nhiều rack cùng lúc (vd cả tuyến "144FO#1 ADN1 - 2T9" gồm 3 rack,
  hoặc chỉ chọn "ODF 1/8" + "ODF 1/10"). Phân biệt rõ với nút Export SẴN CÓ ở
  `/odf-trunk` (trong `RackListTable.tsx`) — đó là xuất bảng THỐNG KÊ (tổng
  port/đang dùng/dự phòng/trống theo từng rack), không phải chi tiết từng
  port. Hỏi lại người dùng 2 điểm trước khi làm — đã chọn: (1) **1 sheet/
  rack** (không gộp 1 sheet chung nhiều rack), (2) đặt nút xuất **ngay tại
  `/odf-trunk`**, dùng chung bộ chọn "Tuyến cáp / rack" (`GroupedMultiSelect`,
  xem Mục 83) đã có sẵn để lọc/xem — không bắt chọn lại lần 2.
  - **`lib/trunkPorts.ts`**: `TrunkPortRow.circuit` thêm 2 field
    `executionStationText`/`notes` (trước đây thiếu, chỉ có ở
    `getRackAndPorts()` riêng của trang chi tiết 1 rack) — thêm vào
    `RawCircuit`/select query/`toTrunkPortRow()` của `fetchAllOdfPorts()` —
    đủ dữ liệu để build export nhiều rack THẲNG từ 1 lượt gọi
    `fetchAllOdfPorts()` có sẵn, không cần thêm 1 query riêng theo rack IDs.
    Thêm field CHỈ mở rộng (không đổi field cũ) nên không ảnh hưởng chỗ dùng
    hiện có. Đồng thời **dời `transitDisplay()`** từ hàm riêng trong
    `PortTable.tsx` sang đây (export ra ngoài) — dùng CHUNG cho cả bảng chi
    tiết 1 rack VÀ tính năng xuất nhiều rack mới, không lặp lại logic "hiện
    tên tuyến cáp trong ô Chuyển tiếp khi trỏ thẳng ODF trơn" ở 2 nơi.
  - **`lib/exportExcel.ts`**: thêm `exportMultiSheetExcel<T>(sheets, columns,
    fileNamePrefix)` (dùng chung `ExcelColumn<T>[]` như `exportRowsToExcel`
    đã có, chỉ khác lặp `book_append_sheet()` nhiều lần thay vì 1 lần) +
    `sanitizeSheetName()` — mã rack thật LUÔN có dấu "/" (vd "ODF 1/8"), tên
    sheet Excel KHÔNG được chứa `\ / ? * [ ] :` nên phải thay bằng "-" trước
    khi đặt tên sheet (nếu không `XLSX.writeFile()` lỗi hoặc file hỏng); có
    xử lý trùng tên (đổi hậu tố `_2`, `_3`...) phòng trường hợp hiếm 2 mã
    rack khác nhau sanitize về cùng 1 tên.
  - **`components/odf-trunk/TrunkRackListPanel.tsx`**: thêm nút "Xuất chi
    tiết (n rack)" cạnh `GroupedMultiSelect` — bấm mới CHẠY (không tính sẵn
    lúc vào trang, giữ đúng tinh thần Suspense/tối ưu tải trang Mục 81/82)
    đúng 6 hàm/lượt gọi mà `app/odf-trunk/[rackId]/page.tsx` dùng để tính
    `trunkPorts`/`mirrorLinkStatuses` cho `PortTable.tsx`: `fetchAllOdfPorts`,
    `fetchDeviceCircuits`, `fetchDevices`, `findUnlinkedMirrorPairs`,
    `findUnlinkedDeviceDevicePairs`, `computeMirrorLinkStatuses` — gọi THẲNG
    từ Client Component này (không qua Server Action/Route Handler) vì các
    hàm này vốn đã nhận `SupabaseClient` làm tham số, không cố định server/
    browser (xem comment gốc ở `lib/trunkPorts.ts`, đã dùng đúng ý định thiết
    kế đó). Sau khi có `trunkPorts` (đã gồm mọi rack toàn trạm), gom theo
    `rackId` bằng 1 `Map`, lọc xuống đúng các rack đang được chọn ở
    `GroupedMultiSelect` (`effectiveRacks` — CHÍNH bộ lọc đang hiển thị bảng
    thống kê bên dưới, không phải 1 lựa chọn riêng), build 10 cột export y
    hệt `PortTable.tsx`'s `exportColumns` (Port, Sợi, Tên luồng, Trạng thái,
    Giao tiếp, Chuyển tiếp, Đối phương, PA ứng cứu, Trạm thực hiện, Ghi chú)
    cho từng rack rồi gọi `exportMultiSheetExcel`. `selectedRackIds === null`
    (chưa đụng bộ chọn) mặc định coi là "cả 41 rack" — số trong nhãn nút tự
    cập nhật theo đúng số rack sẽ xuất, không cần bấm thử mới biết.
  - Không đổi gì ở `PortTable.tsx`'s export hiện có (vẫn xuất đúng 1 rack
    đang xem, theo cột đang hiển thị/kéo-thả) — tính năng mới là BỔ SUNG,
    không thay thế.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch (`/odf-trunk` tăng
    ~5kB First Load JS do thêm logic tính mirror-link/transit — chấp nhận
    được, chỉ trang này chịu, không ảnh hưởng trang khác). Chưa test chuột
    thật — cần người dùng tự thử: chọn cả tuyến "144FO#1 ADN1 - 2T9" (tick
    nhóm ở `GroupedMultiSelect`) rồi bấm "Xuất chi tiết", mở file xác nhận
    đúng 3 sheet (1 sheet/rack, tên sheet = mã rack), cột "Trạng thái"/
    "Chuyển tiếp" đúng y hệt khi xem trực tiếp từng rack; thử xuất khi chưa
    chọn gì (mặc định cả 41 rack) xem có chạy được với dữ liệu lớn không.
  - **Cập nhật 2026-08-09**: người dùng không thích hiện chữ "Xuất chi tiết
    (n rack)" — đổi nút này thành ICON, dùng `IconFolderDown` MỚI thêm ở
    `components/ui/icons.tsx` (dáng thư mục + mũi tên xuống) thay vì
    `IconDownload` cũ (mũi tên đơn giản) — cố ý khác hình dáng để không nhầm
    với nút "Xuất Excel" (thống kê) ngay bên cạnh, vẫn dùng `IconDownload`,
    ở `RackListTable.tsx` bên dưới. Số rack đang chọn giờ hiện qua badge tròn
    góc trên-phải nút (giống badge số cột ẩn ở `ColumnPicker.tsx`, nhưng màu
    `bg-primary-600` để phân biệt màu `bg-amber-500` của badge đó) thay vì
    nằm trong chữ trên nút; tooltip (`title`) vẫn giữ đủ câu mô tả cũ.
  - **Cập nhật 2026-08-09 (tiếp)**: dời nút này xuống đứng CẠNH nút "Xuất
    Excel" (`IconDownload`) trong toolbar của bảng, thay vì tách riêng ở hàng
    trên cùng `GroupedMultiSelect`. `RackListTable.tsx` thêm prop
    `toolbarExtra?: ReactNode` (render ngay trước `ExportExcelButton`, trong
    cùng `div.ml-auto.flex.gap-2`) — component này dùng chung ở cả
    `/odf-device` (qua `DevicePositionMapClient.tsx`) nên KHÔNG tự chứa logic
    xuất-nhiều-rack, chỉ chừa 1 chỗ chèn; nơi khác không truyền prop này thì
    layout không đổi. `TrunkRackListPanel.tsx` build sẵn JSX nút rồi truyền
    qua `<RackListTable racks={effectiveRacks} toolbarExtra={exportDetailButton} />`.

- **Mục 87 (2026-08-09) — QUY ĐỊNH CHUNG: mọi dropdown "chọn nhiều mục để
  lọc hiển thị" PHẢI dùng `components/ui/GroupedMultiSelect.tsx`, không tự
  viết lại.** Người dùng phát hiện khung "Chọn tuyến hiển thị" ở Dashboard bị
  đúng 2 lỗi ĐÃ GẶP VÀ ĐÃ FIX trước đó ở `/odf-trunk` (Mục 83): (1) bấm ra
  ngoài không tự đóng — phải có nút "Đóng" riêng; (2) dropdown `z-10` bị
  header sticky của bảng bên dưới (cũng `z-10`, xem `DataTh.tsx`) đè lên khi
  cuộn. Nguyên nhân gốc: Dashboard tự viết 1 bản picker RIÊNG (không dùng
  `GroupedMultiSelect.tsx` đã có sẵn 2 chỗ khác), nên không thừa hưởng 2 lỗi
  đã fix. Lệnh rút ra (người dùng yêu cầu ghi thẳng vào đây để không lặp lại
  lần 3): **KHÔNG được tự viết dropdown chọn-nhiều-mục kiểu này ở bất kỳ bảng
  nào khác trong app — luôn import và dùng `GroupedMultiSelect.tsx`**, vốn đã
  đảm bảo: bấm ra ngoài tự đóng, dropdown `z-20` (cao hơn `z-10` của
  `DataTh.tsx` nên không bao giờ bị header bảng đè), "Chọn tất cả"/"Bỏ chọn"
  chỉ tác động đúng phần đang khớp ô tìm (không đụng lựa chọn của phần không
  hiện ra).
  - Thêm **chế độ PHẲNG** vào `GroupedMultiSelect.tsx`: trước đây bắt buộc
    phải có `group` (dùng cho rack-trong-tuyến-cáp ở `/odf-trunk`,
    thiết-bị-trong-lĩnh-vực ở `ImportExportClient.tsx`) — Dashboard không có
    cấp nhóm nào dưới tuyến cáp, truyền `group: ""` cho mọi item thì component
    tự nhận biết (`new Set(items.map(i=>i.group)).size <= 1`, tính trên TOÀN
    BỘ `items` gốc chứ không phải danh sách đã lọc theo ô tìm — để không lỡ
    đổi hành vi của 2 chỗ đang dùng nhóm thật) và ẩn hẳn phần tiêu đề
    nhóm/checkbox-cả-nhóm, chỉ còn danh sách phẳng — 2 chỗ cũ không đổi gì.
  - **Dashboard viết lại toàn bộ theo yêu cầu người dùng**: bỏ 4 tab Bảng/
    Thẻ/Cột/Tròn (mỗi tab trước đây có bộ lọc tuyến RIÊNG, lưu localStorage
    riêng từng tab) — giờ CHỈ 1 giao diện duy nhất, từ trên xuống: (1) khung
    "Chọn tuyến hiển thị" (`GroupedMultiSelect`, lọc DÙNG CHUNG, 1 key
    localStorage `dashboard-route-filter-v2`) + dropdown sắp xếp; (2) 1 thẻ
    "Tổng số port" duy nhất (bỏ 3 thẻ Đang dùng/Dự phòng/Trống — đã có đủ
    trong biểu đồ Tròn), giá trị tính trên ĐÚNG tuyến đang lọc (không còn
    `overall` cố định toàn trạm truyền từ server — bỏ hẳn `OverallStat`/
    `getDashboardData()`'s `overall` ở `app/dashboard/page.tsx`, vì chỉ cần
    `sumRoutes()` trên danh sách đã lọc phía client là đủ); (3) 2 biểu đồ
    Tròn (trái) + Cột (phải) cùng hàng khi đủ bề ngang (`grid-cols-1
    lg:grid-cols-2`), dưới `lg` tự xếp chồng dọc ĐÚNG thứ tự trong DOM (Tròn
    → Cột → Bảng, đúng yêu cầu di động); (4) Bảng — vẫn giữ nguyên bộ lọc
    riêng theo từng cột (đưa state `filters` vào HẲN bên trong `TableView`,
    không còn lift lên cha dùng chung cho 4 view như trước) + kéo-thả/ẩn-hiện/
    export cột như cũ. Dropdown sắp xếp ("Sắp theo: Tên tuyến/% Đang dùng/
    Tổng port") giờ áp dụng CHUNG cho cả biểu đồ Cột và Bảng (1 biến `sorted`
    duy nhất truyền cho cả 2, xem yêu cầu "thêm sắp xếp cho biểu đồ Cột tương
    tự như Bảng") — Tròn không cần vì chỉ là 1 số tổng, không có thứ tự.
    Bỏ hẳn `StatFilterBar` (thanh lọc nhanh dùng chung cho Thẻ/Cột/Tròn cũ) —
    đây chính là nguồn gây lẫn lộn "chọn tuyến hiển thị" + "lọc nhanh" là 2 bộ
    lọc riêng biệt khiến "Chọn tất cả" ở khung chọn tuyến có thể vô tình bỏ
    qua bộ lọc nhanh đang gõ dở (đúng hiện tượng người dùng mô tả "vừa lọc
    vừa không lọc") — xoá bộ lọc thừa này khiến lớp lẫn lộn đó biến mất hẳn,
    không cần vá riêng logic "Chọn tất cả".
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test chuột
    thật — cần người dùng tự thử: mở `/dashboard`, bấm "Chọn tuyến hiển thị",
    thử bấm ra ngoài (phải tự đóng), gõ tìm rồi bấm "Bỏ chọn"/"Chọn tất cả"
    (chỉ ảnh hưởng đúng phần đang lọc), cuộn bảng xuống rồi mở lại dropdown
    xem có còn bị header bảng đè không; thu nhỏ cửa sổ trình duyệt xem 2 biểu
    đồ có xếp chồng đúng thứ tự Tròn→Cột trên di động không.

- **Mục 88 (2026-08-09) — QUY ĐỊNH CHUNG: mọi bảng dữ liệu PHẢI sắp xếp
  tăng/giảm bằng cách BẤM VÀO CHỮ TIÊU ĐỀ cột (không phải dropdown rời).**
  Người dùng chỉ ra: quy tắc "bấm tiêu đề cột để sắp xếp tăng/giảm" đã là
  hành vi CHUẨN của 8/9 bảng từ trước (`lib/useSort.ts` + `DataTh`'s
  `sortKey`/`activeSortKey`/`sortDir`/`onSort`) nhưng Mục 80 ("Quy định
  chung cho MỌI bảng dữ liệu") lại CHƯA ghi rõ điều này thành 1 dòng quy định
  — khiến khi viết lại `DashboardClient.tsx` (Mục 87) dễ lặp lại thiếu sót
  (`TableView` khi đó chỉ có lọc/kéo dãn/kéo-thả cột qua `DataTh`, PHẦN SẮP
  XẾP lại tách thành 1 dropdown "Sắp theo" riêng ở khung cha — không đúng
  chuẩn). Ghi thành quy định chính thức: **`TableView`/bảng nào có cột sắp
  xếp được thì PHẢI dùng `lib/useSort.ts` + truyền đủ
  `sortKey`/`activeSortKey`/`sortDir`/`onSort` vào `DataTh` của đúng cột đó —
  không dùng `<select>` sắp xếp rời khi bảng đã có sẵn cột tương ứng** (cột
  không có dữ liệu để sắp — vd cột "Tỷ lệ" chỉ vẽ thanh biểu đồ — thì để
  `sortKey` trống, vẫn đúng chuẩn).
  - `DashboardClient.tsx`'s `TableView` sửa lại: bỏ hẳn dropdown "Sắp theo"
    ở khung cha, thêm `useSort<SortKey>("route")` (mặc định "Tuyến cáp" tăng
    dần, đúng "mặc định theo tên tuyến" người dùng nêu) ngay trong
    `TableView`, wire `sortKey`/`activeSortKey`/`sortDir`/`onSort` cho cả 5
    cột Tuyến cáp/Tổng port/Đang dùng/Dự phòng/**Trống** (cột "Trống" trước
    đây không sort được — đúng luôn yêu cầu "cho phép sắp xếp theo port
    trống nữa" cho phần Bảng). `SortKey` ("route"|"total"|"inUse"|"standby"|
    "empty") tách khỏi `AllCol` (thiếu "ratio" — cột không sort được) — ép
    kiểu `sortKey as AllCol`/`onSort as (k: AllCol) => void` khi gộp chung
    `sortProps` cho nhiều case, giống pattern đã dùng ở `PortTable.tsx` (cột
    "actions"/"tick" cũng không nằm trong `SortKey` của file đó).
  - **Biểu đồ Tròn + Cột: bấm vào chú thích (legend) HOẶC bấm thẳng vào phần
    hiển thị (lát cắt Tròn/cột màu của Cột) để ẩn/hiện từng phần** (yêu cầu
    người dùng 2026-08-09) — legend có gạch ngang chữ khi đang ẩn. Tròn và
    Cột giữ trạng thái ẩn RIÊNG (không dùng chung — ẩn "Trống" ở Tròn không
    ảnh hưởng Cột). Cách làm (áp dụng được cho MỌI biểu đồ Tròn/Cột xếp chồng
    sau này trong app, nên ghi thành mẫu dùng lại):
    - `<Legend>` PHẢI truyền `payload` CỐ ĐỊNH (mảng 3 mục dựng tay từ
      `STAT_KEYS`/`STAT_LABELS`, không để Recharts tự suy từ `data`/`<Bar>`
      đang render) — vì `<Bar hide>` hay lọc bớt mảng `data` của `<Pie>` làm
      Recharts tự xoá LUÔN mục đó khỏi legend tự sinh, không còn cách nào
      bấm lại để hiện — đây là lỗi CHẮC CHẮN gặp nếu làm theo bản năng (chỉ
      lọc `data`/gắn `hide` mà không tự truyền `payload`).
    - Cột (`<BarChart>`): mỗi `<Bar dataKey>` thêm `hide={hidden.has(key)}`
      (prop có sẵn của Recharts 2.x, giữ nguyên component mounted — không
      giật hình khi ẩn/hiện) + `onClick={() => toggle(key)}` + `cursor=
      "pointer"`.
    - Tròn (`<PieChart>`): LỌC BỚT mảng `data` truyền cho `<Pie>` (Pie không
      có `hide` per-slice, phải bỏ hẳn phần tử khỏi mảng — phần còn lại tự
      giãn theo đúng tỷ lệ, đúng hành vi "ẩn 1 phần, phần khác giãn ra") —
      mỗi `<Cell>` thêm `onClick={() => toggle(key)}` + `cursor="pointer"`.
    - `Legend`'s `onClick`/`formatter` đọc `entry.dataKey` (đã gán cứng
      trong `payload` ở trên) để biết bấm vào mục nào — `formatter` trả về
      `<span style={{textDecoration: hidden ? "line-through" : "none"}}>`.
  - **Biểu đồ Cột: thêm 4 icon sắp xếp RIÊNG, nằm NGAY TRONG khung của biểu
    đồ này** (yêu cầu người dùng: "dùng icon không dùng chữ nhìn rối") — độc
    lập với sắp xếp của Bảng (Bảng dùng bấm tiêu đề cột như quy định chung ở
    trên; Tròn không cần vì chỉ có 1 số tổng, không có thứ tự). 4 tiêu chí:
    Tên tuyến / Tổng sợi-port / % Đang dùng / % Trống (thêm mới, trước đây
    chưa có) — MỖI tiêu chí có chiều tăng/giảm riêng: bấm icon đang chọn để
    đảo chiều (▲/▼ hiện ở badge góc icon), bấm icon khác để chuyển tiêu chí
    (về chiều mặc định riêng từng tiêu chí — tên: tăng dần, 3 tiêu chí còn
    lại: giảm dần "nhiều nhất trước"). 4 icon mới ở `components/ui/icons.tsx`
    — cố ý khác hẳn hình dáng nhau để không nhầm, KHÔNG dùng thư viện icon
    ngoài (đúng tinh thần chung): `IconSortName` (chữ "A" trên/"Z" dưới +
    mũi tên — sắp theo tên), `IconSortTotal` (dấu # — sắp theo tổng số),
    `IconSortPercentUsed` (vòng tròn ĐẶC — % đang dùng), `IconSortPercentEmpty`
    (vòng tròn RỖNG — % trống, cố ý đối xứng đặc/rỗng với icon trước để dễ
    liên tưởng đang dùng/trống).
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test chuột
    thật — cần người dùng tự thử ở `/dashboard`: bấm chữ tiêu đề từng cột ở
    Bảng (kể cả cột "Trống") xem có sắp xếp + đảo chiều đúng không; ở biểu đồ
    Tròn/Cột bấm vào chú thích VÀ bấm thẳng vào lát cắt/cột màu xem có ẩn/
    hiện đúng phần đó không (gạch ngang chữ chú thích khi ẩn); bấm 4 icon sắp
    xếp trong khung biểu đồ Cột xem đổi đúng thứ tự cột theo từng tiêu chí và
    đảo chiều khi bấm lại icon đang chọn.

- **Mục 89 (2026-08-09/10) — Sidebar: tiêu đề+icon về 1 hàng; Hồ sơ đấu nối:
  mặc định vẫn hiện luồng vừa cập nhật dù chưa lọc; bỏ 2 link thừa ở "Hồ sơ
  ODF Thiết bị".**
  - **`components/Sidebar.tsx`** (2026-08-09, chưa kịp ghi khi commit —
    ghi bù đợt này): tiêu đề "Hồ sơ kỹ thuật" + 2 icon (tìm kiếm/ghim) trước
    đó tách 2 tầng (tiêu đề riêng 1 hàng, icon hàng dưới canh phải — sửa ở
    đợt trước để tránh tiêu đề bị ngắt dòng giữa chừng) khiến 2 khối nhìn
    lệch/rời nhau ("chênh nhau"). Gộp lại 1 hàng, `flex items-center
    justify-between` (canh giữa theo chiều dọc) — để không tái lặp lỗi ngắt
    dòng cũ: giảm cỡ chữ tiêu đề `text-xl` → `text-lg`, bỏ `tracking-wide`,
    giảm padding ngang `px-5` → `px-4` (chỉ ở hàng tiêu đề này) — đủ chỗ cho
    cả tiêu đề (`whitespace-nowrap`, không tự ngắt dòng) và 2 icon trên cùng
    1 hàng ở bề rộng sidebar cố định 256px (`w-64`).
  - **`components/odf-device/DeviceCircuitList.tsx` (trang "Hồ sơ đấu nối")
    — mặc định vẫn hiện luồng vừa cập nhật hôm qua/hôm nay dù CHƯA chọn lĩnh
    vực/thiết bị** (yêu cầu người dùng 2026-08-10: "sẽ rất bất tiện nếu
    trong ngày hôm đó có cập nhật luồng mà lại không hiển thị, mỗi lần phải
    tìm thiết bị rồi gõ tọa độ mới ra"). Trước đây (Mục 80) trang này mặc
    định TRỐNG HẲN tới khi chọn lĩnh vực/thiết bị hoặc bấm "Xem tất cả" (để
    khỏi render 2000+ dòng ngay lúc mở tab) — giờ khi CHƯA chọn gì, tự thu
    hẹp về đúng tập luồng có `updated_at` rơi vào hôm qua hoặc hôm nay (thêm
    `isUpdatedYesterday()` ở `lib/format.ts`, cùng cách so ngày với
    `isUpdatedToday()` đã có) — vẫn RẺ vì thường chỉ vài dòng đổi trong 2
    ngày, không phải render lại toàn bộ. Cách làm: nhánh `else if (!viewAll)`
    mới trong `filtered` (lọc theo `updatedRecentIds`, ĐẶT TRƯỚC các bước
    lọc/sắp xếp khác nên vẫn tương thích với mọi bộ lọc cột/checkbox "Chỉ
    hiện luồng sửa hôm nay" đã có); `EmptyUntilFiltered`'s `active` đổi thành
    `scopeChosen || updatedRecentIds.size > 0` (chỉ thật sự trống khi vừa
    chưa lọc VỪA không có gì đổi gần đây); thêm banner vàng nhỏ phía trên
    bảng khi đang ở chế độ ngầm định này, nói rõ "đang hiện N luồng vừa cập
    nhật hôm qua/hôm nay" + link "Xem tất cả" để không hiểu lầm là mất dữ
    liệu khi tìm 1 luồng cũ hơn không thấy.
  - **`app/odf-device/page.tsx`** — bỏ 2 link "→ Thêm / sửa / xóa luồng
    thiết bị" và "→ Thư viện vị trí gợi ý" dưới tiêu đề trang (yêu cầu người
    dùng: cả 2 trang đích đã có sẵn trong Sidebar — "Hồ sơ đấu nối" và "Thư
    viện vị trí thiết bị" — giữ lại chỉ trùng lặp, không cần thiết). Bỏ luôn
    import `Link` (không còn dùng ở file này).
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test bằng
    mắt/chuột thật — cần người dùng tự thử: mở Sidebar xem tiêu đề+icon có
    thẳng hàng, tiêu đề không bị ngắt dòng; mở "/odf-device/sua-luong" lúc
    CHƯA chọn lĩnh vực/thiết bị gì, xác nhận vẫn thấy đúng các luồng vừa sửa
    hôm qua/hôm nay (nếu có sửa gì trong 2 ngày đó) kèm banner giải thích;
    vào "/odf-device" xác nhận không còn 2 link thừa dưới tiêu đề.

- **Mục 90 (2026-08-10) — QUY ĐỊNH CHUNG: mọi bảng có icon "Làm mới dữ liệu"
  (`RefreshButton.tsx`), KHÔNG polling định kỳ.** Người dùng phát hiện: dữ
  liệu mỗi trang chỉ tải 1 LẦN lúc vào trang (Server Component, `force-
  dynamic` nhưng chỉ chạy lại khi có điều hướng/tải trang mới) — nếu mở 2 tab
  trình duyệt, sửa dữ liệu (vd thêm thiết bị mới, thêm dòng thư viện vị trí
  thiết bị) ở tab B thì tab A KHÔNG tự biết, phải bấm F5 tải lại NGUYÊN trang
  mới thấy — mất luôn form đang gõ dở/dòng đang Sửa ở tab A nếu có. Yêu cầu:
  có cách làm mới KHÔNG cần tải lại cả trang, KHÔNG polling định kỳ (chỉ chạy
  khi người dùng chủ động bấm), và quan trọng nhất — khi đang mở form "Thêm
  luồng mới"/"Sửa" thì làm mới cũng phải cập nhật được dữ liệu tham chiếu
  dùng để gợi ý trong form đó (danh sách thiết bị, thư viện vị trí, port
  trung kế...) mà KHÔNG xóa mất các ô đang gõ dở.
  - **Cơ chế**: `router.refresh()` (Next.js App Router, `next/navigation`) —
    chạy lại (các) Server Component của route hiện tại, lấy props MỚI cho
    toàn bộ cây, nhưng KHÔNG remount Client Component nào ở vị trí không đổi
    trong cây → state nội bộ (`useState` — form đang gõ dở, dòng đang Sửa,
    tick đã chọn, bộ lọc cột, sắp xếp...) giữ nguyên 100%, chỉ CÁC PROP (
    `circuits`/`devices`/`devicePositionMap`/`trunkPorts`/`racks`...) được
    thay bằng bản mới nhất từ CSDL. Đây CHÍNH LÀ cơ chế mọi form Thêm/Sửa/Xóa
    trong app đã dùng từ trước SAU KHI lưu thành công (xem `DeviceCircuitList
    .tsx`, `PortTable.tsx`...) — đã chứng minh KHÔNG làm mất state khác (bộ
    lọc/tick/sắp xếp không hề bị reset sau mỗi lần lưu) qua suốt quá trình
    dùng thật — giờ chỉ thêm 1 nút bấm TAY để gọi lại đúng cơ chế đó bất kỳ
    lúc nào, kể cả khi đang mở form Thêm/Sửa (form đó nằm CHUNG 1 component
    với bảng, dùng CHUNG props `devices`/`devicePositionMap`/`trunkPorts` nên
    tự động ăn theo, không cần thêm gì riêng cho form).
  - **`components/ui/RefreshButton.tsx`** (mới) — nút icon dùng chung, gói
    `useRouter().refresh()` trong `useTransition()` để có `isPending` (xoay
    icon `animate-spin` + disable nút khi đang tải, đỡ bấm lặp).
  - **`components/ui/icons.tsx`** — thêm `IconRefresh` (2 mũi tên cong vòng
    tròn, quy ước phổ biến cho "refresh").
  - Áp dụng cho ĐỦ CẢ 9 bảng dữ liệu (đúng tinh thần "quy định chung" xuyên
    suốt các đợt trước — Mục 80/82/85): `PortTable.tsx`, `DeviceCircuitList
    .tsx`, `RackListTable.tsx` (dùng chung ở `/odf-trunk` VÀ `/odf-device`),
    `DeviceCategoryClient.tsx`, `SearchClient.tsx`, `DeviceSearchClient.tsx`,
    `DevicePositionMapClient.tsx`, `DeviceRackPortView.tsx`,
    `DashboardClient.tsx` — đặt ngay trong toolbar mỗi bảng, cạnh nút "Xuất
    Excel"/icon Gear đã có.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test bằng tay
    thật (cần 2 tab trình duyệt) — cần người dùng tự thử: mở 2 tab
    "/odf-device/sua-luong", mở form "Thêm luồng mới" ở tab A (gõ dở vài ô,
    ĐỪNG lưu), thêm 1 thiết bị mới ở tab B (`/devices`), quay lại tab A bấm
    icon Làm mới — xác nhận ô "Thiết bị (tiếp theo)" gợi ý được tên thiết bị
    mới đó, ĐỒNG THỜI các ô đã gõ dở ở form Thêm vẫn còn nguyên (không bị xóa
    trắng).

- **Mục 91 (2026-08-10) — "Thư viện vị trí thiết bị": chặn lưu vị trí ODF/DDF
  không có thật, chặn xung đột 1-Trib-nhiều-ODF, highlight tên thiết bị chưa
  khớp Danh mục.** Người dùng phát hiện (sau ca thêm rack "ODF 11/3" thiếu ở
  Mục trước): trang `/odf-device/vi-tri-thiet-bi` cho lưu Vị trí ODF/DDF
  KHÔNG có thật (rack chưa tồn tại trong CSDL) — khác nguyên tắc "cho lưu
  text-only trước, chuẩn hóa sau" (CLAUDE.md #3) áp dụng cho Ô "Vị trí ODF
  (tiếp theo)" bên `DeviceCircuitList.tsx`: đó là dữ liệu VẬN HÀNH thật (luôn
  cho lưu, không được chặn), còn THƯ VIỆN này chỉ là GỢI Ý tự điền — gợi ý
  trỏ tới rack không tồn tại không có giá trị gì, nên CHẶN HẲN thay vì cho
  lưu rồi chuẩn hóa sau. Cả 3 việc đều sửa trong `validateLibraryDraft()`
  (`components/odf-device/DevicePositionMapClient.tsx`, dùng CHUNG cho cả
  "Thêm dòng mới" lẫn Sửa inline — không cần sửa 2 nơi):
  1. **Vị trí ODF/DDF phải khớp rack CÓ THẬT** — khi text "có vẻ là tọa độ
     thật" (`looksLikeRealPositionText()`, loại trừ "Kết nối trực tiếp"),
     bắt buộc `matchTrunkPosition(odfPosition, trunkPorts).matched === true`
     (áp dụng CHUNG cho cả rack `domain='device'` lẫn `domain='trunk'`, đúng
     cách `matchTrunkPosition` đã đối xử 2 domain như nhau ở mọi nơi khác
     trong app) VÀ số port phải tồn tại trong rack đó (`invalidPortNumbers`
     rỗng) — không khớp thì báo lỗi rõ, hướng dẫn vào `/odf-device` (hoặc
     `/odf-trunk` nếu là tuyến cáp) thêm rack đó trước (mã rack/loại ODF/số
     port) rồi mới quay lại nhập.
  2. **Thêm chiều ràng buộc MỚI: cùng thiết bị + cùng Trib chỉ được ứng với
     ĐÚNG 1 Vị trí ODF/DDF** (yêu cầu người dùng: "Cùng tên thiết bị, cùng vị
     trí thiết bị thì chỉ có một vị trí ODF/DDF thôi" — dùng tên thiết bị
     ĐÃ CHUẨN HÓA qua `normalizeDeviceNameKey()`, tự bỏ qua khác biệt kiểu "X"
     vs "ADN1.X" theo đúng ý người dùng "tạm coi là 1 thiết bị"). Bổ sung
     BÊN CẠNH rule ngược chiều đã có từ Mục "2026-08-03" (cùng thiết bị,
     KHÁC Trib thì không được CHUNG 1 Vị trí ODF/DDF thật) — 2 rule đối xứng,
     đều chặn ở `validateLibraryDraft()`. Khác 1 điểm: rule MỚI này KHÔNG
     loại trừ "Kết nối trực tiếp" (rule cũ loại trừ vì nhiều Trib hợp lệ dùng
     chung giá trị không-phải-tọa-độ đó; rule mới thì 1 Trib vật lý không
     thể vừa "nối trực tiếp" vừa "ra ODF X" cùng lúc, nên so sánh text KHÔNG
     GATE qua `looksLikeRealPositionText`).
  3. **Highlight NGAY TẠI DÒNG khi tên thiết bị chưa khớp Danh mục thiết bị**
     (yêu cầu người dùng — bổ sung, KHÔNG thay thế, khung tổng hợp "Chuẩn hóa
     tên thiết bị chưa khớp" đã có sẵn từ trước — khung đó chỉ gộp nhóm, dòng
     đang cuộn/lọc trong bảng chính không thấy ngay được): `<tr>` tô nền
     `bg-amber-50` + badge nhỏ "chưa khớp Danh mục" cạnh tên thiết bị (có
     `title` giải thích hướng xử lý: thêm thiết bị đó vào `/devices` nếu còn
     tồn tại, hoặc xóa dòng thư viện nếu không còn dùng nữa) — so khớp qua
     `existingDeviceKeys` (Set các `normalizeDeviceNameKey(devices[].name)`,
     đã có sẵn trong file, tái dùng chứ không tính lại).
  - **Phạm vi CHỈ áp dụng cho form Thêm/Sửa TAY ở trang này** — các đường ghi
    khác vào `device_position_map` (vd `growDevicePositionMapByTrib()` gọi từ
    `DeviceCircuitList.tsx` khi tự làm giàu thư viện lúc lưu luồng thiết bị)
    KHÔNG đi qua `validateLibraryDraft()`, giữ nguyên hành vi khoan dung cũ —
    đúng tinh thần "chỉ chặn ở nơi NGƯỜI DÙNG chủ động gõ tay vào thư viện",
    không chặn luôn cả đường tự động phụ trợ (sẽ dễ làm KẸT việc lưu luồng
    chính chỉ vì 1 bước phụ thất bại).
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test bằng tay
    thật — cần người dùng tự thử: ở `/odf-device/vi-tri-thiet-bi`, thử Thêm 1
    dòng với Vị trí ODF/DDF trỏ tới rack CHƯA tồn tại (phải bị chặn, báo lỗi
    rõ); thử Thêm 1 dòng trùng thiết bị+Trib với 1 dòng đã có nhưng Vị trí
    ODF/DDF khác đi (phải bị chặn); cuộn bảng chính xem các dòng có tên thiết
    bị lạ (chưa có trong `/devices`) có tô vàng + badge "chưa khớp Danh mục"
    hay không.

- **Mục 92 (2026-08-17) — Tắt Router Cache client toàn app; Thư viện vị trí
  thiết bị: xem hết dữ liệu, lọc theo khung Thêm, cảnh báo luồng liên đới;
  Hồ sơ đấu nối: tự điền Thiết bị/Trib khi gõ ODF đã có trong thư viện.**
  Người dùng dùng thử thực tế báo 2 nhóm bất cập.

  **A. QUY ĐỊNH CHUNG MỚI: `next.config.mjs` → `experimental.staleTimes.dynamic
  = 0`.** Nguyên nhân gốc của "sửa xong ở trang này, chuyển tab Sidebar sang
  trang khác vẫn thấy dữ liệu cũ" (khác hẳn case đa-tab/đa-trình-duyệt đã vá
  bằng `RefreshButton` ở Mục 90): Next.js 14 giữ RSC payload đã tải trong
  **Router Cache PHÍA CLIENT** ~30 giây cho MỌI điều hướng qua `<Link>`/
  `router.push`, BẤT KỂ trang đã khai báo `dynamic = "force-dynamic"` ở server
  hay chưa — cờ đó chỉ tắt cache phía server, không tắt cache điều hướng phía
  client. Toàn bộ trang trong app đều là dữ liệu Supabase sống, không trang
  nào cần cache điều hướng — `staleTimes.dynamic = 0` áp dụng TOÀN CỤC, không
  cần sửa từng trang, không ảnh hưởng `router.refresh()`/`RefreshButton` (vẫn
  hoạt động như cũ, chỉ thêm: giờ chuyển trang cũng tự động mới).

  **B. `DeviceCircuitList.tsx` (Hồ sơ đấu nối) — tự điền Thiết bị/Trib (tiếp
  theo) khi gõ ODF đã có trong thư viện.** Lỗi thật: `findLibraryMatchByOdf
  (deviceName, odfValue)` đòi biết trước `deviceName`, nhưng lúc gõ Ô1 "Vị trí
  ODF (tiếp theo)" thì Ô2 "Thiết bị (tiếp theo)" CÒN RỖNG — hàm luôn trả
  `null`, không bao giờ tự điền được theo chiều "gõ ODF trước, để hệ thống
  suy ra thiết bị". Thêm hàm `findLibraryMatchByOdfAny(odfValue)` — quét
  TOÀN BỘ `devicePositionMap` (không lọc theo thiết bị) khớp `odfPosition`.
  `onChange` của Ô1 (nhánh không khớp rack trung kế): ưu tiên 1 vẫn
  `findLibraryMatchByOdf` khi đã biết thiết bị (giữ hành vi cũ); nếu chưa có
  kết quả VÀ Ô2 đang rỗng → fallback `findLibraryMatchByOdfAny`, tự điền CẢ
  Ô2 lẫn Ô3. Không đè khi Ô2 đã có chữ khác (tôn trọng đang gõ tay).

  **C. `DevicePositionMapClient.tsx` (Thư viện vị trí thiết bị).**
  1. **Bỏ ẩn mặc định** — gỡ `EmptyUntilFiltered`/`viewAll`/`scopeChosen`
     (thêm ở Mục 90 để tăng tốc, nhưng thư viện chỉ vài trăm dòng, không nặng
     như `circuits`) — bảng luôn hiện; chip "Lĩnh vực" vẫn là bộ lọc thủ công,
     không còn là điều kiện để HIỆN bảng.
  2. **Lọc bảng dưới theo khung "Thêm dòng mới"** (yêu cầu người dùng: gõ
     Thiết bị+Trib để biết đã có chưa, gõ thêm ODF thì bảng dưới hiện THÊM —
     OR, không thay thế — bất kỳ dòng nào dù thiết bị/trib khác đang trùng
     đúng ODF đó, để phát hiện port đã bị thiết bị khác chiếm trước khi lưu
     nhầm). Hàm thuần `matchesDraftPreview(r, draft)`: `identityMatch` (khớp
     Thiết bị VÀ Trib, chỉ tính phần đã gõ) OR `odfMatch` (khớp ODF) — áp
     dụng thêm (AND) vào `filtered` khi `draftPreviewActive(draft)`.
  3. **Không có gì reset khung "Thêm dòng mới" khi Sửa/Xóa dòng khác** — đã
     rà lại `openEdit`/`saveEdit`/`deleteRow`: không hàm nào đụng `setDraft`,
     `router.refresh()` không remount Client Component nên `draft` không mất
     (đúng cơ chế `RefreshButton` đã dùng ở Mục 90). Không có gì để sửa —
     nếu người dùng vẫn tái hiện được sau đợt này, cần bước lặp lại cụ thể để
     tìm nguyên nhân khác.
  4. **Banner xác nhận Thêm/Sửa/Xóa + highlight dòng vừa lưu** — gộp
     `addHiddenNotice` (chỉ có cho ca "Thêm xong nhưng bị lọc ẩn") thành
     `saveNotice: string | null` dùng chung 3 thao tác (banner xanh lá emerald,
     nút "Bỏ lọc để xem" chỉ hiện khi có bộ lọc/draft đang thu hẹp bảng).
     `highlightId` (id dòng vừa Thêm/Sửa, không áp dụng Xóa) — `useEffect`
     đợi `rows` (prop mới sau `router.refresh()`) THẬT SỰ chứa id đó rồi mới
     `scrollIntoView({block:"center"})` + tô `bg-green-100 ring-2 ring-green-400`
     ~3 giây (dòng `<tr>` gắn `id={`dpm-row-${r.id}`}`) rồi tự tắt.

  **D. Cảnh báo luồng thiết bị (`circuits`) đang phụ thuộc dòng thư viện sắp
  Sửa/Xóa** (yêu cầu người dùng: "thư viện xóa mà luồng vẫn còn thì ko logic"
  — thư viện chỉ là GỢI Ý được "làm giàu" TỪ `circuits` qua
  `growDevicePositionMapByTrib()`/`maybeGrowLibrary()`, không phải nguồn sự
  thật, nên xóa/sửa nó không được tự động xóa luồng thật, nhưng PHẢI báo).
  - `findCircuitsUsingLibraryRow(client, {deviceName, devicePosition,
    odfPosition})` (`lib/devicePositionMap.ts`, mới) — bỏ qua nếu
    `!looksLikeRealPositionText(odfPosition)` ("Kết nối trực tiếp" dùng chung
    nhiều Trib, không phải 1 vị trí duy nhất để đối chiếu). Quét phân trang
    `circuits` (cột nhẹ: `id, name, trib_text, device_position_own,
    device_position_next, devices(name)`), khớp 2 chiều qua
    `normalizeDeviceNameKey`/`normalizeDevicePositionKey`: **"own"** — chính
    luồng của đúng thiết bị+Trib này đang dùng đúng ODF này; **"next"** —
    luồng của THIẾT BỊ KHÁC có `device_position_next` (tách qua
    `splitOdfDeviceStructure`, lấy `odfPart`) trỏ đúng tới ODF này.
  - UI (`DevicePositionMapClient.tsx`): gọi hàm trên NGAY TRƯỚC khi thực thi
    Sửa (chỉ khi định danh dòng — thiết bị/Trib/ODF — thật sự đổi so với
    dòng gốc, tránh làm phiền khi chỉ sửa lỗi chính tả không đổi định danh)
    hoặc Xóa. Rỗng → thực hiện thẳng như cũ (Xóa vẫn giữ `confirm()` gọn cũ
    khi không liên quan gì). Có kết quả → panel `renderRelatedCircuitsPanel`
    (nền đỏ nhạt) liệt kê tên luồng + chiều own/next + thiết bị/Trib, checkbox
    từng dòng (mặc định KHÔNG tick), 3 nút: "Sửa/Xóa thư viện + xóa luồng đã
    tick", "Chỉ Sửa/Xóa thư viện, giữ nguyên luồng", "Hủy". Xóa luồng đã tick
    tái dùng ĐÚNG quy trình an toàn của `DeviceCircuitList.tsx`
    (`findMirrorTrunkCircuits` TRƯỚC khi xóa + `cleanupAfterMirrorCascade`
    SAU khi xóa, từ `lib/mirrorTrunkCircuits.ts`) — không để sót mirror trung
    kế mồ côi.

  **E. Chuẩn hóa tiền tố "ADN1." cho thiết bị trong thư viện** — kiểm tra qua
  script tạm `scripts/tmp-add-adn1-prefix.ts` (chạy xong đã xóa): quét toàn
  bộ 137 dòng `devices`, **0 dòng thiếu tiền tố "ADN1."** — bảng `devices` đã
  chuẩn hóa đầy đủ từ trước (khác nhận định ban đầu của người dùng). Vì
  `validateLibraryDraft()` bắt buộc `device_position_map.device_name` khớp
  ĐÚNG `devices.name` (Mục 91), mọi dòng thư viện lưu qua form từ 2026-08-03
  trở đi đã tự động có tiền tố đúng. Phần "có chỗ là X có chỗ là ADN1.X"
  người dùng thấy chỉ còn tồn tại ở các dòng `device_position_map` CŨ chưa
  khớp thiết bị thật nào (`unmatchedGroups`) — nhóm này CỐ Ý không tự động
  sửa (không biết chắc đó là thiết bị nào), để nguyên cho khung "Chuẩn hóa
  tên thiết bị chưa khớp"/highlight amber (Mục 91) xử lý thủ công.

  - File sửa: `next.config.mjs`, `components/odf-device/DeviceCircuitList.tsx`,
    `components/odf-device/DevicePositionMapClient.tsx`, `lib/devicePositionMap.ts`.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Chưa test bằng tay
    thật (không có trình duyệt tự động ở môi trường này) — cần người dùng tự
    thử: (a) sửa 1 dòng thư viện, chuyển tab Sidebar sang Hồ sơ đấu nối, xác
    nhận dữ liệu mới có ngay không cần bấm Refresh; (b) gõ ODF đã có trong
    thư viện vào "Vị trí ODF (tiếp theo)" ở Hồ sơ đấu nối, xác nhận Thiết
    bị/Trib tự điền; (c) vào thư viện xác nhận bảng hiện đủ dữ liệu ngay từ
    đầu, không cần chọn Lĩnh vực trước; (d) gõ thử Thiết bị+Trib rồi thêm ODF
    trùng 1 dòng khác, xác nhận bảng dưới hiện cả 2 nhóm; (e) Sửa/Xóa 1 dòng
    thư viện đang có luồng thật liên quan, xác nhận panel cảnh báo hiện đúng
    luồng, thử cả 3 lựa chọn.

- **Mục 93 (2026-08-17) — Mirror thiết bị-thiết bị: báo rõ khi Trib đích đã bị
  luồng KHÁC (không cùng tên) chiếm, hỏi xóa+tạo lại thay vì âm thầm bỏ qua.**
  Phát hiện qua ca thật: luồng "100GE ADN1.P2 (18/1/8) - QTI.PE2 (10/1/2)"
  (thiết bị P2) đã có mirror đúng bên "ADN1.PSS24X#1 RMT3 (S2-25)" (liên kết
  qua `mirror_of_id`, tick xanh) — người dùng vô tình NHẬP TRÙNG lần 2 gần
  giống hệt ("100 ADN1.P2 (18/1/8)...", thiếu "GE" ở interface) trỏ tới ĐÚNG
  cùng Trib "S2-25" đó. Vì `findMissingDeviceMirrors()` (`lib/deviceDeviceSync.ts`)
  chỉ sinh `gaps` (đích còn trống) hoặc `mismatches` (đích có luồng CÙNG TÊN
  nhưng Trib lệch) — ca "đích đã có Trib đó nhưng do 1 luồng KHÁC TÊN chiếm"
  bị bỏ qua hoàn toàn ở dòng `if (targetOwnTribs.has(targetTribKey)) continue`
  (trước khi kịp xét tên) — `autoCreateMirrorForCircuit()` trả về "no-gap",
  `autoMirrorAfterSave()` (`DeviceCircuitList.tsx`) không báo gì, luồng vừa
  lưu (đã lưu thành công, dữ liệu không mất) đơn giản là mãi không liên kết
  được, không rõ lý do — đúng câu hỏi người dùng đặt ra.

  Yêu cầu người dùng: "từ đây trở về sau ... đưa ra thông báo cụ thể ... phải
  xóa luồng ở đầu kia mới tạo mới bên này, vẫn giữ nguyên các nhập liệu mới
  nhập ... đừng refresh dữ liệu tôi mới nhập". Đối chiếu thấy mirror TRUNG KẾ
  (`lib/mirrorTrunkCircuits.ts`, `autoCreateTrunkMirrorForCircuit`) đã có ĐÚNG
  cơ chế này từ trước (status `"occupied"` — hỏi `confirm()` xóa luồng chiếm
  chỗ + tạo lại, hoặc tự liên kết luôn nếu tên khớp hệt) — chỉ riêng nhánh
  thiết bị-thiết bị chưa từng làm tới mức đó. Bổ sung cho khớp:
  - `autoCreateMirrorForCircuit()` (`lib/deviceDeviceSync.ts`): khi không có
    `gap`/`mismatch`, soi TRỰC TIẾP thêm 1 bước (không đụng thuật toán dùng
    chung `findMissingDeviceMirrors` — hàm đó còn phục vụ quét hàng loạt ở
    `syncAllDeviceMirrorGaps`/`/data-quality`, không nên đổi hành vi quét đó):
    tách `device_position_next` qua `splitOdfDeviceStructure`, tìm luồng nào
    khác đang thật sự chiếm đúng thiết bị đích + Trib đó. Tên KHÁC nhau ->
    status mới `"occupied"` (kèm `occupantCircuitId`/`occupantCircuitName`).
    Tên GIỐNG HỆT nhưng chưa gắn `mirror_of_id` -> tự liên kết ngay, status
    mới `"linked"` (đối xứng "Case B" đã có của mirror trung kế, không cần
    hỏi vì chắc chắn cùng 1 luồng).
  - `DeviceCircuitList.tsx` (`autoMirrorAfterSave()`): thêm nhánh xử lý
    `status === "occupied"` — `confirm()` báo rõ tên Trib + tên luồng đang
    chiếm, hỏi "XÓA luồng cũ đó và TẠO LẠI đúng theo luồng vừa lưu?" — đồng ý
    thì gọi `replaceMismatchedDeviceMirror()` (đã có sẵn, dùng lại nguyên
    vẹn — xóa `occupantCircuitId` rồi gọi lại `autoCreateMirrorForCircuit`
    cho đúng luồng vừa lưu). Toàn bộ bước này chạy SAU KHI luồng vừa lưu đã
    lưu THÀNH CÔNG (đúng yêu cầu "giữ nguyên các nhập liệu mới nhập" — không
    có gì bị mất dù người dùng bấm Hủy ở hộp thoại; `confirm()` là hộp thoại
    trình duyệt chặn đồng bộ, không làm mất state React nào, không có
    `router.refresh()` nào chạy cho tới khi người dùng tự quyết định xong).
    Áp dụng CHO CẢ Thêm luồng mới lẫn Sửa luồng (`autoMirrorAfterSave` gọi từ
    cả `submitCreate()` lẫn `saveEdit()`).
  - Ca dữ liệu đã lỡ trùng lặp ở trên (`"100 ADN1.P2 (18/1/8)..."`, tự đứng
    riêng, không có mirror) — KHÔNG dùng cách "Sửa rồi Lưu lại" để tự kích
    hoạt luồng xử lý mới này: vì mirror đúng ĐANG gắn với bản "100GE" gốc rồi,
    làm vậy sẽ XÓA NHẦM mirror đúng đó và tạo lại trỏ ngược về bản trùng —
    chỉ cần XÓA THẲNG dòng trùng đó (nút Xóa bình thường) là đủ, không đụng gì
    tới cặp đã liên kết đúng.
  - File sửa: `lib/deviceDeviceSync.ts`, `components/odf-device/DeviceCircuitList.tsx`.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Cần người dùng tự
    thử: Thêm/Sửa 1 luồng thiết bị có "Vị trí ODF (tiếp theo)" trỏ đúng 1
    thiết bị+Trib local ĐANG bị 1 luồng khác tên chiếm — xác nhận có hộp
    thoại hỏi rõ, chọn Đồng ý thấy luồng cũ bị xóa và mirror mới đúng được
    tạo; chọn Hủy thấy luồng vừa lưu vẫn còn nguyên, chỉ chưa liên kết.

- **Mục 94 (2026-08-17) — Mirror thiết bị-thiết bị: copy luôn "Đối phương"
  (`counterpart_text`) sang luồng mirror tự tạo (đang bị bỏ sót).** Người
  dùng phát hiện ngay sau Mục 93: mirror trung kế/trung kế-trung kế
  (`lib/mirrorTrunkCircuits.ts` — cả 4 hàm tạo mirror: `autoCreateTrunkMirrorForCircuit`,
  `syncAllTrunkMirrorGaps`, `autoCreateTrunkTrunkMirrorForCircuit`,
  `syncAllTrunkTrunkMirrorGaps`) đều đã copy `counterpart_text` từ luồng gốc
  sang luồng mirror mới tạo TỪ TRƯỚC — CHỈ RIÊNG mirror thiết bị-thiết bị
  (`lib/deviceDeviceSync.ts`) bỏ sót field này (`insert()` không có
  `counterpart_text`), khiến 2 phía CÙNG 1 luồng vật lý (vd luồng thiết bị P2
  <-> ADX) hiện "Đối phương" khác nhau — bên tạo mirror trống trơn dù bên gốc
  đã ghi rõ (vd "2T9.OME11", "QTI.PE2 (10/1/2)", "HKG"...).
  - `DeviceMirrorGap` (interface, `lib/deviceDeviceSync.ts`) thêm field
    `sourceCounterpartText: string | null` — gán từ `c.counterpartText` ngay
    khi `findMissingDeviceMirrors()` push vào `gaps`. Thêm `counterpart_text:
    gap.sourceCounterpartText` vào CẢ 2 chỗ `insert()` tạo mirror mới
    (`autoCreateMirrorForCircuit` — tạo ngay lúc lưu form; `syncAllDeviceMirrorGaps`
    — quét hàng loạt ở `/data-quality`).
  - KHÔNG đụng nhánh "cùng tên, tự liên kết mirror_of_id vào circuit ĐÃ CÓ
    SẴN" (status `"linked"`, thêm ở Mục 93) — giữ đúng tiền lệ đã có ở cả 4
    hàm mirror trung kế (case tương tự bên đó cũng chỉ set `mirror_of_id`,
    không đụng `counterpart_text` của circuit đã tồn tại từ trước, tôn trọng
    dữ liệu đã có sẵn, có thể người dùng đã tự sửa tay khác đi).
  - **Backfill dữ liệu CŨ**: script tạm `scripts/tmp-backfill-mirror-counterpart.ts`
    (chạy DRY RUN rồi `--commit`, đã xóa sau khi xong) — quét mọi luồng
    THIẾT BỊ (không có `port_circuit_links` thật) có `mirror_of_id`, nếu luồng
    GỐC có `counterpart_text` mà luồng MIRROR đang RỖNG thì điền đúng giá trị
    gốc vào (không đè lên bất kỳ giá trị nào mirror đã có sẵn). Tìm thấy và
    sửa đúng 9 cặp, gồm cả cặp "100GE ADN1.P2 (18/1/8) - QTI.PE2 (10/1/2)"
    nhắc tới ở Mục 93.
  - File sửa: `lib/deviceDeviceSync.ts`.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Đã backfill xong 9
    cặp cũ (log đầy đủ trong lịch sử chạy script, không lặp lại ở đây).

- **Mục 95 (2026-08-17) — Chặn NGAY LÚC LƯU khi 1 thiết bị bị nhập trùng 2
  luồng cùng 1 Trib.** Truy lại tận gốc ca trùng lặp ở Mục 93: circuit
  `29ccdf95` (đã xóa) và `657d6e12` từng cùng tồn tại với CÙNG `device_id`
  (ADN1.P2) + CÙNG `trib_text` ("18/1/8") — không có gì trong app chặn việc
  này trước đây; người ta chỉ phát hiện được nhờ TRIỆU CHỨNG phụ (mirror
  "chưa liên kết" bất thường), không phải cảnh báo trực tiếp. Người dùng hỏi
  thẳng: "phải có cơ chế gì để không xảy ra hiện tượng tương tự". Bản chất:
  **1 Trib = 1 port vật lý cụ thể trên 1 thiết bị — không có trường hợp hợp
  lệ nào để 2 dòng `circuits` cùng lúc dùng chung 1 cặp (`device_id`,
  `trib_text`)** (khác hẳn rule "1 Vị trí ODF dùng chung nhiều Trib qua 'Kết
  nối trực tiếp'" ở `lib/devicePositionMap.ts` — đó là chiều NGƯỢC và có
  ngoại lệ, còn đây chính Trib bị trùng thì KHÔNG có ngoại lệ nào).
  - `findDuplicateDeviceTrib(deviceId, tribText, excludeId)` (hàm mới trong
    `components/odf-device/DeviceCircuitList.tsx`, dùng `circuits` prop đã
    tải sẵn — không cần query thêm): tìm 1 luồng KHÁC (loại trừ chính nó khi
    Sửa) có cùng `deviceId` + Trib khớp `normalizeDevicePositionKey`.
  - Gắn CHẶN LƯU (không phải cảnh báo mềm) ở CẢ `submitCreate()` (Thêm luồng
    mới — theo `createDraft.deviceId`) lẫn `saveEdit()` (Sửa luồng — tra lại
    `deviceId` gốc từ `circuits` qua `edit.id`, vì `EditState` không giữ sẵn
    field này, thiết bị vốn cố định khi Sửa) — đặt NGAY SAU bước kiểm tra
    thiếu trường bắt buộc (`findMissingRequiredFields`), TRƯỚC mọi bước ghi
    CSDL khác. Lỗi hiện rõ tên luồng đang chiếm Trib đó, hướng dẫn sửa/xóa
    luồng cũ nếu là cùng 1 luồng, hoặc kiểm tra lại Trib nếu thực ra khác.
  - **Phạm vi**: chỉ chặn được đường NHẬP TAY qua UI (`/odf-device/sua-luong`)
    — đúng đường đã gây ra ca thật. Các script quản trị ghi thẳng CSDL (vd
    `syncAllDeviceMirrorGaps`) không đi qua chốt này, nhưng đã có chốt RIÊNG
    từ Mục 93 (`autoCreateMirrorForCircuit` không tạo mirror trùng khi Trib
    đích đã có luồng khác — trả "occupied"/"linked"), không phải khoảng
    trống bỏ ngỏ. Chưa làm thêm 1 panel rà soát THỤ ĐỘNG kiểu "Xung đột vị
    trí" (`positionConflicts`, đã có sẵn ở cuối trang) cho riêng trùng lặp
    Trib — vì chốt CHẶN LƯU ở đây đã giải quyết đúng nguyên nhân gốc (nhập
    tay 2 lần) và dữ liệu hiện tại đã sạch (ca duy nhất phát hiện được đã xóa
    ở Mục 93); có thể bổ sung sau nếu phát sinh thêm ca tương tự từ nguồn
    khác.
  - File sửa: `components/odf-device/DeviceCircuitList.tsx`.
  - Kiểm chứng: `npx tsc --noEmit` + `npm run build` sạch. Cần người dùng tự
    thử: Thêm 1 luồng mới cho 1 thiết bị đã có sẵn Trib đó (copy y hệt 1 dòng
    cũ) — xác nhận bị chặn, báo rõ tên luồng đang chiếm Trib.
