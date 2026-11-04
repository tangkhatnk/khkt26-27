export type CuratedQuestion = {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export type CuratedLesson = {
  id: string;
  version: number;
  title: string;
  summary: string;
  minutes: number;
  content: string;
  questions: CuratedQuestion[];
};

export type CuratedCourse = {
  id: string;
  version: number;
  grade: number;
  conceptId: string;
  subjectId: string;
  subjectName: string;
  title: string;
  description: string;
  lessons: CuratedLesson[];
};

export const CURRICULUM_VERSION = 1;

export const CURATED_COURSES: readonly CuratedCourse[] = [
  {
    id: "math-7-ratios",
    version: 1,
    grade: 7,
    conceptId: "ratios-proportions",
    subjectId: "mathematics",
    subjectName: "Toán",
    title: "Tỉ lệ thức",
    description: "Ba bài ngắn về tỉ số, tính chất tỉ lệ thức và cách tìm số chưa biết.",
    lessons: [
      {
        id: "math-7-ratios-meaning",
        version: 1,
        title: "Nhận biết tỉ lệ thức",
        summary: "Phân biệt một tỉ số với đẳng thức giữa hai tỉ số.",
        minutes: 5,
        content: "Tỉ số của hai số a và b (b khác 0) được viết là a/b. Khi hai tỉ số bằng nhau, chẳng hạn 2/3 = 4/6, ta có một tỉ lệ thức. Mỗi vế của tỉ lệ thức là một tỉ số; các số đứng ở vị trí tương ứng tạo thành những cách viết khác nhau của cùng một quan hệ.",
        questions: [
          {
            id: "math-7-ratios-meaning-q1",
            prompt: "Điều kiện nào cần có để viết tỉ số a/b?",
            options: ["b khác 0", "a phải lớn hơn b", "a và b phải là số nguyên dương"],
            correctIndex: 0,
            explanation: "Số ở mẫu không thể bằng 0, nên b phải khác 0.",
          },
          {
            id: "math-7-ratios-meaning-q2",
            prompt: "Đẳng thức nào là một tỉ lệ thức?",
            options: ["2/3 = 4/5", "2 + 3 = 4 + 6", "2/3 = 4/6"],
            correctIndex: 2,
            explanation: "2/3 và 4/6 cùng bằng 2/3, nên đây là đẳng thức giữa hai tỉ số.",
          },
          {
            id: "math-7-ratios-meaning-q3",
            prompt: "Tỉ số 6/8 rút gọn thành tỉ số nào?",
            options: ["3/8", "3/4", "4/3"],
            correctIndex: 1,
            explanation: "Chia cả tử và mẫu cho 2, ta được 6/8 = 3/4.",
          },
          {
            id: "math-7-ratios-meaning-q4",
            prompt: "Nếu 4/5 = 8/10 thì hai tỉ số có quan hệ gì?",
            options: ["Bằng nhau", "Luôn là số nguyên", "Có mẫu bằng 0"],
            correctIndex: 0,
            explanation: "8/10 rút gọn thành 4/5, vì thế hai tỉ số bằng nhau.",
          },
        ],
      },
      {
        id: "math-7-ratios-property",
        version: 1,
        title: "Tính chất tích chéo",
        summary: "Dùng tích chéo để kiểm tra và biến đổi tỉ lệ thức.",
        minutes: 6,
        content: "Nếu a/b = c/d với b và d khác 0 thì ad = bc. Hai tích ad và bc được gọi là tích chéo. Chẳng hạn, 3/5 = 12/20 vì 3 × 20 = 5 × 12 = 60. Tính chất này cũng giúp kiểm tra nhanh một đẳng thức giữa hai tỉ số.",
        questions: [
          {
            id: "math-7-ratios-property-q1",
            prompt: "Trong tỉ lệ thức a/b = c/d, hai tích chéo bằng nhau là gì?",
            options: ["ab = cd", "ad = bc", "a + d = b + c"],
            correctIndex: 1,
            explanation: "Nhân chéo hai vế cho ta ad = bc, với b và d khác 0.",
          },
          {
            id: "math-7-ratios-property-q2",
            prompt: "Vì sao 3/5 = 12/20?",
            options: ["3 + 20 = 5 + 12", "3 × 5 = 12 × 20", "3 × 20 = 5 × 12"],
            correctIndex: 2,
            explanation: "Hai tích chéo đều bằng 60, nên hai tỉ số bằng nhau.",
          },
          {
            id: "math-7-ratios-property-q3",
            prompt: "Nếu a/b = 2/3 thì phép nhân chéo nào đúng?",
            options: ["3a = 2b", "2a = 3b", "a + b = 5"],
            correctIndex: 0,
            explanation: "Từ a/b = 2/3, nhân chéo được 3a = 2b.",
          },
          {
            id: "math-7-ratios-property-q4",
            prompt: "Trong 5/8 = 10/16, tích chéo nào bằng 80?",
            options: ["5 × 8", "5 × 16", "8 + 16"],
            correctIndex: 1,
            explanation: "Tích chéo 5 × 16 bằng 80; tích còn lại 8 × 10 cũng bằng 80.",
          },
        ],
      },
      {
        id: "math-7-ratios-solve",
        version: 1,
        title: "Tìm số chưa biết",
        summary: "Giải tỉ lệ thức bằng phép nhân chéo.",
        minutes: 6,
        content: "Muốn tìm x trong 3/5 = x/20, nhân chéo được 5x = 3 × 20 = 60. Chia hai vế cho 5, ta được x = 12. Hãy luôn giữ điều kiện mẫu khác 0 và kiểm tra kết quả bằng cách thay lại vào tỉ lệ thức ban đầu.",
        questions: [
          {
            id: "math-7-ratios-solve-q1",
            prompt: "Nếu 3/5 = x/20 thì x bằng bao nhiêu?",
            options: ["12", "15", "18"],
            correctIndex: 0,
            explanation: "Nhân chéo được 5x = 60, nên x = 12.",
          },
          {
            id: "math-7-ratios-solve-q2",
            prompt: "Cách kiểm tra x = 12 trong 3/5 = x/20 là gì?",
            options: ["Cộng 3 + 5 với 12 + 20", "So sánh 3 × 20 với 5 × 12", "So sánh 3 × 5 với 12 × 20"],
            correctIndex: 1,
            explanation: "Thay x = 12, hai tích chéo đều bằng 60 nên tỉ lệ thức đúng.",
          },
          {
            id: "math-7-ratios-solve-q3",
            prompt: "Nếu 4/7 = x/21 thì x bằng bao nhiêu?",
            options: ["7", "6", "12"],
            correctIndex: 2,
            explanation: "Nhân chéo được 7x = 4 × 21 = 84, nên x = 12.",
          },
          {
            id: "math-7-ratios-solve-q4",
            prompt: "Nếu 2/3 = 10/y thì y bằng bao nhiêu?",
            options: ["15", "12", "18"],
            correctIndex: 0,
            explanation: "Nhân chéo được 2y = 30, nên y = 15.",
          },
        ],
      },
    ],
  },
  {
    id: "physics-9-ohm",
    version: 1,
    grade: 9,
    conceptId: "ohms-law",
    subjectId: "physics",
    subjectName: "Vật lí",
    title: "Định luật Ôm",
    description: "Ba bài ngắn về cường độ dòng điện, điện trở và mạch điện đơn giản.",
    lessons: [
      {
        id: "physics-9-ohm-quantities",
        version: 1,
        title: "Ba đại lượng điện",
        summary: "Nhận biết cường độ dòng điện, hiệu điện thế và điện trở.",
        minutes: 5,
        content: "Cường độ dòng điện I cho biết độ mạnh của dòng điện và đo bằng ampe (A). Hiệu điện thế U đo bằng vôn (V). Điện trở R biểu thị mức cản trở dòng điện và đo bằng ôm (Ω). Với một dây dẫn ở nhiệt độ không đổi, định luật Ôm liên hệ ba đại lượng này.",
        questions: [
          {
            id: "physics-9-ohm-quantities-q1",
            prompt: "Đại lượng nào đo bằng ôm (Ω)?",
            options: ["Cường độ dòng điện", "Điện trở", "Hiệu điện thế"],
            correctIndex: 1,
            explanation: "Điện trở R đo bằng ôm, kí hiệu Ω.",
          },
          {
            id: "physics-9-ohm-quantities-q2",
            prompt: "Hiệu điện thế U đo bằng đơn vị nào?",
            options: ["Ampe (A)", "Ôm (Ω)", "Vôn (V)"],
            correctIndex: 2,
            explanation: "Vôn (V) là đơn vị của hiệu điện thế.",
          },
          {
            id: "physics-9-ohm-quantities-q3",
            prompt: "Cường độ dòng điện I đo bằng đơn vị nào?",
            options: ["Ampe (A)", "Vôn (V)", "Ôm (Ω)"],
            correctIndex: 0,
            explanation: "Ampe, kí hiệu A, là đơn vị đo cường độ dòng điện.",
          },
          {
            id: "physics-9-ohm-quantities-q4",
            prompt: "Kí hiệu R thường dùng cho đại lượng nào trong định luật Ôm?",
            options: ["Hiệu điện thế", "Điện trở", "Cường độ dòng điện"],
            correctIndex: 1,
            explanation: "Trong công thức I = U/R, R kí hiệu cho điện trở.",
          },
        ],
      },
      {
        id: "physics-9-ohm-law",
        version: 1,
        title: "Dùng công thức I = U/R",
        summary: "Tính cường độ dòng điện khi biết hiệu điện thế và điện trở.",
        minutes: 6,
        content: "Định luật Ôm viết I = U/R: cường độ dòng điện qua dây dẫn bằng hiệu điện thế giữa hai đầu dây chia cho điện trở của dây. Nếu U = 6 V và R = 3 Ω thì I = 6/3 = 2 A. Công thức áp dụng cho dây dẫn trong điều kiện nhiệt độ không đổi.",
        questions: [
          {
            id: "physics-9-ohm-law-q1",
            prompt: "Một dây dẫn có U = 6 V và R = 3 Ω. Cường độ dòng điện là bao nhiêu?",
            options: ["3 A", "18 A", "2 A"],
            correctIndex: 2,
            explanation: "Theo I = U/R, ta có I = 6/3 = 2 A.",
          },
          {
            id: "physics-9-ohm-law-q2",
            prompt: "Muốn tính cường độ dòng điện bằng định luật Ôm, cần làm phép tính nào?",
            options: ["Lấy R chia cho U", "Lấy U chia cho R", "Cộng U với R"],
            correctIndex: 1,
            explanation: "Công thức định luật Ôm là I = U/R.",
          },
          {
            id: "physics-9-ohm-law-q3",
            prompt: "Công thức nào biểu diễn định luật Ôm cho một dây dẫn?",
            options: ["I = U/R", "I = U × R", "I = R/U"],
            correctIndex: 0,
            explanation: "Cường độ dòng điện I bằng hiệu điện thế U chia cho điện trở R.",
          },
          {
            id: "physics-9-ohm-law-q4",
            prompt: "Nếu U = 9 V và R = 3 Ω thì I bằng bao nhiêu?",
            options: ["1 A", "3 A", "6 A"],
            correctIndex: 1,
            explanation: "I = U/R = 9/3 = 3 A.",
          },
        ],
      },
      {
        id: "physics-9-ohm-resistance",
        version: 1,
        title: "Suy ra điện trở",
        summary: "Biến đổi công thức để tính R hoặc U.",
        minutes: 6,
        content: "Từ I = U/R, ta có thể biến đổi thành U = I × R hoặc R = U/I. Ví dụ, nếu một dây dẫn có hiệu điện thế 12 V và cường độ dòng điện 2 A thì điện trở của dây là R = 12/2 = 6 Ω. Hãy giữ đúng đơn vị khi thay số.",
        questions: [
          {
            id: "physics-9-ohm-resistance-q1",
            prompt: "Nếu U = 12 V và I = 2 A thì R bằng bao nhiêu?",
            options: ["24 Ω", "6 Ω", "10 Ω"],
            correctIndex: 1,
            explanation: "R = U/I = 12/2 = 6 Ω.",
          },
          {
            id: "physics-9-ohm-resistance-q2",
            prompt: "Công thức nào suy ra điện trở từ U và I?",
            options: ["R = U × I", "R = I/U", "R = U/I"],
            correctIndex: 2,
            explanation: "Biến đổi I = U/R cho ta R = U/I.",
          },
          {
            id: "physics-9-ohm-resistance-q3",
            prompt: "Nếu I = 0,5 A và R = 8 Ω thì U bằng bao nhiêu?",
            options: ["4 V", "8 V", "16 V"],
            correctIndex: 0,
            explanation: "U = I × R = 0,5 × 8 = 4 V.",
          },
          {
            id: "physics-9-ohm-resistance-q4",
            prompt: "Nếu U = 12 V và I = 3 A thì R bằng bao nhiêu?",
            options: ["3 Ω", "12 Ω", "4 Ω"],
            correctIndex: 2,
            explanation: "R = U/I = 12/3 = 4 Ω.",
          },
        ],
      },
    ],
  },
  {
    id: "biology-10-respiration",
    version: 1,
    grade: 10,
    conceptId: "cellular-respiration",
    subjectId: "biology",
    subjectName: "Sinh học",
    title: "Hô hấp tế bào",
    description: "Ba bài ngắn về vai trò, vị trí và sản phẩm của hô hấp hiếu khí.",
    lessons: [
      {
        id: "biology-10-respiration-purpose",
        version: 1,
        title: "Năng lượng cho tế bào",
        summary: "Hiểu vì sao tế bào phân giải chất hữu cơ.",
        minutes: 5,
        content: "Hô hấp tế bào là quá trình tế bào phân giải các phân tử hữu cơ, giải phóng năng lượng và tích lũy một phần năng lượng đó trong ATP. ATP có thể được tế bào sử dụng cho nhiều hoạt động như tổng hợp chất và vận chuyển chủ động. Hô hấp diễn ra liên tục để cung cấp năng lượng cho tế bào.",
        questions: [
          {
            id: "biology-10-respiration-purpose-q1",
            prompt: "Một phần năng lượng giải phóng khi hô hấp tế bào được tích lũy chủ yếu dưới dạng nào?",
            options: ["DNA", "Nước", "ATP"],
            correctIndex: 2,
            explanation: "ATP là dạng tế bào có thể sử dụng để truyền năng lượng cho nhiều hoạt động.",
          },
          {
            id: "biology-10-respiration-purpose-q2",
            prompt: "Hô hấp tế bào giúp tế bào làm gì?",
            options: ["Tạo ánh sáng từ ATP", "Giải phóng năng lượng từ chất hữu cơ", "Ngừng mọi hoạt động khi có oxygen"],
            correctIndex: 1,
            explanation: "Tế bào phân giải chất hữu cơ để giải phóng năng lượng, trong đó một phần được tích lũy trong ATP.",
          },
          {
            id: "biology-10-respiration-purpose-q3",
            prompt: "ATP giúp tế bào thực hiện điều gì?",
            options: ["Cung cấp năng lượng cho một số hoạt động của tế bào", "Thay thế mọi enzyme", "Ngăn mọi phản ứng hóa học"],
            correctIndex: 0,
            explanation: "ATP truyền năng lượng cho nhiều hoạt động, chẳng hạn tổng hợp chất và vận chuyển chủ động.",
          },
          {
            id: "biology-10-respiration-purpose-q4",
            prompt: "Chất hữu cơ có vai trò nào trong hô hấp tế bào?",
            options: ["Là sản phẩm duy nhất", "Là nguồn được phân giải để giải phóng năng lượng", "Ngăn tạo ATP"],
            correctIndex: 1,
            explanation: "Tế bào phân giải chất hữu cơ, giải phóng năng lượng và tích lũy một phần trong ATP.",
          },
        ],
      },
      {
        id: "biology-10-respiration-location",
        version: 1,
        title: "Nơi diễn ra các giai đoạn",
        summary: "Phân biệt đường phân và các giai đoạn hiếu khí.",
        minutes: 6,
        content: "Ở tế bào nhân thực, đường phân diễn ra trong tế bào chất. Trong hô hấp hiếu khí, các giai đoạn tiếp theo diễn ra ở ti thể. Oxygen tham gia chuỗi truyền electron; ATP được tạo ra qua các giai đoạn khác nhau, không phải chỉ một phản ứng đơn lẻ.",
        questions: [
          {
            id: "biology-10-respiration-location-q1",
            prompt: "Ở tế bào nhân thực, đường phân diễn ra ở đâu?",
            options: ["Nhân tế bào", "Tế bào chất", "Thành tế bào"],
            correctIndex: 1,
            explanation: "Đường phân diễn ra trong tế bào chất, trước các giai đoạn tiếp theo ở ti thể.",
          },
          {
            id: "biology-10-respiration-location-q2",
            prompt: "Oxygen có vai trò nào trong hô hấp hiếu khí?",
            options: ["Là sản phẩm cuối của đường phân", "Thay thế ATP", "Nhận electron ở cuối chuỗi truyền electron"],
            correctIndex: 2,
            explanation: "Trong hô hấp hiếu khí, oxygen nhận electron ở cuối chuỗi truyền electron.",
          },
          {
            id: "biology-10-respiration-location-q3",
            prompt: "Ở tế bào nhân thực, các giai đoạn tiếp theo của hô hấp hiếu khí diễn ra chủ yếu ở đâu?",
            options: ["Ti thể", "Không bào", "Lục lạp"],
            correctIndex: 0,
            explanation: "Sau đường phân ở tế bào chất, các giai đoạn tiếp theo của hô hấp hiếu khí diễn ra ở ti thể.",
          },
          {
            id: "biology-10-respiration-location-q4",
            prompt: "Đường phân diễn ra trước hay sau các giai đoạn tiếp theo ở ti thể?",
            options: ["Sau", "Trước", "Chỉ khi không có tế bào chất"],
            correctIndex: 1,
            explanation: "Đường phân ở tế bào chất là giai đoạn đầu của quá trình hô hấp tế bào.",
          },
        ],
      },
      {
        id: "biology-10-respiration-products",
        version: 1,
        title: "Đọc phương trình tổng quát",
        summary: "Nhận biết chất tham gia và sản phẩm của hô hấp hiếu khí.",
        minutes: 6,
        content: "Phương trình tổng quát thường dùng cho hô hấp hiếu khí của glucose là C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O, đồng thời giải phóng năng lượng để tạo ATP. Phương trình tóm lược các chất tham gia và sản phẩm, còn quá trình thực tế diễn ra qua nhiều phản ứng.",
        questions: [
          {
            id: "biology-10-respiration-products-q1",
            prompt: "Chất nào là sản phẩm của hô hấp hiếu khí theo phương trình tổng quát?",
            options: ["Glucose và oxygen", "Carbon dioxide và nước", "Chlorophyll và nitrogen"],
            correctIndex: 1,
            explanation: "Phương trình tổng quát cho thấy glucose và oxygen tạo carbon dioxide, nước và năng lượng.",
          },
          {
            id: "biology-10-respiration-products-q2",
            prompt: "Trong phương trình tổng quát, glucose là chất nào?",
            options: ["Sản phẩm cuối", "Chất xúc tác", "Chất tham gia"],
            correctIndex: 2,
            explanation: "Glucose nằm ở vế chất tham gia và được phân giải trong quá trình hô hấp.",
          },
          {
            id: "biology-10-respiration-products-q3",
            prompt: "Theo phương trình tổng quát, cần bao nhiêu phân tử O₂ cho một phân tử glucose?",
            options: ["6", "1", "12"],
            correctIndex: 0,
            explanation: "Hệ số cân bằng trong phương trình là 6O₂ cho mỗi C₆H₁₂O₆.",
          },
          {
            id: "biology-10-respiration-products-q4",
            prompt: "Phương trình tổng quát của hô hấp hiếu khí có sản phẩm nào?",
            options: ["Glucose và oxygen", "Carbon dioxide và nước", "Diệp lục và tinh bột"],
            correctIndex: 1,
            explanation: "Glucose và oxygen tạo carbon dioxide, nước và giải phóng năng lượng để tạo ATP.",
          },
        ],
      },
    ],
  },
  {
    id: "english-11-environment",
    version: 1,
    grade: 11,
    conceptId: "environmental-actions",
    subjectId: "english",
    subjectName: "Tiếng Anh",
    title: "Small actions for the environment",
    description: "Ba bài ngắn về từ vựng môi trường và lời khuyên với should / shouldn't.",
    lessons: [
      {
        id: "english-11-environment-vocabulary",
        version: 1,
        title: "Từ vựng về môi trường",
        summary: "Dùng đúng các cụm từ về rác thải và tái sử dụng.",
        minutes: 5,
        content: "Pollution là sự ô nhiễm; waste là rác thải hoặc sự lãng phí; reusable mô tả vật có thể dùng lại. Ta có thể nói: “Reusable bottles help reduce plastic waste.” Nghĩa là chai có thể dùng lại giúp giảm rác thải nhựa.",
        questions: [
          {
            id: "english-11-environment-vocabulary-q1",
            prompt: "Từ reusable có nghĩa gần nhất với cụm nào?",
            options: ["Dễ vỡ", "Đã bị ô nhiễm", "Có thể dùng lại"],
            correctIndex: 2,
            explanation: "Reusable ghép từ re-use, nghĩa là có thể sử dụng lại.",
          },
          {
            id: "english-11-environment-vocabulary-q2",
            prompt: "Trong câu “reduce plastic waste”, reduce nghĩa là gì?",
            options: ["Tạo ra", "Giảm", "Đo lường"],
            correctIndex: 1,
            explanation: "Reduce có nghĩa là làm giảm; plastic waste là rác thải nhựa.",
          },
          {
            id: "english-11-environment-vocabulary-q3",
            prompt: "Pollution có nghĩa là gì?",
            options: ["Sự ô nhiễm", "Sự tái sử dụng", "Năng lượng"],
            correctIndex: 0,
            explanation: "Pollution là danh từ chỉ sự ô nhiễm.",
          },
          {
            id: "english-11-environment-vocabulary-q4",
            prompt: "Plastic waste nghĩa là gì?",
            options: ["Chai dùng nhiều lần", "Rác thải nhựa", "Không khí sạch"],
            correctIndex: 1,
            explanation: "Plastic là nhựa, còn waste là rác thải hoặc sự lãng phí.",
          },
        ],
      },
      {
        id: "english-11-environment-advice",
        version: 1,
        title: "Đưa ra lời khuyên",
        summary: "Dùng should và shouldn't với động từ nguyên mẫu.",
        minutes: 6,
        content: "Should đưa ra lời khuyên; shouldn't khuyên không nên làm điều gì. Sau cả hai từ, động từ giữ nguyên mẫu: “We should save water” và “We shouldn't drop litter.” Không thêm -s vào động từ theo chủ ngữ sau should.",
        questions: [
          {
            id: "english-11-environment-advice-q1",
            prompt: "Câu nào đưa ra lời khuyên đúng ngữ pháp?",
            options: ["We should saves water.", "We should save water.", "We should to save water."],
            correctIndex: 1,
            explanation: "Sau should dùng động từ nguyên mẫu, nên save không thêm -s và không có to.",
          },
          {
            id: "english-11-environment-advice-q2",
            prompt: "Câu “You shouldn't drop litter” khuyên người nghe điều gì?",
            options: ["Nên xả rác", "Đã xả rác rồi", "Không nên xả rác"],
            correctIndex: 2,
            explanation: "Shouldn't diễn tả lời khuyên không nên làm việc được nêu sau đó.",
          },
          {
            id: "english-11-environment-advice-q3",
            prompt: "Động từ nào phù hợp sau should trong câu “We should ___ water”?",
            options: ["save", "saves", "saving"],
            correctIndex: 0,
            explanation: "Sau should dùng động từ nguyên mẫu save.",
          },
          {
            id: "english-11-environment-advice-q4",
            prompt: "Should thường được dùng để làm gì trong bài học này?",
            options: ["Nói về một việc đã kết thúc", "Đưa ra lời khuyên", "Đặt câu hỏi về quá khứ"],
            correctIndex: 1,
            explanation: "Should được dùng để đưa ra lời khuyên; shouldn't nêu điều không nên làm.",
          },
        ],
      },
      {
        id: "english-11-environment-plan",
        version: 1,
        title: "Nêu kết quả có thể xảy ra",
        summary: "Kết hợp if + hiện tại đơn với will + động từ.",
        minutes: 6,
        content: "Câu điều kiện loại 1 nói về tình huống có thể xảy ra ở hiện tại hoặc tương lai. Mẫu thường gặp là If + hiện tại đơn, will + động từ nguyên mẫu: “If we plant more trees, our streets will be cooler.” Mệnh đề if không dùng will trong mẫu cơ bản này.",
        questions: [
          {
            id: "english-11-environment-plan-q1",
            prompt: "Câu nào theo đúng mẫu điều kiện loại 1?",
            options: ["If we will plant trees, the area is cooler.", "If we planted trees, the area will be cooler.", "If we plant trees, the area will be cooler."],
            correctIndex: 2,
            explanation: "Mẫu cơ bản dùng hiện tại đơn sau if và will + động từ nguyên mẫu ở mệnh đề còn lại.",
          },
          {
            id: "english-11-environment-plan-q2",
            prompt: "Trong câu điều kiện loại 1, động từ sau will thường ở dạng nào?",
            options: ["Quá khứ đơn", "Động từ nguyên mẫu", "Động từ thêm -ing"],
            correctIndex: 1,
            explanation: "Sau will dùng động từ nguyên mẫu, như will be hoặc will help.",
          },
          {
            id: "english-11-environment-plan-q3",
            prompt: "Mệnh đề bắt đầu bằng if thường dùng thì nào trong mẫu điều kiện loại 1?",
            options: ["Hiện tại đơn", "Quá khứ hoàn thành", "Hiện tại tiếp diễn"],
            correctIndex: 0,
            explanation: "Mẫu cơ bản dùng hiện tại đơn trong mệnh đề if.",
          },
          {
            id: "english-11-environment-plan-q4",
            prompt: "Trong câu “If it rains, we will stay inside”, kết quả được nói ở mệnh đề nào?",
            options: ["If it rains", "Cả hai mệnh đề đều là kết quả", "We will stay inside"],
            correctIndex: 2,
            explanation: "“We will stay inside” nêu kết quả có thể xảy ra nếu điều kiện trời mưa đúng.",
          },
        ],
      },
    ],
  },
];
