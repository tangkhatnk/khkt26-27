# Thiết kế: bài tập trước phiên, báo cáo công khai và các sửa lỗi liên quan

**Trạng thái:** người dùng duyệt triển khai ngày 2026-10-28.
**Base:** `origin/main` tại `ddf941eaf5be91eead697e7b7309a9e4ab391c10`.
**Phạm vi:** sáu yêu cầu dưới đây. Không đổi ngữ nghĩa tính giờ, nghỉ, xao nhãng, chuyến đi hoặc XP.

## 1. Bài tập AI trước phiên học

### Trải nghiệm đề xuất

Người học đăng nhập, chọn một trong hai cách chuẩn bị, xem đề trước khi bắt đầu phiên, rồi chỉ nhận lời giải sau khi phiên đạt trạng thái hoàn tất:

1. **Đề do người học cung cấp:** dán đề mở hoặc tải tệp. Trình duyệt tiếp tục trích xuất/OCR tại chỗ. Người học xem và xác nhận nguyên văn phần đề sẽ gửi cho AI; có thể giữ nhiều ý/phần đánh số trong một bộ đề, không chuyển đề thành trắc nghiệm.
2. **AI tạo đề từ tài liệu:** chọn nguồn đã xem lại, xem nội dung trích xuất và xác nhận đúng phiên bản trước khi tạo đề. AI tạo 1–5 bài tập dạng mở (mặc định 3); lựa chọn chỉ dùng khi hữu ích, không bắt buộc 4 đáp án. Nội dung gửi tối đa 20.000 ký tự, cùng giới hạn tài liệu học hiện tại.

Hai cách dùng cùng một bộ đề mở gắn với phiên. Trước khi bắt đầu, giao diện chỉ hiển thị đề/bài tập (và lựa chọn nếu có); không hiển thị lời giải. Sau khi phiên hoàn tất, AI trả lời và giải thích từng bước; trình bày bằng renderer Markdown/math an toàn hiện có. Không chấm điểm tự động hoặc thay đổi XP. Người học có thể sửa nguồn/đề, hủy bộ đề, bỏ qua AI hoặc bắt đầu phiên mà không dùng tính năng này. Mỗi lần thay nội dung làm mất bộ đề cũ và bỏ qua mọi phản hồi bất đồng bộ của lần trước.

### Hợp đồng bảo mật và lưu trữ đề xuất

