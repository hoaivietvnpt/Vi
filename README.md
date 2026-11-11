# Ví — Quản lý thu chi hằng ngày

Web app (PWA) ghi chép thu chi nhanh, báo cáo trực quan, cài được lên màn hình chính iPhone.
Chạy trên **Cloudflare Workers + D1** tại **https://vi.nhv.me**.

## Tính năng

- **Nhập liệu nhanh**: bấm nút ＋ → bàn phím số riêng (có phím `000`, cộng/trừ nhanh), chọn danh mục
  (danh mục hay dùng tự xếp lên đầu, nhớ danh mục gần nhất), chọn ngày *Hôm nay / Hôm qua / Ngày khác*, ghi chú.
  Hiển thị số tiền bằng chữ để tránh bấm nhầm số 0.
- **Tổng quan**: số dư tháng, tổng thu/chi, chi hôm nay, trung bình/ngày, biểu đồ 7 ngày, giao dịch gần đây.
- **Sổ thu chi**: xem theo tháng, nhóm theo ngày, tìm kiếm, lọc Thu/Chi/danh mục; chạm để sửa/xoá.
- **Báo cáo**: theo Tuần/Tháng/Năm, so sánh kỳ trước, biểu đồ tròn cơ cấu theo danh mục, dòng tiền theo ngày/tháng,
  xu hướng 6 tháng, các điểm nhấn (khoản chi lớn nhất, ngày chi nhiều nhất…).
- **Cài đặt**: thêm/sửa/xoá danh mục (emoji + màu), xuất CSV (mở bằng Excel), sao lưu/khôi phục JSON.
- **PWA**: thêm vào màn hình chính iPhone, chế độ sáng/tối tự động, hoạt động ngoại tuyến
  (giao dịch nhập khi mất mạng sẽ tự đồng bộ khi có mạng lại).
- **Nhiều người dùng**: đăng ký bằng email + mật khẩu. Mỗi người có *Sổ cá nhân* riêng, có thể tạo thêm sổ
  (vd. *Gia đình*) và mời người khác bằng mã/link mời. Trong sổ chung, mỗi giao dịch ghi rõ ai nhập và báo cáo có
  phần *Theo thành viên*. Chủ sổ có thể đổi mã mời, xoá thành viên, đổi tên hoặc xoá sổ; thành viên có thể rời sổ.
- **Bảo mật**: mật khẩu băm PBKDF2-SHA256, phiên đăng nhập lưu trong D1 (cookie HttpOnly, 1 năm; đổi mật khẩu sẽ
  đăng xuất các thiết bị khác), giới hạn số lần đăng nhập sai, kiểm tra quyền theo sổ ở mọi API, chặn CSRF theo Origin.
  Tài khoản đăng ký **đầu tiên** sẽ nhận toàn bộ dữ liệu có từ trước khi bật chế độ nhiều người dùng.
- **Quên mật khẩu**: tài khoản đầu tiên là quản trị viên (có thể cấp quyền cho người khác). Trong Cài đặt →
  Quản trị người dùng, admin **đặt lại mật khẩu** → app tạo mật khẩu tạm; người dùng đăng nhập bằng mật khẩu tạm sẽ
  bị yêu cầu đặt mật khẩu mới ngay.
- **Chi cho / Thu từ**: khi nhập giao dịch có thể chọn người liên quan (Bố, Mẹ, Vợ/Chồng, Con, Anh, Chị, Em, Ông bà,
  Bạn bè… hoặc thêm nhanh bằng nút ＋). Báo cáo có phần *Chi cho ai / Thu từ ai*, chạm để lọc sổ theo người.
  Danh sách người quản lý trong Cài đặt → Người thân (riêng cho từng sổ).

## Thêm vào màn hình chính iPhone

1. Mở **https://vi.nhv.me** bằng **Safari**.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên).
3. Chọn **Thêm vào MH chính** → **Thêm**.

## Cấu trúc

```
src/worker.js        API (/api/auth, /api/me, /api/books/:id/...) + phục vụ file tĩnh
src/static.js        Nhúng các file trong public/ vào Worker
public/              index.html, style.css, app.js, sw.js, manifest, icons
migrations/          Schema D1 (0001 dữ liệu, 0002 tài khoản/sổ/thành viên, 0003 admin, 0004 người thân)
wrangler.jsonc       Cấu hình Worker, D1 (vi-db), custom domain vi.nhv.me
```

## Phát triển & deploy

```bash
npm install
npm run db:migrate:local
npm run dev                 # http://localhost:8787

npx wrangler login
npm run deploy              # áp migration lên D1 rồi deploy
```

### Tự động deploy bằng GitHub Actions

Workflow `.github/workflows/deploy.yml` deploy mỗi khi push vào `main`. Thêm 2 secret trong
*Settings → Secrets and variables → Actions* của repo:

- `CLOUDFLARE_API_TOKEN` — token mẫu “Edit Cloudflare Workers” (cần thêm quyền D1 Edit)
- `CLOUDFLARE_ACCOUNT_ID`
