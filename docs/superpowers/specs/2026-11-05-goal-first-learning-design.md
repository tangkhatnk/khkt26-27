# Luồng học bắt đầu từ mục tiêu

Ngày: 2026-11-05. Liên quan: #80. Mốc khảo sát mã: `033a996385cdb184c7fbed95fba44d06faec4124`.

Thiết kế này triển khai yêu cầu mới và chín ảnh tham chiếu của người duy trì. Các lựa chọn chi tiết do người thiết kế đề xuất được ghi riêng; chúng không phải kết quả nghiên cứu hay phát biểu bổ sung của người duy trì.

## Mục đích

Viễn Du giúp người học xác định điều cần đạt trước khi học, chuẩn bị nội dung, tập trung, truy hồi kiến thức và xem lại kết quả. Trang chính hiện đặt danh mục bài có sẵn ở trung tâm, giấu mục tiêu riêng trong phần thu gọn và đưa việc soạn nội dung sang trang chuẩn bị khác. Hướng mới lấy mục tiêu do người học nhập làm điểm bắt đầu. AI có thể chia mục tiêu thành các bước cụ thể; người học giữ quyền chỉnh sửa và chọn thời lượng.

Giữ cốt lõi: **đặt mục tiêu → cung cấp nội dung/tài liệu → đếm giờ → truy hồi kiến thức → đánh giá**. Nhật ký riêng, lịch sử và báo cáo tiếp tục tồn tại. Không dùng số phút học để khẳng định mức độ thành thạo.

## Cách tổ chức được chọn

Một không gian học thống nhất hiển thị mục tiêu, lộ trình cá nhân và nội dung của bước đang chọn. Bố cục bước học theo ảnh 7: nội dung và công cụ soạn ở vùng chính bên trái; mục tiêu, thời lượng, nghỉ và nút bắt đầu ở cột phải. Trên màn hình nhỏ, các vùng xếp thành một trình tự đọc và chỉ có một hành động bắt đầu chính. Không còn nút tiếp tục sang một trang chuẩn bị riêng như ảnh 8.

Hai cách đã cân nhắc:

- Giữ danh mục bài có sẵn rồi mở rộng trang chuẩn bị: giữ nhiều mã hiện có, nhưng không đáp ứng yêu cầu lấy mục tiêu riêng làm trung tâm.
- Dùng các trang riêng cho mục tiêu, tài liệu và thời lượng: tách thao tác rõ, nhưng tiếp tục vấn đề chuyển trang mà người duy trì đã chỉ ra trong ảnh 7–8.

Chọn không gian thống nhất theo yêu cầu ghép composer vào trang học. Tiếp tục dùng React/Vite, thành phần xử lý tài liệu hiện có, bộ đếm giờ và các hợp đồng phiên học. Không thêm bộ UI lớn, thư viện lật trang hay ứng dụng đồng hồ ngoài.

## Khảo sát và hướng dẫn lần đầu