- Tạo endpoint và bản ghi riêng có owner, `plannedSessionId`, mode, fingerprint/phiên bản nguồn, câu hỏi và trạng thái. `draftTripId` hiện là ID của `ActiveTrip` và được dùng làm `Session.id` khi kết thúc (`src/adventure/AdventureApp.tsx:1120-1204`), nên có thể liên kết bộ đề với đúng phiên dự kiến mà không đổi luật bắt đầu/kết thúc.
- Chỉ tài khoản đã đăng nhập được tạo bộ đề, lưu bộ đề hoặc mở lời giải. Khách có thể tiếp tục phiên thông thường; nếu muốn dùng lời giải, yêu cầu đăng nhập trước khi gửi nội dung cho AI. Không tạo một đường dẫn bí mật dựa trên UUID thay cho kiểm tra owner.
- Nội dung tệp tiếp tục được trích xuất/OCR trong trình duyệt. Chỉ gửi phần văn bản người học đã xem lại và xác nhận. Backend chụp chính xác phiên bản xác nhận, tối đa 20.000 ký tự, lưu bản chụp riêng tư kèm fingerprint và tạo đề từ chính bản này; không tin một cờ `reviewed` đơn lẻ từ client. Lần đổi nội dung làm fingerprint/bộ đề hết hiệu lực. Lưu đề người học chọn và trích đoạn nguồn tối thiểu cần cho grounding; endpoint lời giải dùng bản chụp server đã lưu, không nhận lại nội dung có thể bị thay đổi ở client. Không lưu tệp gốc, filename hay bản chụp trong lịch sử chuyến đi hoặc dữ liệu công khai.
- Mô hình provider cho giai đoạn chuẩn bị chỉ có schema câu hỏi nghiêm ngặt, không có trường đáp án, key, hint hay explanation. Với đề từ tài liệu, dùng validator riêng: kiểm tra trích đoạn là nội dung chính xác trong bản chụp và câu hỏi có từ khóa liên quan; không dùng validator quiz hiện tại vì validator đó cần đối chiếu đáp án đúng (`backend/src/geminiSchemas.ts:26-36,183-249`). Server lưu/trả DTO câu hỏi riêng; không tái dùng `/quiz/generate`, vốn trả đáp án/giải thích và được prefetch trong lúc focus (`backend/src/quizGeneration.ts:9-21`, `src/adventure/AdventureApp.tsx:1014-1066`). Không đổi lời gợi ý trong study guide hiện tại.
- **Khuyến nghị tạo lời giải theo yêu cầu sau hoàn tất**, thay vì tạo trước rồi giấu. Endpoint lời giải xác thực người gọi, owner của bộ đề và phiên, fingerprint nguồn, tombstone, rồi tự tính trạng thái hoàn tất từ phiên đã lưu bằng domain hiện hành. Chỉ khi `effectiveMetrics.completed === true` mới gọi AI với đề và bản chụp chính xác đã lưu riêng ở server; không yêu cầu client gửi lại nguồn. Phản hồi/cache lời giải chỉ được tạo sau bước kiểm tra đó. Gọi lặp lại trả lời giải đã cache; lỗi provider cho phép thử lại sau khi hoàn tất.
- Phiên chỉ được coi là hoàn tất khi số giây học thực tế đạt mục tiêu, không chỉ vì timer đóng, bản tóm tắt xuất hiện, hay phiên được lưu. Phiên dừng sớm, bị bỏ, chưa đồng bộ hoặc đang offline vẫn khóa lời giải. Sau khi đồng bộ xong, giao diện mới hiện hành động “Xem lời giải”. Không nhận cờ `completed` từ trình duyệt làm căn cứ.
- `GET` câu hỏi, snapshot, sync, bootstrap, JSON trả về khi tạo đề và localStorage trước khi mở khóa không được chứa lời giải của tính năng này. Sau khi server xác nhận hoàn tất, client mới được nhận/cache lời giải. Trước yêu cầu lời giải, chờ `sync()` rồi kiểm tra lại owner, phiên hiện hành và liveness; request cũ bị bỏ qua nếu tài khoản hoặc nguồn đã đổi. Loading, lỗi/retry, hủy và bỏ qua bài tập không được khóa focus.
- Giữ đề, bản chụp nguồn tối đa 20.000 ký tự, evidence và lời giải trong bảng owner-scoped; không đặt nội dung/lời giải vào `AdventureState` hoặc DTO lịch sử công khai. Bộ đề chưa được bắt đầu trong 7 ngày sẽ hết hạn và được xóa. Bản ghi đã gắn với session theo chính sách lưu trữ/phục hồi hiện có; khi session bị ẩn hoặc tài khoản bị soft-delete thì chặn đọc lời giải nhưng không xóa vật lý dữ liệu có thể khôi phục. Xóa vật lý chỉ theo yêu cầu purge đã được duyệt; lời giải đã mở đi theo cùng chính sách giữ/xóa của session.

### Ranh giới backend, schema và kiểm thử

Tạo hợp đồng riêng cho `POST` tạo đề, lấy câu hỏi và yêu cầu lời giải. Tạo schema Prisma mới nếu cần để lưu owner, ID phiên dự kiến, mode, fingerprint phiên bản, bản chụp nguồn chính xác (tối đa 20.000 ký tự), câu hỏi, đoạn evidence và cache lời giải chỉ được ghi sau khi server mở khóa. Không đổi API quiz hiện có hoặc thêm đáp án vào session JSON. Mọi truy vấn phải lọc theo owner; dùng transaction/khóa phù hợp để tránh hai lần tạo lời giải đồng thời hoặc race với việc gỡ phiên.

So sánh hướng: tích hợp với flow tạo phiên hiện có để gắn bộ đề vào `draftTripId` giữ được liên kết owner/session và phép kiểm tra completion; một solver rời rạc không thể bảo đảm release theo đúng phiên. Tạo câu trả lời trước rồi giấu dễ rò qua DTO/cache/localStorage; tạo câu hỏi trước và chỉ gọi AI tạo lời giải sau khi backend xác nhận hoàn tất giảm dữ liệu nhạy cảm tồn tại trước gate, đổi lại người học chờ và cần nút retry rõ ràng.

