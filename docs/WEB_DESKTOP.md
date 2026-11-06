# Viễn Du — web và Windows

Ứng dụng Vite trên trình duyệt là trải nghiệm chính; Electron đóng gói cùng bản web đã build trong `dist/`. Luồng học cá nhân bắt đầu từ mục tiêu, sau đó chuẩn bị kế hoạch và tài liệu nếu có, tập trung, truy hồi rồi đánh giá. Kế hoạch do AI gợi ý là tùy chọn và người học có thể xem lại, chỉnh sửa trước khi dùng.

Ghi chú, kế hoạch, văn bản trích xuất, thông tin tệp, trạng thái xem lại và nhật ký học tập thuộc workspace của chủ sở hữu hiện tại trên thiết bị; chúng không được đưa vào lịch sử công khai. Tệp được đọc cục bộ trước. Tệp gốc chỉ nằm trong bộ nhớ trình duyệt và cần nhập lại sau khi tải lại ứng dụng nếu muốn dùng tệp đó cho tác vụ AI.

Lần đầu sử dụng có một khảo sát ngắn về mục tiêu, môn học, thời lượng và một số thông tin tùy chọn, sau đó là hướng dẫn bốn bước cho các thao tác thật trong workspace. Tiến độ được lưu cục bộ; người học có thể tạm dừng, tiếp tục hoặc mở lại hướng dẫn. Hướng dẫn dùng được ngoại tuyến, không tự gửi yêu cầu AI, và không xuất hiện để chiếm chỗ phiên tập trung đang hoạt động hay làm thay đổi đồng hồ.

Phiên tập trung thủ công dùng được khi không có tài khoản, mạng hoặc kế hoạch AI. Thời lượng từ 1 đến 240 phút. Focus ưu tiên sự yên tĩnh quanh bước đang học và đồng hồ, đồng thời tôn trọng tùy chọn giảm chuyển động. Tài khoản vẫn dùng cho các chức năng đồng bộ hiện có; màn hình quản lý nhóm mới đã ngừng.

### AI khách không cần tài khoản

AI là tùy chọn và chỉ chạy khi có mạng, backend có `GEMINI_API_KEY`, và người học chủ động chọn tác vụ AI. Đọc tài liệu yêu cầu xác nhận gửi nội dung. Máy chủ cấp credential khách ngẫu nhiên, lưu bản băm và giữ bộ câu hỏi, khóa đáp án, trạng thái bài tập, lời giải cùng phản hồi chi tiết trong Redis riêng theo credential; các bản ghi riêng tư hết hạn sau 7 ngày. Chúng không được chuyển vào tài khoản khi người học đăng nhập. Lịch sử ẩn danh chỉ nhận phần tóm tắt phiên được phép, không nhận prompt hoặc phản hồi chi tiết.

Backend giới hạn cấp credential theo IP/toàn hệ thống, yêu cầu theo IP, đơn vị sử dụng theo credential và từng loại tác vụ, cùng một trần đơn vị toàn hệ thống. Bộ đếm Redis được đặt nguyên tử trước khi gọi nhà cung cấp; hết hạn mức trả `429`, Redis không dùng được thì guest AI bị từ chối. Các mặc định có thể chỉnh bằng `GUEST_AI_*` trong `backend/.env.example`; đơn vị này là mức sử dụng nội bộ, không phải số token được nhà cung cấp tính phí. `REDIS_URL` và `GEMINI_API_KEY` chỉ cấu hình trên backend, không đưa vào `VITE_*`.

## Chạy web

Dùng Node.js 24 LTS và npm 11 như GitHub Actions; npm 10 có thể từ chối lockfile khi giải quyết peer dependency.

```bash
npm ci
npm start
```

`npm start` chạy máy chủ tại `http://localhost:8084` và yêu cầu đúng cổng này; nếu cổng đang bận, máy chủ sẽ báo lỗi thay vì chuyển sang cổng khác. Giữ terminal mở khi dùng ứng dụng. `npm run dev` và `npm run web` là các bí danh tương đương.

Để xem bản production, dừng máy chủ phát triển trước vì preview cũng dùng cổng 8084 và giữ terminal mở:

`npm run preview` chỉ phục vụ giao diện đã build trong `dist/`. Khi không cấu hình API riêng, các yêu cầu `/api/*` được chuyển tới `127.0.0.1:3000`. Khởi động API trong một terminal riêng để đăng nhập, đồng bộ, dùng AI tài khoản hoặc AI khách:

```bash
npm --prefix backend run dev:local
```

Trong terminal thứ hai:

```bash
# Chỉ đặt VITE_API_URL khi dùng một API riêng thay cho API local.
# Ví dụ https://api.example.com/api/v1 (không chứa khóa bí mật).
npm run build:web
npm run preview
```

Đưa thư mục `dist/` lên máy chủ HTTPS có fallback về `index.html` cho SPA. URL API được nhúng khi build; đổi URL cần build lại. Sau lần tải production đầu tiên và khi service worker lưu xong bundle, web có thể mở lại khi offline. Service worker chỉ cache giao diện/assets, không cache API hoặc dữ liệu đăng nhập. Bản desktop chứa toàn bộ bundle nên mở được khi offline.

Để Railway phục vụ cả giao diện và API trong một dịch vụ, xem [hướng dẫn Railway](RAILWAY.md). Bản web tĩnh vẫn có thể được lưu trữ riêng và trỏ tới API bằng `VITE_API_URL` lúc build.

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

`GEMINI_API_KEY` chỉ nằm trên backend. Không có key thì lập kế hoạch, đọc tài liệu, tạo câu hỏi, bản ôn tập và bài tập bằng AI chưa dùng được; workspace cá nhân, thư viện tài liệu, nhật ký riêng, phiên tập trung thủ công và OCR cục bộ vẫn hoạt động. Guest AI cũng cần `REDIS_URL` để lưu credential, quota và trạng thái riêng tư; Redis lỗi thì các yêu cầu guest AI bị từ chối. Điều chỉnh các biến `GUEST_AI_*` theo lưu lượng dự kiến; `GUEST_AI_GLOBAL_DAILY_UNITS` là trần đơn vị nội bộ, không phải hóa đơn token.

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

Installer ở `desktop/release/`. Workflow `.github/workflows/windows.yml` chạy lint, typecheck, kiểm tra web/Electron và tạo artifact `Vien-Du-Windows`. Bản Actions mặc định dùng `https://viendu.up.railway.app/api/v1`; đặt repository variable `VITE_API_URL` nếu cần dùng API khác. Bản chưa ký chứng thư sẽ hiển thị nhà phát hành chưa xác minh trên Windows.

Đóng gói installer chưa ký từ macOS khi không có Wine:

```bash
npm --prefix desktop run package:win -- -c.win.signAndEditExecutable=false
```

Lệnh này bỏ cả chỉnh sửa tài nguyên EXE, nên bản đóng gói chéo dùng icon Electron mặc định. Workflow trên Windows không dùng tùy chọn đó. GitHub Actions chạy khi push `main` và tạo ZIP web cùng phiên bản với installer; backend được kiểm tra trong job riêng. File build lớn được lưu tại artifact Actions thay vì đưa vào lịch sử Git.

Electron dùng origin `viendu://app`, renderer sandbox, context isolation và CSP. Giao diện không có quyền Node hay IPC; cửa sổ ngoài bị chặn.

## Luồng học cá nhân và tương thích dữ liệu

