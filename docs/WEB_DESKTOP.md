# Viễn Du — web và Windows

Ứng dụng Vite trên trình duyệt là trải nghiệm chính. Electron đóng gói cùng bản web đã build trong `dist/`; khách có thể học ngoại tuyến, còn tài khoản dùng API để đồng bộ và tham gia đoàn.

## Chạy web

Dùng Node.js 24 LTS và npm 11 như GitHub Actions; npm 10 có thể từ chối lockfile khi giải quyết peer dependency.

```bash
npm ci
npm start
```

`npm start` chạy máy chủ tại `http://localhost:8084` và yêu cầu đúng cổng này; nếu cổng đang bận, máy chủ sẽ báo lỗi thay vì chuyển sang cổng khác. Giữ terminal mở khi dùng ứng dụng. `npm run dev` và `npm run web` là các bí danh tương đương.

Để xem bản production, dừng máy chủ phát triển trước vì preview cũng dùng cổng 8084 và giữ terminal mở:

```bash
# Đặt VITE_API_URL trong .env hoặc môi trường build.
# Ví dụ https://api.example.com/api/v1 (không chứa khóa bí mật).
npm run build:web
npm run preview
```

Đưa thư mục `dist/` lên máy chủ HTTPS có fallback về `index.html` cho SPA. URL API được nhúng khi build; đổi URL cần build lại. Sau lần tải production đầu tiên và khi service worker lưu xong bundle, web có thể mở lại khi offline. Service worker chỉ cache giao diện/assets, không cache API hoặc dữ liệu đăng nhập. Bản desktop chứa toàn bộ bundle nên mở được khi offline.

## Chạy backend

```bash
npm --prefix backend ci
npm --prefix backend run db:generate
npm --prefix backend run dev:local
```

`npm start` từ thư mục gốc tự khởi động API, PGlite và web cùng nhau; không cần hai terminal. Runtime local tự áp dụng các migration theo thứ tự vào PGlite và giữ tài khoản/dữ liệu sau khi khởi động lại; chỉ dành cho phát triển. Production dùng PostgreSQL/Redis và biến môi trường tại `backend/.env.example`:

```bash
npm --prefix backend run db:migrate
npm --prefix backend run db:generate
npm --prefix backend run db:seed
npm --prefix backend run build
npm --prefix backend start
```

`GEMINI_API_KEY` chỉ nằm trên backend. Không có key thì quiz tĩnh vẫn dùng được; lỗi quiz không hủy phiên học.

## Chạy thử bằng Electron

Tạo bản web rồi khởi chạy Electron riêng. Lệnh start giữ terminal mở đến khi đóng ứng dụng:

```bash
npm run build:web
npm --prefix desktop ci
npm --prefix desktop start
```

## Windows .exe

```bash
npm run build:web
npm --prefix desktop ci
npm --prefix desktop run package:win
```

Installer ở `desktop/release/`. Workflow `.github/workflows/windows.yml` chạy lint, typecheck, kiểm tra web/Electron và tạo artifact `Vien-Du-Windows`. Đặt repository variable `VITE_API_URL` trước khi build bản dùng API online. Bản chưa ký chứng thư sẽ hiển thị nhà phát hành chưa xác minh trên Windows.

Đóng gói installer chưa ký từ macOS khi không có Wine:

```bash
npm --prefix desktop run package:win -- -c.win.signAndEditExecutable=false
```

Lệnh này bỏ cả chỉnh sửa tài nguyên EXE, nên bản đóng gói chéo dùng icon Electron mặc định. Workflow trên Windows không dùng tùy chọn đó. GitHub Actions chạy khi push `main` và tạo ZIP web cùng phiên bản với installer; backend được kiểm tra trong job riêng. File build lớn được lưu tại artifact Actions thay vì đưa vào lịch sử Git.

Electron dùng origin `viendu://app`, renderer sandbox, context isolation và CSP. Giao diện không có quyền Node hay IPC; cửa sổ ngoài bị chặn.

## Quy tắc đã triển khai