Kiểm tra structured output, grounding theo đúng tài liệu, ownership, phiên của người khác, đổi nguồn trong lúc AI đang chạy, phản hồi cũ, hủy, thử lại, lời giải bị khóa với phiên chưa hoàn tất/dừng sớm/offline và được mở sau khi phiên đồng bộ đủ mục tiêu. Khẳng định cả JSON và localStorage trước hoàn tất không có trường lời giải. Các điểm vào hiện có gồm `backend/src/adventure/routes.ts:262-363`, `backend/src/geminiSchemas.ts`, `backend/src/gemini.ts`, `src/adventure/materialSources.ts:4-49`, `src/adventure/storage.ts:20-34,310-323`.

## 2. Lỗi đăng nhập

Không thể phân biệt “email chưa đăng ký” với “mật khẩu sai” mà không mở dò tài khoản. Giữ cùng 401 cho cả hai, nhưng làm lỗi đăng nhập có ích: “Email hoặc mật khẩu chưa đúng. Kiểm tra Caps Lock, bố cục bàn phím hoặc dùng nút Hiện để kiểm tra.” Hiện nút Hiện mật khẩu đã có trong `AuthForm.tsx:71-76`. Hiển thị lỗi trường cho mật khẩu trống và dài hơn giới hạn API 72 ký tự; không áp điều kiện đăng ký lên tài khoản cũ.

Ở form đăng ký, giữ các quy tắc backend hiện tại: 8–72 ký tự, có chữ hoa A–Z, chữ số, ký tự đặc biệt, và tối đa 72 byte UTF-8. Khi sai, nêu riêng điều kiện chưa đạt (bao gồm cảnh báo ký tự có dấu có thể vượt giới hạn byte), thay vì chỉ báo chung. Checklist hiện có trong `src/adventure/authFormModel.ts:5-11` và `AuthForm.tsx:81-83`; làm rõ thông báo/aria để người dùng biết mục nào cần sửa. Không đổi API auth, hash dự phòng hay giới hạn tốc độ (`backend/src/app.ts:356-371`). Với 401, 429, mất kết nối và lỗi 5xx chỉ dùng nội dung đã biết tương ứng; không suy diễn nguyên nhân mật khẩu từ lỗi mạng/máy chủ.

## 3. Thất bại khi bật toàn màn hình

Khi yêu cầu fullscreen ban đầu bị từ chối, mở modal dialog có hai lựa chọn: **“Bật toàn màn hình”** và **“Tiếp tục không fullscreen”**. Gọi `requestFullscreen()` trực tiếp trong thao tác click hợp lệ; nếu không hỗ trợ, vô hiệu hóa lựa chọn không thể thực hiện và vẫn cho tiếp tục trong cửa sổ. Modal quản lý focus bên trong khi mở; Esc và nút tiếp tục luôn đóng được, sau khi đóng trả focus về control tiếp tục. Chọn tiếp tục không khởi động lại timer/session; dialog đóng cho lượt focus đó. Không tạo vòng lặp nhắc lại hoặc khóa thoát, không đổi bộ đếm rời focus.

Dùng ngữ nghĩa modal của [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/dialog); `requestFullscreen()` cần thao tác người dùng gần nhất ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen)).

Recon cho thấy recovery sau khi khôi phục phiên đã có thao tác click và lựa chọn tiếp tục trong cửa sổ (`src/adventure/FocusFullscreenRecovery.tsx:19-41`), còn lỗi yêu cầu ban đầu có status/retry (`src/adventure/studyFullscreen.ts:208-249`). Vì vậy cần tái hiện đúng nhánh trong ảnh trước khi đổi; không thay thế recovery đang hoạt động. Kiểm thử hiện có ở `tests/studyFullscreen.test.mjs` và `tests/focusFullscreenRecovery.test.mjs`.

## 4. Báo cáo công khai, phần quản trị vẫn riêng tư

Cho phép khách xem mục **Báo cáo** trong điều hướng và một API công khai riêng chỉ trả danh sách phép đo tổng hợp đã duyệt. Không mở API báo cáo quản trị hiện có, không nhận filter tài khoản/nhóm ở route công khai, không trả session ID, tên/email, group/account ID, goal, văn bản tài liệu, filename, dấu thời gian chính xác của từng phiên hay topic tự do. Tổng hợp theo danh mục topic đã đăng ký; topic không còn trong danh mục gom vào “Khác”, giữ nguyên mẫu số và tổng toàn cục. Mọi trường phải thuộc allowlist aggregate, không chứa ID trực tiếp hoặc nội dung tự do. Mục Báo cáo có CSV tổng hợp với cùng allowlist; CSV đã lọc theo account/group và xuất lịch sử phiên trong AdminPanel vẫn cần quyền admin.

