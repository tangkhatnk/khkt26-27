# Viễn Du — web và Windows

Ứng dụng Vite trên trình duyệt là trải nghiệm chính. Màn hình mặc định **Người bạn học** là lộ trình bài học ngắn theo khối lớp và môn, đi theo thứ tự mục tiêu, tài liệu, tập trung, truy hồi và đánh giá. Electron đóng gói cùng bản web đã build trong `dist/`.

Học cá nhân, lộ trình bài học và OCR cục bộ dùng được khi không có tài khoản; tiến độ lộ trình được lưu trên thiết bị theo chủ sở hữu hiện tại và không nằm trong đồng bộ tài khoản. Nhật ký, lịch sử và báo cáo vẫn mở từ điều hướng chính. Tài khoản dùng cho đồng bộ tài khoản và chuyến học nhóm có chia sẻ mục tiêu, môn học, thời lượng kế hoạch; nguồn học và câu trả lời vẫn riêng tư.

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

`GEMINI_API_KEY` chỉ nằm trên backend. Không có key thì đọc tài liệu, tạo câu hỏi, bản ôn tập và bài tập bằng AI chưa dùng được; lộ trình, câu hỏi curated ngoại tuyến và phiên học thông thường vẫn hoạt động. Guest AI cũng cần `REDIS_URL` để lưu credential, quota và trạng thái riêng tư; Redis lỗi thì các yêu cầu guest AI bị từ chối. Điều chỉnh các biến `GUEST_AI_*` theo lưu lượng dự kiến; `GUEST_AI_GLOBAL_DAILY_UNITS` là trần đơn vị nội bộ, không phải hóa đơn token.

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

## Chi tiết luồng hành trình phụ