- Người mới đi qua một khảo sát ngắn rồi hướng dẫn tương tác trước khi vào chế độ sử dụng thông thường.
- Khảo sát hỏi mục tiêu, môn/chủ đề và thời lượng muốn học mỗi buổi. Cấp học và mức tự tin là thông tin tùy chọn; luôn có lựa chọn phù hợp cho người ngoài các lớp phổ thông. Không hỏi tên thật, email hoặc ngày sinh.
- Câu trả lời điền vào các ô thật của không gian học. Mục tiêu, nhãn cấp/lớp và thời lượng được lưu local theo chủ sở hữu; cấp/lớp có thể gửi cùng yêu cầu lập kế hoạch khi người học chủ ý gọi AI. Mức tự tin chỉ dùng để gợi ý local, không gửi API. Mục tiêu không bị thay bằng một bài mẫu khi kết thúc khảo sát.
- Hướng dẫn yêu cầu thao tác với các vùng thật: xem/sửa mục tiêu; chọn cách cung cấp nội dung hoặc xác nhận chưa có tài liệu; điều chỉnh thời lượng và nhận biết bước tự kiểm tra sau phiên. Không chỉ hiển thị một đoạn mô tả.
- Luồng ngắn, có bước trước/sau, thông báo tiến độ và nhãn rõ. Các câu hỏi tùy chọn và thao tác thêm tài liệu có thể bỏ qua một cách tường minh; không mặc định bỏ toàn bộ khảo sát/hướng dẫn.
- Không tự gọi AI, gửi tài liệu hoặc bắt đầu đồng hồ trong hướng dẫn. Hoàn thành hướng dẫn được khi offline. Các lựa chọn gửi AI vẫn cần hành động có chủ ý.
- Lưu phiên bản và tiến độ hướng dẫn theo chủ sở hữu trên thiết bị; tải lại tiếp tục từ bước đang dở. Có thể mở lại từ ứng dụng và sửa thông tin đã chọn.
- Một phiên học đang chạy được ưu tiên khôi phục trước. Không phủ khảo sát lên đồng hồ đang hoạt động hoặc làm mất phiên cũ.
- Dùng điều hướng bàn phím, tiêu điểm rõ, vùng thông báo phù hợp và giảm chuyển động theo tùy chọn hệ thống.

## Mục tiêu và lộ trình cá nhân

- Trạng thái chưa có kế hoạch mở đầu bằng câu hỏi người học muốn đạt điều gì, ô nhập mục tiêu và môn/chủ đề. Không hiển thị các bài soạn sẵn như chương trình bắt buộc.
- Người học có thể nhờ AI chia mục tiêu thành kế hoạch hoặc chuẩn bị trực tiếp một buổi học từ mục tiêu đã nhập khi chưa dùng AI.
- `topic` trong yêu cầu lập kế hoạch là nhãn môn/chủ đề dễ đọc cho người học; mã môn hiện có tiếp tục được lưu riêng cho phiên và báo cáo. `level` là chuỗi tùy chọn 1–100 ký tự sau trim để ghi cấp/lớp theo cách người học hiểu; được lưu local và chỉ gửi cùng yêu cầu AI có chủ ý. Không thu ngày sinh. Mức tự tin nếu dùng trong khảo sát chỉ là gợi ý local, không gửi thành trường API.
- AI trả về dữ liệu có cấu trúc được kiểm tra, gồm tiêu đề và các bước có mục tiêu cụ thể, hành động học, kết quả dự kiến và gợi ý tự kiểm tra. Nội dung phải phản ánh mục tiêu và thông tin người học thực sự cung cấp.
- Lựa chọn thiết kế: kế hoạch AI có 3–8 bước hữu hạn. Người học xem và chỉnh mục tiêu/thời lượng của bước trước khi dùng. Thời lượng ưu tiên là thời lượng mỗi buổi, không phải cam kết hoàn thành toàn bộ mục tiêu trong một phiên.
- Nhãn thể hiện đây là đề xuất của AI. Một kế hoạch không tự trở thành tài liệu nguồn đã kiểm tra; các phần kiến thức do AI soạn vẫn cần quy trình xem lại hiện có trước khi dùng tạo quiz.
- Có thể chọn bước, sửa kế hoạch và tiếp tục bản đang dở. Thay mục tiêu hoặc chọn bước khác không âm thầm ghi đè nội dung đang sửa; lưu hoặc xác nhận bỏ thay đổi khi thực sự cần.
- Lưu mục tiêu, kế hoạch, bước được chọn, thời lượng, bản nháp nội dung và liên kết phiên học theo chủ sở hữu. Đổi tài khoản không trộn dữ liệu riêng hoặc nhận kết quả từ yêu cầu của chủ sở hữu trước.
- Kế hoạch/khảo sát mới bị hỏng phải được khôi phục riêng, không xóa lịch sử hoặc bản ghi phiên học cũ.
- Tiến độ phân biệt đã học và đã tự kiểm tra. Kết thúc sớm, bỏ quiz hoặc chỉ có phút tập trung không được trình bày thành bằng chứng đã nắm kiến thức.