- Thời gian gợi ý 15/25/45/60 phút và ô tùy chỉnh 1–240 phút tại ga chính lẫn tấm vé; chặn số thập phân và giá trị ngoài giới hạn.
- Nút 2D/3D tại ga chính, bản đồ và ngay trong phiên học. Bản đồ nhìn từ trên xuống có đầu tàu, số toa theo thành viên thực tế, chọn toa xem tên/màu, phóng to/thu nhỏ, tìm tàu và hai tuyến núi/bờ biển. Góc nhìn không thay đổi đồng hồ. Vị trí phiên cá nhân có xem trước thời gian học chưa lưu; tiến độ đoàn dùng số đã được máy chủ xác nhận.
- 12 chủ đề học, gồm khoa học, ngôn ngữ, lịch sử, nghệ thuật và kỹ năng học; mỗi chủ đề có 3 câu hỏi tĩnh sau khi chạy seed.
- Cá nhân, toa với 4 màu/3 trang trí, 5 trạm, ngã rẽ có bình chọn 24 giờ.
- Nhóm riêng tối đa 6 thành viên; tạo, mời, thu hồi, gia nhập, rời và chuyển quyền.
- Phiên học không có nút tạm nghỉ hoặc nút tự phân loại xao nhãng. Mỗi lần rời cửa sổ/ẩn tab/chuyển sang mục khác được tính một lần xao nhãng; các sự kiện cùng một lần rời không bị tính trùng. Đồng hồ vẫn chạy liên tục tới hạn, kể cả khi rời phiên hoặc tải lại. Quay lại tiếp tục ngay, không chờ 120 giây. Phiên cũ đang tạm nghỉ/chờ được chuyển sang cơ chế này và giữ phần học đã lưu.
- Phần học hợp lệ loại trừ thời gian rời phiên, được lưu cả khi kết thúc sớm. Hạn kết thúc phiên dựa trên thời gian bắt đầu và thời lượng, kể cả khi trình duyệt bị treo ở nền.
- Sương khám phá xuất hiện ngay từ đầu phiên ở cả 2D/3D: vùng rõ quanh tàu lớn dần theo phần học được ghi nhận; không xóa vùng đã khám phá. Góc 2D giữ tàu cố định và cho cảnh vật trôi quanh tàu.
- Cho chọn mọi loại tệp, nhiều tệp cùng lúc. Word DOCX, PowerPoint PPTX, Excel XLSX/XLS, PDF, OpenDocument và các định dạng văn bản phổ biến được đọc ngay trên thiết bị. Giới hạn 20 MB/tệp, 10 tệp/chuyến và tổng 50.000 ký tự. Định dạng chưa có bộ đọc (ví dụ DOC/PPT cũ, ảnh, video) được ghi tên và báo chưa trích xuất; không đưa dữ liệu nhị phân vào quiz. PDF worker dùng file cùng origin, không tải từ CDN.
- Hàng đợi offline có mã phiên cố định; retry không cấp trùng. Máy chủ kiểm tra thời gian, chồng phiên, quyền đoàn, cap 60 phút/ngày theo múi giờ đoàn, giữ phần lẻ và dư tại đích.
- Đoàn chỉ thấy toa và tiến độ chung, không có mục tiêu, tài liệu, quiz hoặc log gián đoạn của người khác.
- Quiz tĩnh/Gemini là tùy chọn; kết quả được chấm trên máy chủ và ghi một lần.
- Mục Kết quả tester công khai chỉ chứa các phiên được tester chọn chia sẻ trong tổng kết: mã ẩn danh, chủ đề, thời lượng, số lần xao nhãng, điểm quiz và tỷ lệ hoàn thành tự đánh giá. Dữ liệu lấy từ phiên đã đồng bộ; không nhận thời gian/điểm do người dùng gửi để công khai. Có phân trang, CSV tối đa 10.000 phiên gần nhất và nút ẩn lại kết quả. Mục tiêu viết riêng, email, tài liệu và tên tài khoản vẫn riêng tư.
- Web Locks ngăn hai cửa sổ cùng sửa trạng thái cá nhân. Có xuất bản sao dữ liệu riêng.
- Cảnh 3D và bộ đọc tài liệu tải riêng; giới hạn pixel ratio, tự dừng khi ngoài viewport/ẩn cửa sổ, hỗ trợ reduced motion và ảnh SVG khi WebGL không khả dụng. Không có nút dừng hiệu ứng trong giao diện.
- Danh tính tài khoản được giữ khi mở lại offline, yêu cầu đăng nhập lại trước khi đồng bộ nếu hết phiên. Đăng xuất dọn phiên đăng nhập kể cả khi mất mạng; dữ liệu hành trình vẫn tách theo chủ sở hữu. Dữ liệu lưu bị hỏng có màn hình xuất bản sao và khôi phục, không âm thầm ghi đè.

## Giới hạn phát hành cần biết

Ứng dụng hiện hỗ trợ học cá nhân, nhóm bất đồng bộ và quiz tĩnh; quiz AI cần `GEMINI_API_KEY` trên backend. Đồng bộ tài khoản và nhóm cần backend hoạt động. Chưa có học nhóm trực tiếp, và bản desktop không tự đóng ứng dụng khác trên máy.

Backend dùng aggregate JSONB có row lock để quyết toán thành viên và ledger trong giao dịch. Thiết kế này phù hợp pilot nhóm nhỏ; cần phân tách aggregate theo journey và lập chính sách lưu/xóa dữ liệu trước khi mở rộng quy mô. Kiểm chứng thời gian dựa trên tự khai báo, không phải chống gian lận tuyệt đối. Quiz AI live cần key; Windows installer cần thử trên máy Windows thật.