- Việc học bắt đầu từ mục tiêu của người học. Nguồn ôn tập là tùy chọn. Kế hoạch AI là tùy chọn; người học có thể xem lại và chỉnh từng bước trước khi dùng. Kế hoạch, ghi chú, văn bản trích xuất, thông tin tệp, trạng thái xem lại và đánh giá riêng được giữ trong workspace cục bộ theo chủ sở hữu.
- Thư viện ôn tập tách ghi chú khỏi tệp gốc và giữ văn bản trích xuất, thông tin tệp cùng trạng thái xem lại trên thiết bị. Tệp gốc chỉ nằm trong bộ nhớ trình duyệt; cần nhập lại sau khi tải lại ứng dụng nếu muốn gửi chính tệp đó để đọc bằng AI. OCR/đọc tệp chạy cục bộ trước; nội dung chưa đọc được hoặc chưa được xác nhận không được coi là nguồn đã duyệt. Chỉ yêu cầu AI do người học chủ động chọn mới gửi nội dung lên backend.
- Tệp nhập tối đa 32 MiB, 10 tệp trong một workspace, 50.000 ký tự nguồn và 20 megapixel mỗi ảnh. PDF có tối đa 20 trang, với ngân sách OCR cục bộ 120 giây/tệp. Worker PDF/OCR, WASM và dữ liệu tiếng Việt/Anh được đóng gói cùng origin; không tải từ CDN.
- Phiên tập trung thủ công từ 1 đến 240 phút, không cần tài khoản, mạng hoặc kế hoạch AI. Focus giữ bước đang học và đồng hồ làm trọng tâm, tôn trọng reduced motion. Thời gian chạy liên tục theo mốc bắt đầu; thời gian vắng được ghi nhận theo quy tắc hiện có. Giải lao theo lịch là phần riêng, được cộng vào thời gian tường nhưng không tính vào thời gian học hợp lệ.
- Nhật ký riêng theo chủ sở hữu có các trang gọn hiển thị mục tiêu, thời gian tập trung hợp lệ và kết quả truy hồi/đánh giá; chi tiết gián đoạn nằm trong **Mở chi tiết**. Trên desktop, nhật ký lật theo spread hai trang; trên màn hình nhỏ, mỗi lần chỉ hiện một trang. Các số được trình bày tách biệt; điểm bài kiểm tra không thay đổi XP. Lịch sử công khai chỉ chứa các trường tóm tắt được phép, không chứa ghi chú, nguồn tệp, prompt hay phản hồi chi tiết.
- Học AI là tùy chọn và không cần tài khoản cho khách; backend trực tuyến, khóa Gemini và Redis còn dùng được. Đọc tài liệu cần lựa chọn rõ ràng và xác nhận gửi. AI không chạy khi ngoại tuyến, nhưng không ngăn bắt đầu hay hoàn tất phiên học thủ công.
- Chức năng quản lý nhóm đã ngừng: tạo nhóm, tham gia, mời thành viên, sửa danh sách và khởi chạy phiên nhóm mới trả HTTP `410 feature-retired`. Không xóa bản ghi cũ. Lịch sử và dữ liệu nhóm cũ vẫn đọc được; phiên cũ đã hoạt động có thể tiếp tục, hoàn tất và được quyết toán theo quyền sở hữu hiện có.
- Web/Electron giữ dữ liệu và phiên theo chủ sở hữu trên thiết bị; dữ liệu đồng bộ tài khoản hiện có vẫn theo luồng tài khoản. Nếu phiên đăng nhập hết hạn, cần đăng nhập lại trước khi đồng bộ. Lưu trữ hỏng vẫn có đường xuất/khôi phục và không bị âm thầm ghi đè.

## Giới hạn phát hành cần biết

Học cá nhân không cần tài khoản; thủ công có thể chạy ngoại tuyến từ 1 đến 240 phút. Lập kế hoạch và các tác vụ AI cần backend trực tuyến, `GEMINI_API_KEY`, và hạn mức còn dùng; AI khách không cần tài khoản nhưng cần Redis để cấp credential, kiểm tra quota và giữ trạng thái riêng tư bảy ngày. Bản desktop không tự đóng ứng dụng khác trên máy.

Backend giữ nguyên aggregate JSONB có row lock để hoàn tất và quyết toán phiên nhóm cũ đã hoạt động. Bản ghi và lịch sử cũ không bị xóa; quyền đọc và quyết toán vẫn được kiểm tra theo chủ sở hữu. Kiểm chứng thời gian dựa trên tự khai báo, không phải chống gian lận tuyệt đối. AI live cần key; Windows installer cần thử trên máy Windows thật.

Ghi chú, văn bản trích xuất, thông tin tệp và trạng thái xem lại được lưu trong workspace cục bộ theo chủ sở hữu. Tệp gốc chỉ giữ trong bộ nhớ trình duyệt và phải nhập lại sau khi tải lại ứng dụng để dùng cho tác vụ AI. Thay đổi ghi chú không ghi đè nguồn đã trích xuất. Nguồn chưa đọc được hoặc chưa xác nhận không được coi là tài liệu đã duyệt để tạo câu hỏi.

Kế hoạch học do AI gợi ý và bản ôn tập do AI soạn đều là tùy chọn. Người học xem lại và chỉnh sửa trước khi dùng; nội dung chưa xác nhận không được tự động biến thành nguồn đã duyệt. Đọc ảnh/PDF bằng AI có thể đề xuất phục dựng chỗ mờ theo ngữ cảnh; phần suy luận cần giữ nhãn rõ ràng và phải được người học kiểm tra.