## Thời lượng linh hoạt

Giữ cảm giác điều chỉnh của thanh trượt trong ảnh 3, bổ sung ô nhập số và các mốc nhanh. **Lựa chọn thiết kế: dùng khoảng hợp lệ hiện có 1–240 phút**, theo bước một phút; đây là hợp đồng đã có trong DurationPicker, API phiên học và AI khách.

- Không áp dụng giới hạn 5–25 phút của luồng curated cho lựa chọn thủ công.
- Gợi ý AI hoặc lịch sử có nhãn gợi ý và không ghi đè thời lượng đã nhập.
- Giá trị 1, 45, 90 và 240 phút phải giữ nguyên qua chọn bước, soạn tài liệu, tải lại và bắt đầu phiên.
- Ô trống, không nguyên, không hữu hạn, 0 hoặc lớn hơn 240 có lỗi rõ và không cho bắt đầu. Không âm thầm ép về một giá trị khác.
- Giữ phép tính lịch nghỉ, thời gian tập trung, tổng thời lượng và điều kiện nghỉ hiện có. Tóm tắt tổng phải thay đổi đúng theo lựa chọn.
- Các mốc nhanh không được trở thành giới hạn của ô nhập.

## Nội dung học ngay tại bước đang chọn

Thay phần bài mẫu trong ảnh 7 bằng composer và phần xem trước hiện có: ghi nội dung, tải tài liệu/ảnh, trích xuất cục bộ/OCR, nhờ AI đọc, soạn bản ôn tập, tóm tắt nguồn đã xem và chuẩn bị bài tập. Cột bên phải hiển thị mục tiêu có thể sửa, thời lượng, nghỉ, số câu hỏi và hành động bắt đầu.

- Có thể sửa nội dung, xem bản trình bày, xác nhận nguồn, hủy xử lý và nhận lỗi ngay trong không gian này.
- Giữ worker PDF/OCR cùng nguồn, ngôn ngữ Việt/Anh, giới hạn tệp/trang và hủy yêu cầu.
- Phân biệt ghi chú, văn bản trích xuất, bản nháp AI và nguồn đã được người học kiểm tra.
- Không đưa nội dung chưa kiểm tra vào quiz. Sửa hoặc thay nguồn phải làm hết hiệu lực phần chuẩn bị AI không còn khớp.
- Mỗi bản nháp chuẩn bị có định danh phiên dự kiến ổn định. Không dùng một kết quả AI cho chủ sở hữu, mục tiêu, nguồn, số câu hoặc phiên khác.
- Các công cụ AI vẫn tìm và dùng được khi đã có nội dung riêng; không ẩn toàn bộ composer AI chỉ vì đã tải tài liệu. Khi nhận bản AI, người học chọn thêm hoặc thay nội dung sau khi xem lại; không âm thầm ghi đè ghi chú/nguồn hiện có. Giữ giới hạn tài liệu và làm hết hiệu lực quiz/bài tập không còn khớp nguồn.
- Bố cục tóm tắt ảnh 2 được thay bằng phần mục tiêu có thứ bậc rõ và một cụm thời lượng gọn trong cột thiết lập; tránh một khung quá rộng với các khoảng trống không phục vụ nội dung.

## Mọi công cụ AI dùng được cho khách

Đánh giá theo cả khả năng gọi API và khả năng sử dụng qua giao diện. Không coi một nhãn mới là bằng chứng công cụ hoạt động.