Route mới chỉ xuất allowlist schema, có `no-store` và giới hạn tốc độ. Tab tài khoản, nhóm, lịch sử/phiên, CSV quản trị và mọi chi tiết theo owner tiếp tục cần quyền admin. Kiểm thử bằng dữ liệu tổng hợp nhân tạo, trong đó topic tự do/goal/định danh không được xuất hiện ở response.

**Ranh giới với lịch sử thực nghiệm hiện có:** giữ nguyên `ExperimentResults` và chính sách công khai đã được chấp thuận cho trang này; yêu cầu “lịch sử admin-only” ở đây áp dụng cho tab lịch sử phiên trong quản trị, không âm thầm thay đổi trang lịch sử thực nghiệm công khai. Endpoint đó hiện không yêu cầu auth và chứa mã chuyến ổn định, thời điểm chính xác cùng goal (`backend/src/experiments.ts:19-61,82-139`); thay đổi chính sách công khai đó cần yêu cầu/issue riêng.

## 5. Chi tiết chuyến đi bị dồn trong cột mã

Giữ bảng desktop và thẻ mobile hiện tại. Trong bảng, giữ một nút disclosure duy nhất trong ô mã; khi mở, render chi tiết thành hàng kế tiếp với một ô `colSpan` phủ toàn bảng, thay vì đặt `<details>` trong ô đầu hẹp. Trên mobile, hiển thị cùng nội dung dưới thẻ chuyến đã mở bằng chung một trạng thái mở, không dựng hai disclosure độc lập. Giữ nhãn truy cập được, focus bàn phím, mã đầy đủ có thể xuống dòng và thứ tự DOM đọc tự nhiên. Soát lại ở 1440/768/390 px, light/dark và nội dung tiếng Việt dài.

Ảnh đúng cho thấy chi tiết được lồng trong ô đầu; vùng cần sửa là `ExperimentRunList` tại `src/adventure/ExperimentResults.tsx:104-203`. Giữ các cột số liệu, lịch sử và luồng công khai hiện tại. Không làm thay đổi dữ liệu chuyến trong layout.

## 6. Xóa thật các phiên test trong production

Yêu cầu là xóa dữ liệu thật khỏi cơ sở dữ liệu, không gọi thao tác **gỡ phiên** là xóa. Hiện `DELETE /api/v1/admin/sessions/:sessionId` ghi `sessionOverrides[id].removedAt`, tăng revision, xóa bản tóm tắt công khai và ghi audit; session gốc vẫn còn trong JSONB (`backend/src/admin.ts:874-976,1076-1081`). Đây là tombstone có kiểm toán, không phải xóa vật lý.

Các session lịch sử hiện nằm trong `adventure_state.state.sessions` (`backend/prisma/schema.prisma:170-174`); có bảng audit với `before_state`, share summary, `tester_runs` không có FK tới JSONB session, và các bảng session/quiz quan hệ cũ (`backend/prisma/schema.prisma:62-77,101-155,180-210`). Trước purge phải rà từng khóa ngoại/liên kết để không xóa dữ liệu cùng owner/topic không thuộc session đó; đặc biệt kiểm tra/delete/verify `tester_runs.session_id` cho manifest chính xác. Tombstone hoặc ledger tối thiểu có thể cần giữ để client cũ không gửi lại session đã xóa; nếu giữ, báo riêng rõ nội dung session nào đã bị xóa và metadata nào còn lại. Audit có `before_state` chứa goal/metrics nên phải xóa hoặc redacted theo quyết định purge, không giữ nguyên bản sao chi tiết mà vẫn tuyên bố đã xóa toàn bộ. Phiên có corrections/shares/audits không bị bỏ qua tự động: xử lý từng liên kết trong plan exact purge; nếu không thể xóa an toàn, giữ riêng để review.

**Quy trình bắt buộc trước khi chạy:**

