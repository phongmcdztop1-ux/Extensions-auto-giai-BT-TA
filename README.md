# cre: Phong — Auto Giải Bài Trắc Nghiệm

Chrome Extension (Manifest V3) chụp màn hình câu hỏi trắc nghiệm, gửi lên AI (mọi API tương thích OpenAI) và hiển thị đáp án.

> Phiên bản hiện tại: **chỉ chụp + giải**. Tính năng tự động tick đáp án đã được gỡ bỏ để ổn định.

## Tính năng

- Chụp vùng chọn trên màn hình (qua service worker) rồi gửi ảnh cho AI
- Overlay gọn nhẹ, dựng bằng **Shadow DOM** nên website không thấy và không can thiệp được
- Kết quả render công thức toán bằng **KaTeX**, markdown bằng **marked**
- Cấu hình ngay trong overlay: API URL, Model, **xoay vòng nhiều API key** (tự đổ khi bị 429), Temperature, Max tokens
- Chế độ gửi ảnh: `auto` / `vision` / `text` — hỗ trợ cả model chữ-only (LM Studio, Ollama…) lẫn model multimodal
- Proxy request qua background để né CORS/CSP
- `anti_blur.js` chống phát hiện rời tab / mất focus / đổi cửa sổ, phục vụ các trang thi trực tuyến
- Phím tắt mở/đóng overlay: `Ctrl+Shift+F`

## Cài đặt

1. Mở `chrome://extensions`
2. Bật **Developer mode**
3. Chọn **Load unpacked** → chọn thư mục chứa `manifest.json`
4. Mở overlay (nút ⚡ góc màn hình hoặc `Ctrl+Shift+F`), vào ⚙️ và nhập API key

## Cấu trúc

| File | Vai trò |
|---|---|
| `manifest.json` | Khai báo extension MV3, content script, phím tắt |
| `content.js` | Overlay (Shadow DOM), chụp ảnh, gọi AI, xử lý kết quả |
| `background.js` | Service worker: `captureVisibleTab` + proxy fetch |
| `anti_blur.js` | Chạy ở `world: MAIN`, chống phát hiện rời tab |
| `popup.html` / `popup.js` | Giao diện popup dự phòng |
| `lib/` | Thư viện cục bộ: KaTeX, marked, tailwind (không dùng CDN) |
| `icons/` | Icon extension |

## Cấu hình lưu ở đâu

Cấu hình và API key **không nằm trong mã nguồn**. Extension lưu vào `chrome.storage.local` với các khoá:

- `cre_config` — API URL, model, danh sách API key, temperature, max tokens
- `cre_models` — cache danh sách model

Khi nâng cấp từ bản cũ (khoá `phantomx_*`), extension tự động đọc khoá cũ và chuyển sang khoá mới ở lần chạy đầu.

## Lưu ý bảo mật

- **Đừng commit API key vào mã nguồn.** File `.gitignore` đã chặn sẵn các pattern nhạy cảm.
- Nếu lỡ commit nhầm key, hãy **revoke key ngay** trên trang quản lý của nhà cung cấp — xoá commit không làm vô hiệu key đã lộ.

## License

MIT