- Thời gian gợi ý 15/25/45/60 phút và ô tùy chỉnh 1–240 phút tại ga chính lẫn tấm vé; chặn số thập phân và giá trị ngoài giới hạn.
- Trang chủ chọn chủ đề, nhập nhanh mục tiêu và thời gian; bước chuẩn bị hiển thị vé tàu cùng lộ trình phiên học. Mục “Sửa vé” là thẻ chỉnh sửa nổi bật với biểu tượng, nhãn và nút mở/thu gọn; chủ đề đã chọn ở ga chính được giữ trên vé và khi bắt đầu phiên. Lịch nhiều lần nghỉ hiện tổng thời lượng, số chặng học và số lần nghỉ; mở “Xem lịch từng chặng” để xem thứ tự chi tiết.
- Vé có dải màu, cuống xé và barcode dọc theo kiểu vé tàu, dùng bảng màu kem/xanh lá/cam đất của Viễn Du. Máy chủ cấp trước mã ẩn danh cho ID chuyến; khi lưu, lịch sử dùng lại đúng mã đó. Cấp mã không ghi lịch sử hay cộng tiến độ; chưa có mạng vẫn bắt đầu học bình thường.
- Trang chuẩn bị chia nội dung ôn tập và lộ trình khởi hành thành hai cột trên màn hình rộng, một cột trên điện thoại. Ba cách chuẩn bị gồm dán kiến thức/ghi chú, tải tệp và nhờ AI soạn theo yêu cầu tự do về nội dung hoặc cách trình bày. Ô ghi chú có ví dụ, phân biệt nội dung kiến thức với mục tiêu chuyến đi.
- Nút bắt đầu/tiếp tục yêu cầu toàn màn hình ngay từ thao tác bấm. Trình duyệt từ chối hoặc chưa hỗ trợ vẫn cho học; có nút bật/thoát trong phiên. Escape không bị tự bật lại. Rời trang bấm giờ hoặc kết thúc phiên sẽ thoát toàn màn hình do phiên đó mở; các quy tắc ghi nhận xao nhãng giữ nguyên.
- Đồng hồ dạng flip clock hiển thị mặt trên của số mới và mặt dưới của số cũ trong lúc lật; nửa trên lật ra rồi nửa dưới lật vào, với phần chữ được cắt đúng theo từng nửa. Đồng hồ đọc được bằng trình đọc màn hình và giữ đúng số phút trên 99. Cảnh phiên học dùng đồng quê thoáng, ít mây. Đầu tàu giữ ở giữa trong phiên học. Trong 12 giây trước giờ giải lao, trạm nghỉ đi vào từ phía phải và đến giữa khi bắt đầu nghỉ; khi học tiếp, trạm rời sang trái rồi biến mất. Tổng kết hiện ga cuối ở phía cuối tuyến; phiên kết thúc sớm dùng nhãn điểm dừng riêng; chuyển động được giảm/tắt theo lựa chọn giảm hoạt ảnh, trạng thái rời phiên và khả năng nhìn thấy cảnh.
- Ga chính và trang bản đồ dùng bản đồ 2D; trong phiên học dùng cảnh tàu 2D. Bản đồ nhìn từ trên xuống có đầu tàu, số toa theo thành viên thực tế, chọn toa xem tên/màu, phóng to/thu nhỏ, tìm tàu và hai tuyến núi/bờ biển. Góc nhìn không thay đổi đồng hồ. Vị trí cá nhân có xem trước thời gian tập trung của phiên đang mở, giữ phần đã học chờ đồng bộ; bản đồ chuyến chỉ mở vùng từ tiến độ được máy chủ xác nhận để giữ đúng cap đóng góp mỗi ngày.
- Có giao diện sáng/tối, ban đầu theo hệ thống; nút đổi xuất hiện ở thanh trên và trong phiên toàn màn hình. Lựa chọn được lưu riêng theo thiết bị, không thay đổi tài khoản, dữ liệu học hay trạng thái phiên.
- Cảnh báo đồng hồ chạy lùi lấy mốc giờ hiện tại khi kiểm tra; mốc cập nhật giao diện cũ hơn checkpoint không tạo cảnh báo giả. Khi giờ thiết bị thực sự chạy lùi, phiên vẫn được giữ và chặn kết thúc cho đến khi giờ hợp lệ.
- Lịch sử dùng bảng gọn trên màn hình rộng và thẻ trên điện thoại; mã chuyến giữ liền dòng, thời lượng học/tổng chuyến/tập trung/giải lao có nhãn riêng, điểm quiz thành badge. Mục Chi tiết giữ mã người thử, thiết bị, xao nhãng và thời điểm chính xác theo giờ địa phương của người xem.
- 12 chủ đề học, gồm khoa học, ngôn ngữ, lịch sử, nghệ thuật và kỹ năng học; seed chỉ tạo chủ đề, không tạo bộ câu hỏi có sẵn.
- Cá nhân, toa với 4 màu/3 trang trí, 5 trạm, ngã rẽ có bình chọn 24 giờ.
- Nhóm học được lập theo từng chuyến có kế hoạch, tối đa 6 người kể cả chủ chuyến. Mã mời hết hạn sau 24 giờ hoặc bị thu hồi khi chuyến khởi hành. Mỗi thành viên tự bắt đầu và quyết toán phiên tập trung của mình; thành viên và phần đóng góp chung chỉ thuộc chuyến đó, còn tiến độ hành trình cá nhân vẫn được giữ.
- Bắt đầu phiên của chuyến cần tài khoản đã đăng nhập và backend trực tuyến. Sau khi tải lại, mỗi thành viên chỉ khôi phục được mã phiên đang liên kết với chính mình.
- Thành viên của chuyến nhìn thấy mục tiêu, chủ đề và thời lượng chung. Nguồn học, đề bài gửi AI và câu trả lời của từng người vẫn riêng tư.
- Ứng dụng hiện tạo chuyến qua `/api/v1/adventure/trips`; endpoint cũ `/api/v1/adventure/groups` được giữ để tương thích và đã deprecated. Nhóm cũ vẫn đọc, tiếp tục và quyết toán phiên đã lưu, hoặc rời nhóm; không thể tạo lời mời hay khởi chạy chuyến mới.
- Phiên học không có nút tạm nghỉ hoặc nút tự phân loại xao nhãng. Mỗi lần rời cửa sổ/ẩn tab/chuyển sang mục khác được tính một lần xao nhãng; các sự kiện cùng một lần rời không bị tính trùng. Đồng hồ vẫn chạy liên tục tới hạn, kể cả khi rời phiên hoặc tải lại. Quay lại tiếp tục ngay, không chờ 120 giây. Phiên cũ đang tạm nghỉ/chờ được chuyển sang cơ chế này và giữ phần học đã lưu.
- Phần học hợp lệ loại trừ thời gian rời phiên, được lưu cả khi kết thúc sớm. Hạn kết thúc phiên dựa trên thời gian bắt đầu và thời lượng, kể cả khi trình duyệt bị treo ở nền.
- Bản đồ 2D phủ sương lên địa hình, đường và trạm chưa khám phá; tên và câu chuyện của trạm chưa mở được giấu. Học hợp lệ mở dần hành lang quanh tàu, giữ đường đã đi và trạm đã đến theo tiến độ lưu; thời gian xao nhãng không mở thêm bản đồ. Trong phiên có xem trước phần học chưa lưu. Sương xanh lam/trắng dùng các trường mật độ nhiễu, khối mây loang và xoáy mềm, chuyển động chậm trên nền xanh ngọc; địa hình chưa mở chỉ hiện mờ dưới sương, tên trạm chưa mở vẫn được giấu; vùng đã mở giữ nguyên trạng thái. Khi khám phá hết, toàn bộ sương được xóa. Đường ray luôn liền mạch dưới sương. Trong phiên, đầu tàu giữ góc nhìn ở giữa, cảnh vật 2D chuyển động quanh tàu.
- Cho chọn mọi loại tệp, nhiều tệp cùng lúc. Word DOCX, PowerPoint PPTX, Excel XLSX/XLS, PDF, OpenDocument và các định dạng văn bản phổ biến được đọc ngay trên thiết bị. Giới hạn 32 MiB/tệp, 10 tệp/chuyến và tổng 50.000 ký tự. PDF quét và ảnh PNG/JPG/WebP/BMP được nhận diện bằng OCR tiếng Việt/Anh ngay trên thiết bị; PDF có chữ giữ phần văn bản gốc và chỉ OCR trang ít chữ. Giới hạn ảnh 20 megapixel, đọc tối đa 20 trang PDF và OCR tối đa 20 trang trong 120 giây mỗi tệp. Kết quả một phần ghi rõ giới hạn đã chạm. Có tiến độ, số trang và nút hủy đọc; rời tấm vé/đổi tài khoản hủy tác vụ và không nhập nội dung dở dang. Định dạng chưa có bộ đọc (ví dụ DOC/PPT cũ, video) được ghi tên và báo chưa trích xuất; không đưa dữ liệu nhị phân vào quiz. Worker PDF/OCR, WASM và dữ liệu ngôn ngữ dùng file cùng origin, không tải từ CDN; desktop có các tệp trong bundle.
- Mục **Giải bài tập bằng AI** cũng nhận đề gõ trực tiếp hoặc tệp/ảnh được hỗ trợ. Tệp được trích xuất hoặc OCR ngay trên thiết bị; người học xem và sửa bản xem trước rồi chọn rõ **Thay đề** hoặc **Nối vào cuối đề**. Đề giới hạn 20.000 ký tự; chỉ phần văn bản đã xác nhận mới được gửi cho AI. Bộ bài tập chỉ hiện trong phiên tập trung, còn lời giải chỉ có sau khi máy chủ xác nhận phiên đã hoàn tất.
- Trong mục Tài liệu học tập, “Ưu tiên dùng AI để đọc PDF/ảnh” dành cho ảnh quét, chữ viết tay hoặc tệp khó đọc; chọn ô này chưa gửi tệp. Để trống để thử đọc trên thiết bị trước: bấm “Đọc bằng AI” để gửi đúng tệp PDF/PNG/JPG/WebP qua backend tới Google Gemini. Tệp gốc chỉ giữ trong bộ nhớ trình duyệt. Bản chép AI, OCR cục bộ và kết quả bị cắt phải được người học sửa/xác nhận trước khi tạo câu hỏi. Nguồn từng tệp lưu riêng với ghi chú; xóa ghi chú không xóa nguồn. Thiếu nguồn hay chưa xác nhận sẽ chặn tạo câu hỏi thay vì dùng câu hỏi theo chủ đề.
- Trạm dừng chân được chọn trước phiên: tối đa 10 lượt, mỗi lượt 1–30 phút, ít hơn số phút học. Giải lao tự chia đều và tự tiếp tục. Ví dụ 15 phút học và 1 lượt nghỉ 5 phút tạo lịch học 7:30 → nghỉ 5:00 → học 7:30. Đồng hồ hiển thị thời gian còn lại của chặng hiện tại, kèm số chặng và lượt nghỉ sắp tới; không đếm gộp cả hai chặng học. Tổng thời lượng cộng thêm giải lao; thời gian nghỉ không tạo XP hay xao nhãng và được ghi riêng trong nhật ký/lịch sử. Rời máy trong giờ học vẫn tính xao nhãng; rời trong giải lao rồi tiếp tục vắng khi học trở lại được tính một lần.
- Hàng đợi offline có mã phiên cố định; retry không cấp trùng. Máy chủ kiểm tra thời gian, chồng phiên, quyền đoàn, cap 60 phút/ngày theo múi giờ đoàn, giữ phần lẻ và dư tại đích.
- Trong một chuyến, mục tiêu, chủ đề và thời lượng kế hoạch được chia sẻ với thành viên; nguồn học, đề bài gửi AI, câu trả lời và log gián đoạn của từng người không được chia sẻ.
- Lộ trình mặc định dùng câu tự kiểm tra curated có thể làm ngoại tuyến. Trong luồng chuyến phụ, tạo quiz AI là tùy chọn, chọn 1–30 câu từ chủ đề, mục tiêu và nguồn đã xác nhận. Câu trả lời tài khoản lưu theo tài khoản trên thiết bị; quiz khách được chấm riêng theo credential Redis và không ghi vào `Session.quiz` hay lịch sử công khai. Quiz khách ở phần tổng kết vẫn có thể dùng sau phiên ngoại tuyến hoặc kết thúc sớm, không cần mốc bắt đầu AI. Câu sai chỉ ra kiến thức cần ôn; kết quả cũ chỉ có điểm thì không dựng lại được câu sai.
- Nhật ký học tập hiển thị rõ số lần xao nhãng, tỷ lệ thời gian tập trung trên thời gian thực tế đã học, loại trừ giải lao và điểm câu hỏi riêng biệt. Nhãn mức tập trung dùng các ngưỡng mô tả 80% và 50%; không phải chẩn đoán hay điểm học lực chung.
- Kinh nghiệm toa (XP) ghi nhận nỗ lực: 60 giây học hợp lệ = 1 XP, phần giây lẻ cộng dồn. Điểm câu hỏi không đổi XP; thời gian rời phiên không tạo XP.
- Lịch sử chuyến đi tự động liệt kê các phiên đã lưu, kể cả phần tóm tắt phiên khách sau khi đồng bộ lên máy chủ. Bản ghi ẩn danh gồm mã chuyến và mã người học dạng HMAC, tóm tắt mục tiêu tối đa 200 ký tự, chủ đề, thời điểm bắt đầu/kết thúc, thời gian học và giải lao, loại thiết bị tổng quát, số lần xao nhãng và điểm phiên được phép lưu. Tóm tắt được hiển thị tự động, vì vậy không đưa thông tin riêng tư vào mục tiêu. Lịch sử không gửi email, mã tài khoản, tài liệu hoặc phản hồi chi tiết thành các trường riêng. Bộ AI khách, khóa đáp án và phản hồi riêng tư lưu trong Redis theo credential bảy ngày, không nằm trong bản ghi lịch sử. Có phân trang và CSV tối đa 10.000 phiên đã lưu.
- Web Locks ngăn hai cửa sổ cùng sửa trạng thái cá nhân. Có xuất bản sao dữ liệu riêng.
- Cảnh tàu dùng SVG 2D với nhiều lớp parallax, bánh xe, hơi nước và nhịp chuyển động nhẹ; dừng trong giải lao, khi rời phiên, ngoài viewport hoặc ẩn cửa sổ và hỗ trợ reduced motion. Bản đồ tự đưa vùng quanh tàu vào khung khi mở, giữ nguyên hình học tuyến và lớp sương che vùng chưa tới. Bộ đọc tài liệu tải riêng; ứng dụng không cần WebGL hay Three.js.
- Danh tính tài khoản được giữ khi mở lại offline, yêu cầu đăng nhập lại trước khi đồng bộ nếu hết phiên. Đăng xuất dọn phiên đăng nhập kể cả khi mất mạng; dữ liệu hành trình vẫn tách theo chủ sở hữu. Dữ liệu lưu bị hỏng có màn hình xuất bản sao và khôi phục, không âm thầm ghi đè.