| Công cụ | Khách phải sử dụng được |
|---|---|
| Chia lộ trình từ mục tiêu | Gọi có chủ ý, xem/sửa kế hoạch, hủy và thử lại khi lỗi |
| Soạn bản ôn tập | Sinh bản nháp, xem/sửa, xác nhận dùng, tải xuống |
| Đọc tài liệu bằng AI | Chọn nội dung và xác nhận gửi, nhận văn bản để xem lại |
| Tóm tắt tài liệu | Tóm tắt nguồn đã kiểm tra, giữ kết quả riêng |
| Quiz | Chọn số câu, chuẩn bị trong lúc học khi đã bật, làm và chấm sau phiên, mở lại kết quả |
| Bài tập | Nhập đề hoặc tạo từ nguồn đã xem, liên kết phiên, xem lời giải sau điều kiện hoàn thành hiện có |

Giữ GuestAI riêng, giới hạn tốc độ/chi phí, quyền sở hữu, trạng thái không lưu cache công khai và đầu ra đã kiểm tra. Không yêu cầu tạo tài khoản để mở một trong các công cụ này. Lỗi mạng, hạn mức hoặc hết phiên AI phải được giải thích trực tiếp, không chuyển thành lời mời đăng ký để mở tính năng.

Quiz chuẩn bị nền cho khách hoặc tài khoản bắt đầu ở trạng thái tắt trong không gian mới. Người học bật riêng cho bản nháp/phiên và xác nhận rõ rằng nguồn sẽ được gửi cho AI; không tự bắt đầu chỉ vì trang bước học đã mở. Giữ nguyên cách diễn giải các lựa chọn đã lưu trong bản nháp cũ. Bộ câu hỏi phải dùng dữ liệu an toàn trên giao diện, không mang đáp án/lời giải xuống trước khi chấm. Hủy hoặc loại bỏ kết quả cũ khi đổi chủ sở hữu, nguồn, mục tiêu, số câu, phiên hoặc lựa chọn bỏ ôn tập. Giữ tách biệt điểm riêng của khách với `Session.quiz` và báo cáo công khai. Không gọi AI tự động trong khảo sát hoặc hướng dẫn lần đầu. Không nới điều kiện mở lời giải bài tập để làm bản demo dễ hơn.

Đường tạo kế hoạch mới dùng vai trò tutor và giới hạn/fallback hiện có. Hợp đồng đầu vào/đầu ra phải có giới hạn độ dài, số bước và thời lượng, xác minh ở máy chủ và phía nhận. Không đổi model/nhà cung cấp hoặc đưa khóa ra frontend.

### Hợp đồng API kế hoạch

Backend sở hữu các DTO TypeScript không phụ thuộc runtime trong `backend/src/studyPlanContracts.ts`; `backend/src/studyPlanSchemas.ts` kiểm tra và tái xuất đúng các kiểu `StudyPlanRequest`/`StudyPlanResponse`. Frontend chỉ nhập DTO; bộ kiểm tra trạng thái cục bộ phải khớp cùng các giới hạn.

