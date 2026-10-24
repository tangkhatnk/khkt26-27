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

`npm run preview` chỉ phục vụ giao diện đã build trong `dist/`. Khi không cấu hình API riêng, các yêu cầu `/api/*` được chuyển tới `127.0.0.1:3000`. Để đăng nhập, đồng bộ và dùng AI trên preview, khởi động API trong một terminal riêng và giữ nó chạy:

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

`GEMINI_API_KEY` chỉ nằm trên backend. Không có key thì tính năng tạo câu hỏi AI chưa dùng được; phiên học vẫn lưu bình thường, không thay bằng bộ câu hỏi có sẵn.

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

## Quy tắc đã triển khai

- Thời gian gợi ý 15/25/45/60 phút và ô tùy chỉnh 1–240 phút tại ga chính lẫn tấm vé; chặn số thập phân và giá trị ngoài giới hạn.
- Trang chủ chọn chủ đề, nhập nhanh mục tiêu và thời gian; bước chuẩn bị hiển thị vé tàu cùng lộ trình phiên học. Mục “Sửa vé” là thẻ chỉnh sửa nổi bật với biểu tượng, nhãn và nút mở/thu gọn; chủ đề đã chọn ở ga chính được giữ trên vé và khi bắt đầu phiên. Lịch nhiều lần nghỉ hiện tổng thời lượng, số chặng học và số lần nghỉ; mở “Xem lịch từng chặng” để xem thứ tự chi tiết.
- Vé có dải màu, cuống xé và barcode dọc theo kiểu vé tàu, dùng bảng màu kem/xanh lá/cam đất của Viễn Du. Máy chủ cấp trước mã ẩn danh cho ID chuyến; khi lưu, lịch sử dùng lại đúng mã đó. Cấp mã không ghi lịch sử hay cộng tiến độ; chưa có mạng vẫn bắt đầu học bình thường.
- Trang chuẩn bị chia nội dung ôn tập và lộ trình khởi hành thành hai cột trên màn hình rộng, một cột trên điện thoại. Ba cách chuẩn bị gồm dán kiến thức/ghi chú, tải tệp và nhờ AI soạn từ yêu cầu bằng chữ. Ô ghi chú có ví dụ, phân biệt nội dung kiến thức với mục tiêu chuyến đi.
- Nút bắt đầu/tiếp tục yêu cầu toàn màn hình ngay từ thao tác bấm. Trình duyệt từ chối hoặc chưa hỗ trợ vẫn cho học; có nút bật/thoát trong phiên. Escape không bị tự bật lại. Rời trang bấm giờ hoặc kết thúc phiên sẽ thoát toàn màn hình do phiên đó mở; các quy tắc ghi nhận xao nhãng giữ nguyên.
- Đồng hồ dạng flip clock hiển thị mặt trên của số mới và mặt dưới của số cũ trong lúc lật; nửa trên lật ra rồi nửa dưới lật vào, với phần chữ được cắt đúng theo từng nửa. Đồng hồ đọc được bằng trình đọc màn hình và giữ đúng số phút trên 99. Cảnh phiên học dùng đồng quê thoáng, ít mây. Đầu tàu giữ ở giữa trong phiên học. Trong 12 giây trước giờ giải lao, trạm nghỉ đi vào từ phía phải và đến giữa khi bắt đầu nghỉ; khi học tiếp, trạm rời sang trái rồi biến mất. Tổng kết hiện ga cuối ở phía cuối tuyến; phiên kết thúc sớm dùng nhãn điểm dừng riêng; chuyển động được giảm/tắt theo lựa chọn giảm hoạt ảnh, trạng thái rời phiên và khả năng nhìn thấy cảnh.
- Ga chính và trang bản đồ dùng bản đồ 2D; trong phiên học dùng cảnh tàu 2D. Bản đồ nhìn từ trên xuống có đầu tàu, số toa theo thành viên thực tế, chọn toa xem tên/màu, phóng to/thu nhỏ, tìm tàu và hai tuyến núi/bờ biển. Góc nhìn không thay đổi đồng hồ. Vị trí cá nhân có xem trước thời gian tập trung của phiên đang mở, giữ phần đã học chờ đồng bộ; bản đồ đoàn chỉ mở vùng từ tiến độ được máy chủ xác nhận để giữ đúng cap đóng góp mỗi ngày.
- Có giao diện sáng/tối, ban đầu theo hệ thống; nút đổi xuất hiện ở thanh trên và trong phiên toàn màn hình. Lựa chọn được lưu riêng theo thiết bị, không thay đổi tài khoản, dữ liệu học hay trạng thái phiên.
- Cảnh báo đồng hồ chạy lùi lấy mốc giờ hiện tại khi kiểm tra; mốc cập nhật giao diện cũ hơn checkpoint không tạo cảnh báo giả. Khi giờ thiết bị thực sự chạy lùi, phiên vẫn được giữ và chặn kết thúc cho đến khi giờ hợp lệ.
- Lịch sử dùng bảng gọn trên màn hình rộng và thẻ trên điện thoại; mã chuyến giữ liền dòng, thời lượng học/tổng chuyến/tập trung/giải lao có nhãn riêng, điểm quiz thành badge. Mục Chi tiết giữ mã người thử, thiết bị, xao nhãng và thời điểm chính xác theo giờ địa phương của người xem.
- 12 chủ đề học, gồm khoa học, ngôn ngữ, lịch sử, nghệ thuật và kỹ năng học; seed chỉ tạo chủ đề, không tạo bộ câu hỏi có sẵn.
- Cá nhân, toa với 4 màu/3 trang trí, 5 trạm, ngã rẽ có bình chọn 24 giờ.
- Nhóm riêng tối đa 6 thành viên; tạo, mời, thu hồi, gia nhập, rời và chuyển quyền.
- Phiên học không có nút tạm nghỉ hoặc nút tự phân loại xao nhãng. Mỗi lần rời cửa sổ/ẩn tab/chuyển sang mục khác được tính một lần xao nhãng; các sự kiện cùng một lần rời không bị tính trùng. Đồng hồ vẫn chạy liên tục tới hạn, kể cả khi rời phiên hoặc tải lại. Quay lại tiếp tục ngay, không chờ 120 giây. Phiên cũ đang tạm nghỉ/chờ được chuyển sang cơ chế này và giữ phần học đã lưu.
- Phần học hợp lệ loại trừ thời gian rời phiên, được lưu cả khi kết thúc sớm. Hạn kết thúc phiên dựa trên thời gian bắt đầu và thời lượng, kể cả khi trình duyệt bị treo ở nền.
- Bản đồ 2D phủ sương lên địa hình, đường và trạm chưa khám phá; tên và câu chuyện của trạm chưa mở được giấu. Học hợp lệ mở dần hành lang quanh tàu, giữ đường đã đi và trạm đã đến theo tiến độ lưu; thời gian xao nhãng không mở thêm bản đồ. Trong phiên có xem trước phần học chưa lưu. Sương xanh lam/trắng dùng các trường mật độ nhiễu, khối mây loang và xoáy mềm, chuyển động chậm trên nền xanh ngọc; địa hình chưa mở chỉ hiện mờ dưới sương, tên trạm chưa mở vẫn được giấu; vùng đã mở giữ nguyên trạng thái. Khi khám phá hết, toàn bộ sương được xóa. Đường ray luôn liền mạch dưới sương. Trong phiên, đầu tàu giữ góc nhìn ở giữa, cảnh vật 2D chuyển động quanh tàu.
- Cho chọn mọi loại tệp, nhiều tệp cùng lúc. Word DOCX, PowerPoint PPTX, Excel XLSX/XLS, PDF, OpenDocument và các định dạng văn bản phổ biến được đọc ngay trên thiết bị. Giới hạn 32 MiB/tệp, 10 tệp/chuyến và tổng 50.000 ký tự. PDF quét và ảnh PNG/JPG/WebP/BMP được nhận diện bằng OCR tiếng Việt/Anh ngay trên thiết bị; PDF có chữ giữ phần văn bản gốc và chỉ OCR trang ít chữ. Giới hạn ảnh 20 megapixel, đọc tối đa 20 trang PDF và OCR tối đa 20 trang trong 120 giây mỗi tệp. Kết quả một phần ghi rõ giới hạn đã chạm. Có tiến độ, số trang và nút hủy đọc; rời tấm vé/đổi tài khoản hủy tác vụ và không nhập nội dung dở dang. Định dạng chưa có bộ đọc (ví dụ DOC/PPT cũ, video) được ghi tên và báo chưa trích xuất; không đưa dữ liệu nhị phân vào quiz. Worker PDF/OCR, WASM và dữ liệu ngôn ngữ dùng file cùng origin, không tải từ CDN; desktop có các tệp trong bundle.
- Trong mục Tài liệu học tập, “Ưu tiên dùng AI để đọc PDF/ảnh” dành cho ảnh quét, chữ viết tay hoặc tệp khó đọc; chọn ô này chưa gửi tệp. Để trống để thử đọc trên thiết bị trước: bấm “Đọc bằng AI” để gửi đúng tệp PDF/PNG/JPG/WebP qua backend tới Google Gemini. Tệp gốc chỉ giữ trong bộ nhớ trình duyệt. Bản chép AI, OCR cục bộ và kết quả bị cắt phải được người học sửa/xác nhận trước khi tạo câu hỏi. Nguồn từng tệp lưu riêng với ghi chú; xóa ghi chú không xóa nguồn. Thiếu nguồn hay chưa xác nhận sẽ chặn tạo câu hỏi thay vì dùng câu hỏi theo chủ đề.
- Trạm dừng chân được chọn trước phiên: tối đa 10 lượt, mỗi lượt 1–30 phút, ít hơn số phút học. Giải lao tự chia đều và tự tiếp tục. Ví dụ 15 phút học và 1 lượt nghỉ 5 phút tạo lịch học 7:30 → nghỉ 5:00 → học 7:30. Đồng hồ hiển thị thời gian còn lại của chặng hiện tại, kèm số chặng và lượt nghỉ sắp tới; không đếm gộp cả hai chặng học. Tổng thời lượng cộng thêm giải lao; thời gian nghỉ không tạo XP hay xao nhãng và được ghi riêng trong nhật ký/lịch sử. Rời máy trong giờ học vẫn tính xao nhãng; rời trong giải lao rồi tiếp tục vắng khi học trở lại được tính một lần.
- Hàng đợi offline có mã phiên cố định; retry không cấp trùng. Máy chủ kiểm tra thời gian, chồng phiên, quyền đoàn, cap 60 phút/ngày theo múi giờ đoàn, giữ phần lẻ và dư tại đích.
- Đoàn chỉ thấy toa và tiến độ chung, không có mục tiêu, tài liệu, quiz hoặc log gián đoạn của người khác.
- Tạo câu hỏi bằng AI là tùy chọn, chọn 1–30 câu từ chủ đề, mục tiêu và tài liệu của phiên. Câu trả lời đang làm được lưu theo tài khoản trên thiết bị. Kết quả và giải thích từng câu được chấm trên máy chủ và ghi một lần. Câu sai chỉ ra các kiến thức cần ôn trong bộ câu đã làm; có lựa chọn mở một phiên mới để ôn lại, giữ tài liệu và chủ đề. Kết quả cũ chỉ có điểm không thể dựng lại các câu sai.
- Nhật ký học tập hiển thị rõ số lần xao nhãng, tỷ lệ thời gian tập trung trên thời gian thực tế đã học, loại trừ giải lao và điểm câu hỏi riêng biệt. Nhãn mức tập trung dùng các ngưỡng mô tả 80% và 50%; không phải chẩn đoán hay điểm học lực chung.
- Kinh nghiệm toa (XP) ghi nhận nỗ lực: 60 giây học hợp lệ = 1 XP, phần giây lẻ cộng dồn. Điểm câu hỏi không đổi XP; thời gian rời phiên không tạo XP.
- Mục Kết quả tester chỉ liệt kê phiên mà người học đã đăng nhập chủ động công khai từ tổng kết. Có thể cập nhật mức hoàn thành tự đánh giá hoặc rút từng phiên khỏi bảng công khai. Kết quả ẩn danh gồm mã chuyến và mã tester dạng HMAC, chủ đề, thời điểm bắt đầu/kết thúc, thời gian học và giải lao, loại thiết bị tổng quát, số lần xao nhãng và điểm quiz sau khi chấm. Loại PC/iOS/Android/iPad/Tablet được ghi lúc bắt đầu phiên; phiên cũ không có loại thiết bị hiển thị “Chưa ghi nhận”. Không lưu chuỗi user-agent hoặc thông tin phần cứng chi tiết. Phiên riêng tư, phiên khách và phiên chưa đồng bộ không xuất hiện công khai. Thời gian tập trung được tính từ các khoảng học hợp lệ; điểm quiz chỉ do máy chủ chấm. Mức đủ giờ từ đồng hồ máy chủ được trình bày riêng với mức hoàn thành do người học tự đánh giá. Mục tiêu riêng, email, mã tài khoản, tên tài khoản, tài liệu và câu trả lời chi tiết vẫn riêng tư. Có phân trang và CSV tối đa 10.000 phiên đã chia sẻ.
- Web Locks ngăn hai cửa sổ cùng sửa trạng thái cá nhân. Có xuất bản sao dữ liệu riêng.
- Cảnh tàu dùng SVG 2D với nhiều lớp parallax, bánh xe, hơi nước và nhịp chuyển động nhẹ; dừng trong giải lao, khi rời phiên, ngoài viewport hoặc ẩn cửa sổ và hỗ trợ reduced motion. Bản đồ tự đưa vùng quanh tàu vào khung khi mở, giữ nguyên hình học tuyến và lớp sương che vùng chưa tới. Bộ đọc tài liệu tải riêng; ứng dụng không cần WebGL hay Three.js.
- Danh tính tài khoản được giữ khi mở lại offline, yêu cầu đăng nhập lại trước khi đồng bộ nếu hết phiên. Đăng xuất dọn phiên đăng nhập kể cả khi mất mạng; dữ liệu hành trình vẫn tách theo chủ sở hữu. Dữ liệu lưu bị hỏng có màn hình xuất bản sao và khôi phục, không âm thầm ghi đè.