1. Có truy cập SQL production chỉ đọc qua phương thức đã được xác minh; thống kê số lượng theo nhóm thời gian học/thời gian trôi qua/lượt xao nhãng, không đưa ID hay nội dung ra chat/log/public repo.
2. Dùng các chỉ số thời gian để tìm ứng viên ban đầu, không coi thời lượng ngắn hoặc nhiều lần rời phiên là bằng chứng đủ để xóa. Loại phiên đang chạy, phiên hợp lệ/không rõ; các session có corrections/shares/audits được giải quyết riêng bằng phương án purge chính xác thay vì mặc định loại vĩnh viễn. Chốt tiêu chí và tạo manifest ID/hash chính xác trong vùng riêng tư. Người dùng đã yêu cầu phân tích và xóa; sau khi thiết kế được duyệt, root kiểm tra manifest là chốt rà soát trước thao tác, không yêu cầu xác nhận lại từng ID.
3. Tạo bản sao lưu mã hóa, khôi phục được, chứa đúng JSONB state và các dòng liên quan sẽ xóa; thử restore vào môi trường riêng và xác nhận hash/đếm trước khi thay đổi production.
4. Chuẩn bị script một lần dùng manifest ID chính xác, transaction và khóa hàng; kiểm tra version/hash từng session, abort nếu snapshot đã đổi, và idempotent nếu session đã biến mất. Xóa nội dung session, override/summary liên quan, `tester_runs` và bản sao audit nhạy cảm theo manifest/plan đã rà; ghi receipt/tombstone tối thiểu để chống replay. Không thêm endpoint xóa tổng quát.
5. Không trừ lại tiến độ hành trình/XP hoặc sửa session thật. Việc xóa lịch sử không tự động đảo ngược settlement đã ghi; chỉ thay đổi XP/trip progress nếu có bằng chứng domain cho phép hoàn tác chính xác và được duyệt riêng.
6. Sau đó đối chiếu số ID đã xóa, số đã tombstone/ẩn riêng, số được bỏ qua và trạng thái các bảng liên quan; không công bố ID hoặc nội dung cá nhân.

Hiện chưa có số ứng viên hoặc tiêu chí định lượng đã xác nhận: Railway metadata cho biết API và Postgres production đang hoạt động và API chạy đúng `ddf941e`, nhưng Railway connector không cung cấp SQL; không có `railway` CLI/`psql` trong môi trường. Không đọc giá trị biến/credentials, không truy vấn hàng production và không chạy xóa. Thống kê, tiêu chí cuối, bản sao lưu và manifest ID là điều kiện bắt buộc ở giai đoạn tiếp theo; không suy đoán để lấp chỗ trống.

## Vấn đề/issue trước khi triển khai

Các issue trước triển khai: #55 báo cáo public, #56 phản hồi mật khẩu, #57 chi tiết chuyến, #58 bài tập theo phiên, #59 fallback fullscreen, #60 purge phiên thử nghiệm. Issue #45 (đã đóng) là precedent cho thao tác phục hồi fullscreen bằng gesture; #41/#46 (đã đóng) ghi nhận lịch sử/chia sẻ summary hiện hành. Giữ các issue hẹp; không gộp thành một “cleanup” rộng.

## Kiểm chứng sau khi được duyệt và triển khai

Không chạy kiểm thử trong giai đoạn duyệt thiết kế. Sau khi code, chạy theo các lớp bị ảnh hưởng:

- Web: `npm run lint`, `npm run typecheck`, `npm run test:web`, `npm run build:web`.
- Backend: `npm --prefix backend run db:generate`, `npm --prefix backend run typecheck`, `npm --prefix backend test`, `npm --prefix backend run build`.
- Desktop dùng chung UI: `npm --prefix desktop run typecheck`, `npm --prefix desktop test`.
- Mở UI thật ở 1440/768/390 px, light/dark; xem trạng thái đang tải, lỗi, nội dung tiếng Việt dài, bài tập trước/sau khi mở khóa, modal fullscreen và chi tiết chuyến mở/đóng. Không tuyên bố đạt kiểm tra trực quan nếu chưa xem.

## Tiêu chí chấp nhận tổng quát

- Người dùng chọn rõ mode và xác nhận đúng nguồn trước khi gửi nội dung cho AI.
- Không có lời giải do feature phát ra trước khi phiên đã lưu đạt mục tiêu; dữ liệu của owner khác, session khác, session bị gỡ hoặc nguồn cũ không mở được.
- Hoạt động thường ngày của guest, timer, nghỉ, distraction, đồng bộ và XP không đổi.
- Báo cáo khách chỉ có dữ liệu allowlist; routes/tab quản trị giữ xác thực.
- Disclosure không bóp méo mã/nhãn và hoạt động ở màn hình rộng, tablet, mobile.
- Login giữ thông báo 401 chung; fullscreen luôn có đường tiếp tục.
- Production purge chỉ chạy sau khi có thống kê riêng tư, tiêu chí được rà, backup phục hồi thử thành công và manifest ID/hash được kiểm tra; bỏ qua trường hợp mơ hồ.