- Account: `POST /api/v1/study-plans`; khách: `POST /api/v1/ai/guest/study-plans`. Hai đường dùng cùng provider và schema, giữ cơ chế xác thực tương ứng, giới hạn tốc độ và `Cache-Control: no-store`.
- Request strict, giới hạn body tối đa 256 KiB: `goal` chuỗi trim 3–500 ký tự; `topic` tùy chọn nhãn 1–100 ký tự; `level` tùy chọn chuỗi trim 1–100 ký tự; không có trường confidence. `preferredMinutes` số nguyên 1–240; `sourceText` tùy chọn có ít nhất 10 ký tự không trắng và tối đa 50.000 ký tự; `sourceFingerprint` tùy chọn SHA-256 hex 64 ký tự. Hai trường nguồn phải cùng có hoặc cùng vắng. Hash đúng byte UTF-8 của chuỗi nguồn được gửi, không trim hoặc biến đổi trước khi băm; máy chủ xác minh chuỗi đó.
- Response strict: `title` 3–120 ký tự; `steps` 3–8 phần tử, mỗi phần có `title` 3–120, `action` 3–400, `outcome` 3–400, `check` 3–400 và `sourceExcerpt` tùy chọn 5–500; `finalCheck` tùy chọn 3–500; `verificationNote` tùy chọn 3–500.
- Nếu có `sourceExcerpt`, đoạn đó phải là chuỗi con chính xác của nguồn gửi; khi không có nguồn, phải bỏ trường này. Kế hoạch luôn được gắn nhãn bản nháp AI chưa xác minh, kể cả khi trích đoạn khớp. Từ chối đầu ra không hợp lệ; fallback hữu hạn theo kiểu provider hiện có.
- `preferredMinutes` giúp chia phạm vi công việc; response không điều khiển đồng hồ. Thời lượng thật của mỗi bước do frontend giữ theo lựa chọn của người học, khởi tạo từ thời lượng ưu tiên và cho sửa trực tiếp.
- Backend không lưu kế hoạch vào AdventureState. Frontend tạo định danh kế hoạch/bước và lưu riêng theo chủ sở hữu; gắn phiên thực khi chuẩn bị/bắt đầu. Không thay hợp đồng study-guide để giả làm kế hoạch.
- Yêu cầu mới phải truyền hủy tới provider, có timeout hữu hạn và loại bỏ kết quả nếu ngữ cảnh đã đổi. Guest budget thêm thao tác `study-plan` ở vai trò tutor với ước tính có tính tới nguồn và fallback.
- Tương đương tính năng không yêu cầu mở công khai các endpoint legacy dùng document ID thuộc tài khoản hoặc đổi nhà cung cấp của chúng; khách dùng công cụ cùng mục đích từ nguồn cục bộ đã xem.

## Thay đa người dùng bằng tài liệu ôn tập

- Điều hướng chính gồm Mục tiêu/lộ trình cá nhân, Tài liệu ôn tập, Nhật ký, Lịch sử và Báo cáo.
- Thư viện tài liệu là dữ liệu riêng trên thiết bị theo chủ sở hữu; gồm nội dung đã soạn/nhập và tài liệu từ các phiên riêng có thể mở lại. Có tên nguồn, trạng thái đã xem, bản xem trước và hành động dùng cho bước học.
- Người mới có trạng thái trống với hành động tải tài liệu, ghi nội dung hoặc nhờ AI soạn. Không thay mục Học cùng bạn bằng một trang trống chỉ có tiêu đề.
- Không còn tạo nhóm, tham gia, lời mời, danh sách thành viên, sẵn sàng chung, chuyển chủ nhóm hoặc biểu quyết ở các luồng dùng bình thường, trang chuẩn bị, phím tắt và URL giao diện cũ.
- URL `?view=group` cũ mở thư viện tài liệu ôn tập; alias bài học/vé cũ không được mở luồng khởi chạy bài curated mới. Hồ sơ bài cũ chỉ đọc được từ lịch sử.
- Các API cho phép tạo/tham gia/mời hoặc khởi chạy hoạt động nhóm mới phải từ chối bằng hợp đồng nghỉ tính năng rõ ràng; không chỉ giấu thanh điều hướng. Vẫn giữ xác thực và quyền sở hữu.
- Giữ bản ghi nhóm/phiên cũ, lịch sử, các phép đọc có quyền phù hợp và đường hoàn tất/settle phiên đã chạy. Các thao tác kết thúc/rời/hủy cần thiết để thu hồi trạng thái cũ được duy trì trong phạm vi tương thích.
- Không xóa hàng dữ liệu, đổi chủ phiên, tái ghi điểm hoặc thay dữ liệu nhóm bằng dữ liệu cá nhân.
- Bộ đếm giờ cá nhân, lưu phiên, xuất dữ liệu, quản trị và báo cáo giữ hợp đồng hiện có. Không thay đổi aggregate hoặc schema DB như tác dụng phụ.