## Giới hạn phát hành cần biết

Ứng dụng hỗ trợ học cá nhân không cần tài khoản và chuyến học có kế hoạch cho nhóm tối đa 6 người. Tạo/chia sẻ chuyến và đồng bộ dữ liệu tài khoản cần đăng nhập cùng backend. AI tài khoản và AI khách đều cần backend trực tuyến, `GEMINI_API_KEY`, và hạn mức còn dùng; AI khách không cần tài khoản nhưng cần Redis để cấp credential, kiểm tra quota và giữ trạng thái riêng tư bảy ngày. Chưa có học nhóm trực tiếp, và bản desktop không tự đóng ứng dụng khác trên máy.

Backend dùng aggregate JSONB có row lock để quyết toán thành viên và ledger trong giao dịch. Thiết kế này phù hợp pilot nhóm nhỏ; cần phân tách aggregate theo journey và lập chính sách lưu/xóa dữ liệu trước khi mở rộng quy mô. Kiểm chứng thời gian dựa trên tự khai báo, không phải chống gian lận tuyệt đối. Quiz AI live cần key; Windows installer cần thử trên máy Windows thật.

Ghi chú học tập lưu riêng theo chuyến. Khi không nhập tệp, ghi chú cùng chủ đề/mục tiêu là nguồn tạo câu hỏi. Khi có tệp, câu hỏi dựa trên nội dung tệp đã xác nhận; sửa hoặc xóa ghi chú không sửa nguồn tài liệu.

Khi chưa có tài liệu hoặc nội dung dán, mục “Nhờ AI soạn” gửi yêu cầu tự do qua backend tới Gemini bằng khóa Google AI Studio. Người học chọn nội dung và hình thức mong muốn, sửa và xem lại bản ôn tập, rồi xác nhận mới dùng làm nguồn của chuyến học. Bản chưa xác nhận không được tự dùng tạo quiz. Đọc ảnh/PDF bằng AI có thể phục dựng chỗ mờ theo chữ nhìn thấy và ngữ cảnh; đánh dấu `[suy luận: ...]` cho phần đề xuất, `[không rõ]` cho chỗ thiếu căn cứ, không coi phần đoán là bản chép đã xác minh.
