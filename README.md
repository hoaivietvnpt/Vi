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
- **Bảo mật**: đăng nhập bằng mật khẩu (secret `APP_PASSWORD`), cookie phiên HttpOnly ký HMAC, lưu 1 năm.

## Thêm vào màn hình chính iPhone

1. Mở **https://vi.nhv.me** bằng **Safari**.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên).
3. Chọn **Thêm vào MH chính** → **Thêm**.

## Cấu trúc

```
src/worker.js        API (/api/*) + phục vụ file tĩnh
src/static.js        Nhúng các file trong public/ vào Worker
public/              index.html, style.css, app.js, sw.js, manifest, icons
migrations/          Schema D1 + danh mục mặc định
wrangler.jsonc       Cấu hình Worker, D1 (vi-db), custom domain vi.nhv.me
```

## Phát triển & deploy

```bash
npm install
echo "APP_PASSWORD=matkhau" > .dev.vars
npm run db:migrate:local
npm run dev                 # http://localhost:8787

npx wrangler login
npm run deploy              # áp migration lên D1 rồi deploy
```

Đổi mật khẩu đăng nhập:

```bash
npx wrangler secret put APP_PASSWORD
```

(Đổi mật khẩu sẽ đăng xuất mọi thiết bị.)

### Tự động deploy bằng GitHub Actions

Workflow `.github/workflows/deploy.yml` deploy mỗi khi push vào `main`. Thêm 2 secret trong
*Settings → Secrets and variables → Actions* của repo:

- `CLOUDFLARE_API_TOKEN` — token mẫu “Edit Cloudflare Workers” (cần thêm quyền D1 Edit)
- `CLOUDFLARE_ACCOUNT_ID`