Hợp đồng nghỉ tính năng: các mutation tạo/ghép toa, tạo nhóm/chuyến, mời/nhận lời mời/thu hồi lời mời, sẵn sàng, chuyển chủ, biểu quyết và khởi hành mới trả HTTP 410 với mã `feature-retired` sau xác thực hiện có. Giữ `/adventure/leave` để thoát trạng thái thành viên cũ; giữ hủy chuyến đang chờ của chính chủ như thao tác thu hồi tương thích. `/adventure/trip/start` chỉ được phát lại cho đúng thành viên đã `bound`/`completed`, cùng nhóm và `sessionId`, khi bản ghi chưa bị gỡ; không bind thêm người hoặc tạo mốc mới. Phiên đồng bộ phát lại mốc khởi hành đã lưu; nhánh legacy chỉ trả `{sessionId}` hiện có, không dựng mốc giả. Phiên sai chủ, sai ID hoặc bị tombstone không được phát lại. Giữ `/adventure/sessions` và settlement để hoàn tất phiên cũ, cùng các phép đọc/quiz/lịch sử/báo cáo có quyền hiện có. Các ngoại lệ tương thích không xuất hiện thành tính năng nhóm trong UI mới.

## Đồng hồ tập trung

Lấy ảnh 5 làm định hướng: nền phẳng yên tĩnh, hai ô phút/giây lớn ở trung tâm và mục tiêu ngắn phía trên. Không giữ các lớp khung, mã phiên, lời động viên, mascot và thẻ tiến độ luôn hiện như ảnh 4/6.

- Hiển thị trạng thái học/nghỉ/rời phiên hoặc kết nối khi có ý nghĩa; không dùng phần trăm lớn và nội dung lặp lại để lấp màn hình.
- Hành động kết thúc và lưu phiên, toàn màn hình, giao diện sáng/tối và mở tài liệu có thể tìm và thao tác bằng bàn phím/cảm ứng. Các chi tiết còn lại mở khi cần.
- Khi tài liệu đóng, đồng hồ là điểm nhìn chính. Khi mở tài liệu, văn bản đọc được và không che hành động cần thiết.
- Giá trị đến 240:00 không tràn trên màn hình 390px. Có phương án giảm chuyển động; không buộc lật số liên tục.
- Giữ nguyên đồng hồ thực, nghỉ theo lịch, tính xao nhãng, sự kiện rời phiên, khôi phục, lệch đồng hồ thiết bị, lưu phiên và điều kiện kết thúc. Thay trình bày không phải thay luật tính thời gian.

## Nhật ký hai trang

Lựa chọn thiết kế: mỗi phiên là một trang giấy, thứ tự phiên mới nhất trước. Màn hình rộng mở hai trang cạnh nhau với gáy sổ, ngày và số trang; màn hình nhỏ đọc một trang trong cùng chuỗi phân trang. Có nút trước/sau, trạng thái đầu/cuối và điều hướng bàn phím. Không tải tất cả phiên thành danh sách dài như ảnh 9.

- Mỗi trang có mục tiêu, môn, ngày, phút tập trung và kết quả tự kiểm tra nếu đã có. Tóm tắt xác định từ dữ liệu đã ghi, khoảng tối đa 220 ký tự; không tự sinh kết luận về mức nắm kiến thức.
- Mục tiêu dài được xuống dòng hợp lý. Có nút mở toàn bộ phiên/ghi chú/câu trả lời, để giới hạn tóm tắt không làm mất dữ liệu.
- Điểm AI riêng, điểm đã hiệu chỉnh và kết quả curated cũ phải giữ đúng nguồn, nhãn và quyền riêng tư.
- Trạng thái sổ trống có hướng dẫn hành động; số phiên lẻ có trang đối diện phù hợp. Tải lại hoặc đổi kích thước không đưa người học tới chỉ số trang không tồn tại.
- Tôn trọng giảm chuyển động, tiêu điểm và thông báo đổi trang; hiệu ứng lật không cản thao tác hoặc che dữ liệu.
- Nhật ký không lấy nội dung từ lịch sử công khai. Lịch sử và báo cáo tiếp tục mở được.