## Giới hạn phát hành cần biết

Ứng dụng hiện hỗ trợ học cá nhân, nhóm bất đồng bộ và câu hỏi AI; câu hỏi AI cần `GEMINI_API_KEY` trên backend. Đồng bộ tài khoản và nhóm cần backend hoạt động. Chưa có học nhóm trực tiếp, và bản desktop không tự đóng ứng dụng khác trên máy.

Backend dùng aggregate JSONB có row lock để quyết toán thành viên và ledger trong giao dịch. Thiết kế này phù hợp pilot nhóm nhỏ; cần phân tách aggregate theo journey và lập chính sách lưu/xóa dữ liệu trước khi mở rộng quy mô. Kiểm chứng thời gian dựa trên tự khai báo, không phải chống gian lận tuyệt đối. Quiz AI live cần key; Windows installer cần thử trên máy Windows thật.

Ghi chú học tập lưu riêng theo chuyến. Khi không nhập tệp, ghi chú cùng chủ đề/mục tiêu là nguồn tạo câu hỏi. Khi có tệp, câu hỏi dựa trên nội dung tệp đã xác nhận; sửa hoặc xóa ghi chú không sửa nguồn tài liệu.

Khi chưa có tài liệu hoặc nội dung dán, mục “Nhờ AI soạn” gửi yêu cầu qua backend tới Gemini bằng khóa Google AI Studio. Bản ôn tập có kiến thức chính, giải thích, ví dụ, tự luyện và điểm cần kiểm chứng; người học có thể sửa, tải tệp `.txt`, rồi xác nhận làm nguồn của chuyến học. Bản chưa xác nhận không được tự dùng tạo quiz. Đọc ảnh/PDF bằng AI có thể phục dựng chỗ mờ theo chữ nhìn thấy và ngữ cảnh; đánh dấu `[suy luận: ...]` cho phần đề xuất, `[không rõ]` cho chỗ thiếu căn cứ, không coi phần đoán là bản chép đã xác minh.