## Ma trận chín ảnh

| Ảnh | Kết quả phải quan sát được |
|---|---|
| 1 | Mục tiêu riêng rõ ràng; thời lượng tự chọn không bị ép theo bài mẫu |
| 2 | Tóm tắt/thiết lập gọn, thứ bậc và khoảng cách có chủ đích trong trang thống nhất |
| 3 | Thanh trượt quen thuộc cùng ô nhập số và mốc nhanh 1–240 phút |
| 4 | Màn hình tập trung yên tĩnh, đồng hồ chiếm vai trò chính |
| 5 | Hai ô thời gian lớn, nền phẳng, công cụ tối thiểu dễ tìm |
| 6 | Bỏ thẻ mascot/tiến độ lớn luôn hiện; thông tin thực vẫn có khi cần |
| 7 | Composer và nguồn bên trái; mục tiêu/thời gian/bắt đầu bên phải |
| 8 | Không cần chuyển sang trang chuẩn bị riêng để soạn nội dung |
| 9 | Sổ riêng có hai trang trên desktop, phân trang đọc được trên mobile |

## Bằng chứng chấp nhận

Toàn bộ code đi qua nhánh ngắn hạn, PR, review/CI và merge theo AGENTS.md; không sửa AGENTS.md. Không dùng Microsoft Edge hoặc hồ sơ trình duyệt của người dùng.

- Hành vi: người khách mới hoàn tất khảo sát và thao tác hướng dẫn; đặt mục tiêu riêng; nhận/sửa kế hoạch; nhập tài liệu ngay ở bước học; chọn thời gian ngoài 5–25; học; truy hồi; đánh giá; mở lại nhật ký và dữ liệu sau tải lại.
- AI: kiểm chứng từng hàng trong bảng công cụ, cả thành công, lỗi/hủy và yêu cầu cũ hết hiệu lực. Bằng chứng mock chỉ chứng minh hợp đồng; xác minh provider thực được ghi riêng, có giới hạn và dùng dữ liệu tổng hợp.
- Tương thích: dữ liệu curated/nhóm cũ vẫn đọc được, phiên cũ đang chạy hoàn tất an toàn; không có đường tạo/tham gia nhóm mới ở UI hay API; không đổi quy tắc thời gian hoặc riêng tư.
- Trực quan: xem thực tế khoảng 1440, 768 và 390px; sáng/tối; trống/có dữ liệu; mục tiêu và nội dung tiếng Việt dài; đang tải/lỗi/vô hiệu; hai trang cuối và một trang lẻ. Không coi TypeScript hoặc unit test là bằng chứng hình thức giao diện.
- Kiểm tra phù hợp: lint, typecheck, web tests/build; backend generate/typecheck/tests/build cho API mới/nghỉ nhóm; desktop typecheck/tests cho bundle dùng chung. CI phải xanh trên chính head cuối cùng được duyệt.
- Review cuối bao gồm toàn bộ diff, hợp đồng API, bằng chứng regression và các trạng thái giao diện đã render. Chỉ xác nhận hoàn thành khi mọi yêu cầu trên có bằng chứng hiện tại.

## Ngoài phạm vi

Không tiến hành nghiên cứu hiệu quả học tập mới, giả lập người thật, thay corpus OCR, thay model, nâng dependency, đổi quy tắc XP, nới auth/ownership, xóa lịch sử hoặc viết lại aggregate DB. #72 tiếp tục là nghiên cứu riêng; tài liệu mô phỏng trước đây không phải bằng chứng cho giao diện hay chức năng mới này.
