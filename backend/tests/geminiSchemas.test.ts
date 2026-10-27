import { describe, expect, it } from "vitest";
import { geminiRequestSchema, parseGeneratedQuiz, parseGroundedQuizCandidates } from "../src/geminiSchemas.js";

const question = {
  id: "q1", question: "Cấu trúc nào sử dụng LIFO?",
  options: ["Queue", "Stack", "Array", "Graph"],
  correctAnswerIndex: 1, explanation: "Stack lấy phần tử mới nhất ra trước.",
};
const groundedQuestion = {
  ...question,
  question: "Chất diệp lục hấp thụ điều gì trong quang hợp?",
  options: ["Ánh sáng", "Âm thanh", "Nhiệt", "Áp suất"],
  correctAnswerIndex: 0,
  explanation: "Chất diệp lục hấp thụ năng lượng ánh sáng.",
  sourceExcerpt: "chlorophyll hấp thụ năng lượng ánh sáng",
};
const glossaryQuestion = {
  id: "glossary-1",
  question: "What does abandon mean?",
  options: ["ở lại", "từ bỏ", "mượn", "bắt đầu"],
  correctAnswerIndex: 1,
  explanation: "Abandon nghĩa là từ bỏ hoặc bỏ rơi.",
  sourceExcerpt: "abandon (v): từ bỏ, bỏ rơi.",
};

describe("Gemini request", () => {
  it("accepts topic only and trims study text", () => {
    expect(geminiRequestSchema.parse({ topic: " biology " })).toEqual({ topic: "biology", count: 3, documentAttached: false });
    expect(geminiRequestSchema.parse({ topic: "biology", documentText: "  Nội dung bài học  ", count: 1 })
      .documentText).toBe("Nội dung bài học");
  });
  it("requires OCR text when the caller says a file is attached", () => {
    expect(geminiRequestSchema.safeParse({ topic: "biology", documentAttached: true }).success).toBe(false);
    expect(geminiRequestSchema.parse({
      topic: "biology", documentAttached: true, documentText: "Nội dung bài học đủ dài",
    }).documentAttached).toBe(true);
  });
  it("accepts thirty questions and a bounded learning goal", () => {
    expect(geminiRequestSchema.parse({ topic: "biology", count: 30, goal: `  ${"g".repeat(500)}  ` }))
      .toMatchObject({ count: 30, goal: "g".repeat(500) });
  });
  it.each([
    { topic: "" }, { topic: "../biology" }, { topic: "biology", count: "3" },
    { topic: "biology", count: 0 }, { topic: "biology", count: 31 },
    { topic: "biology", count: 1.5 }, { topic: "biology", documentText: " " },
    { topic: "biology", documentText: "x".repeat(50001) },
    { topic: "biology", goal: "x".repeat(501) }, { topic: "biology", goal: " " },
    { topic: "biology", questionCount: 3 },
  ])("rejects invalid request %j", input => {
    expect(geminiRequestSchema.safeParse(input).success).toBe(false);
  });
});

describe("Gemini output", () => {
  it("accepts a direct question array", () => {
    expect(parseGeneratedQuiz(JSON.stringify([question]), 1)).toEqual([question]);
  });
  it("keeps case-distinct math options while rejecting case-only prose duplicates", () => {
    const mathQuestion = {
      ...question,
      options: [
        "$\\int f(x)\\,dx=F(x)+C$",
        "$\\int f(x)\\,dx=f(x)+C$",
        "$x^2$",
        "$0$",
      ],
      correctAnswerIndex: 0,
    };
    expect(parseGeneratedQuiz(JSON.stringify([mathQuestion]), 1)).toEqual([mathQuestion]);
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...question, options: ["A", "a", "C", "D"],
    }]), 1)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...question, options: ["Pay $10", "pay $10", "Refund", "None"],
    }]), 1)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...question, options: ["Quên viết hằng số + C", "quên viết hằng số + C", "Đổi dấu", "Bỏ nguyên hàm"],
    }]), 1)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...question, options: ["The letter A = alpha", "the letter a = alpha", "Other", "None"],
    }]), 1)).toThrow();
    const bareFormulaQuestion = {
      ...question,
      options: ["f(x) = F(x)", "f(x) = f(x)", "x = 0", "x = 1"],
      correctAnswerIndex: 0,
    };
    expect(parseGeneratedQuiz(JSON.stringify([bareFormulaQuestion]), 1)).toEqual([bareFormulaQuestion]);
  });
  it("requires an exact source excerpt and concept overlap for document-grounded questions", () => {
    const source = "Trong quang hợp, chlorophyll hấp thụ năng lượng ánh sáng.";
    expect(parseGeneratedQuiz(JSON.stringify([groundedQuestion]), 1, source)).toEqual([groundedQuestion]);
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...groundedQuestion,
      sourceExcerpt: "Mitochondria produce ATP from glucose.",
    }]), 1, source)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...groundedQuestion,
      question: "Enzyme nào tổng hợp ATP trong ty thể?",
      explanation: "ATP synthase tổng hợp ATP trong ty thể.",
    }]), 1, source)).toThrow();
  });
  it("accepts a Vietnamese math excerpt when its exact answer and short terms support the question", () => {
    const source = "Đạo hàm của x² là 2x.";
    const derivativeQuestion = {
      id: "derivative-q1",
      question: "Đạo hàm của x² là gì?",
      options: ["2x", "x", "x²", "0"],
      correctAnswerIndex: 0,
      explanation: "Đạo hàm của x² là 2x.",
      sourceExcerpt: source,
    };

    expect(parseGeneratedQuiz(JSON.stringify([derivativeQuestion]), 1, source)).toEqual([derivativeQuestion]);
  });
  it("matches source-wrapped math when the model omits delimiters without folding symbols or operators", () => {
    const source = "Họ tất cả các nguyên hàm của $f(x)$ ký hiệu là $\\int f(x)dx = F(x) + C$.";
    const bareMathQuestion = {
      id: "q2",
      question: "Họ tất cả các nguyên hàm của f(x) có dạng nào?",
      options: ["\\int f(x)dx = F(x) + C", "F'(x) = f(x)", "\\frac{d}{dx}F(x) = f(x)", "\\int F'(x)dx = f(x)"],
      correctAnswerIndex: 0,
      explanation: "Họ tất cả các nguyên hàm của f(x) ký hiệu là \\int f(x)dx = F(x) + C.",
      sourceExcerpt: "Họ tất cả các nguyên hàm của f(x) ký hiệu là \\int f(x)dx = F(x) + C.",
    };
    expect(parseGeneratedQuiz(JSON.stringify([bareMathQuestion]), 1, source))
      .toEqual([bareMathQuestion]);
    const alternateDelimiterQuestion = {
      ...bareMathQuestion,
      sourceExcerpt: "Họ tất cả các nguyên hàm của \\(f(x)\\) ký hiệu là \\(\\int f(x)dx = F(x) + C\\).",
    };
    expect(parseGeneratedQuiz(JSON.stringify([alternateDelimiterQuestion]), 1, source))
      .toEqual([alternateDelimiterQuestion]);

    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...bareMathQuestion,
      sourceExcerpt: "Họ tất cả các nguyên hàm của F(x) ký hiệu là \\int f(x)dx = F(x) + C.",
    }]), 1, source)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...bareMathQuestion,
      sourceExcerpt: "Họ tất cả các nguyên hàm của f(x) ký hiệu là \\int f(x)dx = F(x) - C.",
    }]), 1, source)).toThrow();
  });
  it("matches a delimited math answer inside a source formula without relaxing its symbols", () => {
    const source = "The integral result is $\\int f(x)dx = \\tan(x) + C$.";
    const sourceExcerpt = source;
    const makeQuestion = (answer: string, otherOptions: string[]) => ({
      id: "math-answer-q1",
      question: "What does the integral produce?",
      options: [answer, ...otherOptions],
      correctAnswerIndex: 0,
      explanation: "The integral result is \\tan(x) + C.",
      sourceExcerpt,
    });
    const accepted = makeQuestion("$\\tan(x) + C$", ["$\\tan(x) - C$", "$\\tan(x) + D$", "$\\Tan(x) + C$"]);
    expect(parseGroundedQuizCandidates(JSON.stringify([accepted]), 1, source).questions)
      .toEqual([accepted]);

    const rejectedAnswers: Array<[string, string[]]> = [
      ["$\\tan(x) - C$", ["$\\tan(x) + C$", "$\\tan(x) + D$", "$\\tan(x) - D$"]],
      ["$\\tan(x) + D$", ["$\\tan(x) + C$", "$\\tan(x) - C$", "$\\tan(x) - D$"]],
      ["$\\Tan(x) + C$", ["$\\tan(x) + C$", "$\\tan(x) - C$", "$\\tan(x) + D$"]],
    ];
    for (const [answer, otherOptions] of rejectedAnswers) {
      const rejected = makeQuestion(answer, otherOptions);
      const result = parseGroundedQuizCandidates(JSON.stringify([rejected]), 1, source);
      expect(result.questions).toHaveLength(0);
      expect(result.groundingFailure).toBe("ungrounded-answer");
    }
  });
  it("matches the preserved cosine antiderivative answer inside its larger source equation", () => {
    const sourceExcerpt = "Nguyên hàm của hàm sin là âm cosin: \\int \\sin(x)dx = -\\cos(x) + C.";
    const source = "Nguyên hàm của hàm sin là âm cosin: $\\int \\sin(x)dx = -\\cos(x) + C$.";
    const question = {
      id: "q6",
      question: "Nguyên hàm của hàm số sin(x) là gì theo bảng công thức lượng giác cơ bản?",
      options: ["-\\cos(x) + C", "\\cos(x) + C", "\\sin(x) + C", "-\\sin(x) + C"],
      correctAnswerIndex: 0,
      explanation: "Tài liệu chỉ rõ nguyên hàm của hàm sin là âm cosin: \\int \\sin(x)dx = -\\cos(x) + C.",
      sourceExcerpt,
    };
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
      .toEqual([question]);

    for (const answer of ["-\\Cos(x) + C", "-\\cos(x) - C", "-\\cos(x) + D"]) {
      const changed = { ...question, options: [answer, ...question.options.slice(1)] };
      const result = parseGroundedQuizCandidates(JSON.stringify([changed]), 1, source);
      expect(result.questions).toHaveLength(0);
      expect(result.groundingFailure).toBe("ungrounded-answer");
    }
  });
  it("matches the preserved tangent, logarithm, and cotangent answers inside source formulas", () => {
    const cases = [
      {
        id: "q7-tangent",
        question: "Kết quả của phép tính nguyên hàm \\int \\frac{1}{\\cos^2(x)}dx với điều kiện xác định là gì?",
        options: ["\\tan(x) + C", "-\\cot(x) + C", "\\sin(x) + C", "-\\cos(x) + C"],
        explanation: "Tài liệu ghi rõ nguyên hàm liên quan đến bình phương của secant là \\int \\frac{1}{\\cos^2(x)}dx = \\tan(x) + C.",
        sourceExcerpt: "Nguyên hàm liên quan đến bình phương của secant: \\int \\frac{1}{\\cos^2(x)}dx = \\tan(x) + C với x \\neq \\frac{\\pi}{2} + k\\pi.",
        math: "\\int \\frac{1}{\\cos^2(x)}dx = \\tan(x) + C",
      },
      {
        id: "q7-logarithm",
        question: "Khi tính nguyên hàm của hàm phân thức \\int \\frac{1}{x} dx với x khác 0, ta thu được kết quả nào?",
        options: ["\\ln|x| + C", "\\frac{1}{x^2} + C", "-\\frac{1}{x} + C", "e^x + C"],
        explanation: "Tài liệu ghi nhận trường hợp đặc biệt khi n = -1: \\int \\frac{1}{x} dx = \\ln|x| + C với x \\neq 0.",
        sourceExcerpt: "Trường hợp đặc biệt khi n = -1, ta có nguyên hàm của hàm phân thức: \\int \\frac{1}{x} dx = \\ln|x| + C với x \\neq 0.",
        math: "\\int \\frac{1}{x} dx = \\ln|x| + C",
      },
      {
        id: "q8-cotangent",
        question: "Nguyên hàm liên quan đến bình phương của cosecant \\int \\frac{1}{\\sin^2(x)}dx bằng biểu thức nào?",
        options: ["-\\cot(x) + C", "\\tan(x) + C", "\\cot(x) + C", "-\\tan(x) + C"],
        explanation: "Mục các nguyên hàm lượng giác cơ bản nêu rõ: \\int \\frac{1}{\\sin^2(x)}dx = -\\cot(x) + C với x \\neq k\\pi.",
        sourceExcerpt: "Nguyên hàm liên quan đến bình phương của cosecant: \\int \\frac{1}{\\sin^2(x)}dx = -\\cot(x) + C với x \\neq k\\pi.",
        math: "\\int \\frac{1}{\\sin^2(x)}dx = -\\cot(x) + C",
      },
    ];
    for (const candidate of cases) {
      const { math, ...question } = { ...candidate, correctAnswerIndex: 0 };
      const source = candidate.sourceExcerpt.replace(math, `$${math}$`);
      expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
        .toEqual([question]);
    }
  });
  it("rejects a bare excerpt whose math variable changes from lowercase f to uppercase F", () => {
    const source = "The value is $f(x)+C$.";
    const question = {
      id: "math-case-q1",
      question: "What value is shown?",
      options: ["$F(x)+C$", "$f(x)+C$", "$x$", "$C$"],
      correctAnswerIndex: 0,
      explanation: "The value is F(x)+C.",
      sourceExcerpt: "The value is F(x)+C.",
    };
    const result = parseGroundedQuizCandidates(JSON.stringify([question]), 1, source);
    expect(result.questions).toHaveLength(0);
    expect(result.groundingFailure).toBe("missing-excerpt");
  });
  it("preserves case for standalone function and TeX math tokens without operators", () => {
    const cases = [
      {
        id: "bare-function-case-q1",
        source: "The function is $f(x)$.",
        sourceExcerpt: "The function is F(x).",
        options: ["$F(x)$", "$f(x)$", "$x$", "$0$"],
      },
      {
        id: "bare-command-case-q1",
        source: "The symbol is $\\phi$.",
        sourceExcerpt: "The symbol is \\Phi.",
        options: ["$\\Phi$", "$\\phi$", "$x$", "$0$"],
      },
    ];
    for (const candidate of cases) {
      const question = {
        id: candidate.id,
        question: "Which math symbol is shown?",
        options: candidate.options,
        correctAnswerIndex: 0,
        explanation: "The source identifies the symbol.",
        sourceExcerpt: candidate.sourceExcerpt,
      };
      const result = parseGroundedQuizCandidates(JSON.stringify([question]), 1, candidate.source);
      expect(result.questions).toHaveLength(0);
      expect(result.groundingFailure).toBe("missing-excerpt");
    }
  });
  it("matches the exact preserved q10 excerpt when math delimiters are omitted", () => {
    const sourceExcerpt = "Khi gặp biểu thức \\int \\frac{1}{x^2} dx, nhiều học sinh dùng nhầm thành \\ln|x^2| thay vì viết lại thành \\int x^{-2}dx rồi áp dụng quy tắc lũy thừa để ra kết quả -\\frac{1}{x} + C.";
    const source = "Quy ước $K$ là khoảng xét.\n\nKhi gặp biểu thức $\\int \\frac{1}{x^2} dx$, nhiều học sinh dùng nhầm thành $\\ln|x^2|$ thay vì viết lại thành $\\int x^{-2}dx$ rồi áp dụng quy tắc lũy thừa để ra kết quả $-\\frac{1}{x} + C$.";
    const question = {
      id: "q10",
      question: "Khi gặp biểu thức \\int \\frac{1}{x^2} dx, cách biến đổi đúng theo tài liệu là gì?",
      options: [
        "Viết lại thành \\int x^{-2}dx rồi áp dụng quy tắc lũy thừa",
        "Đổi thành ln|x^2| ngay lập tức",
        "Lấy đạo hàm của mẫu số",
        "Bỏ qua số mũ ở mẫu số",
      ],
      correctAnswerIndex: 0,
      explanation: "Viết lại thành \\int x^{-2}dx rồi áp dụng quy tắc lũy thừa.",
      sourceExcerpt,
    };
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
      .toEqual([question]);
  });
  it("accepts an exact prose excerpt after the source contains a math variable with the same letter", () => {
    const source = "Acceleration is $a$. A body absorbs light energy.";
    const sourceExcerpt = "A body absorbs light energy.";
    const question = {
      id: "exact-prose-copy-q1",
      question: "What does the body absorb?",
      options: ["light energy", "sound waves", "heat", "water"],
      correctAnswerIndex: 0,
      explanation: "The body absorbs light energy.",
      sourceExcerpt,
    };
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
      .toEqual([question]);
    const whitespaceVariantSource = "Acceleration is $a$. A  body\nabsorbs light energy.";
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, whitespaceVariantSource).questions)
      .toEqual([question]);
  });
  it("does not anchor standalone K or C inside Khi or Công prose", () => {
    const cases = [
      ["$K$ appears elsewhere. Khi bắt đầu, đạo hàm của x² là 2x.", "Khi bắt đầu, đạo hàm của x² là 2x."],
      ["$C$ appears elsewhere. Công thức đạo hàm của x² là 2x.", "Công thức đạo hàm của x² là 2x."],
    ];
    for (const [source, sourceExcerpt] of cases) {
      const question = {
        id: "math-prose-boundary-q1",
        question: sourceExcerpt.replace("là 2x.", "là gì?"),
        options: ["2x", "x", "0", "1"],
        correctAnswerIndex: 0,
        explanation: sourceExcerpt,
        sourceExcerpt,
      };
      expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
        .toEqual([question]);
    }
  });
  it("anchors standalone K and C math symbols when they are token-delimited", () => {
    const source = "Giá trị $K$ và hằng số $C$ được nêu trong công thức.";
    const question = {
      id: "constants-q1",
      question: "Hằng số nào được nêu?",
      options: ["$C$", "$K$", "$x$", "$0$"],
      correctAnswerIndex: 0,
      explanation: "Tài liệu gọi C là hằng số.",
      sourceExcerpt: "Giá trị K và hằng số C được nêu trong công thức.",
    };
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
      .toEqual([question]);
  });
  it("keeps case-insensitive exact quotation for the preserved prose answer containing plus C", () => {
    const source = "Nhiều bạn học sinh hay quên viết hằng số + C vào cuối kết quả nguyên hàm, dẫn đến thiếu sót về mặt toán học vì nguyên hàm là một họ hàm số chứ không phải một hàm đơn lẻ.";
    const question = {
      id: "q9",
      question: "Lỗi nhầm lẫn phổ biến nào hay xảy ra khi học sinh quên viết vào cuối kết quả nguyên hàm?",
      options: ["Quên viết hằng số + C", "Đổi dấu đạo hàm", "Bỏ nguyên hàm", "Thêm hằng số x"],
      correctAnswerIndex: 0,
      explanation: "Nhiều bạn học sinh hay quên viết hằng số + C vào cuối kết quả nguyên hàm.",
      sourceExcerpt: source,
    };
    expect(parseGroundedQuizCandidates(JSON.stringify([question]), 1, source).questions)
      .toEqual([question]);
  });
  it("rejects the paraphrased correct answers from preserved q3 and q4 responses", () => {
    const q3Excerpt = "Tính liên tục trên một khoảng là điều kiện đủ quen thuộc để bảo đảm hàm số có nguyên hàm trên khoảng đó.";
    const q3 = {
      id: "q3",
      question: "Điều kiện đủ quen thuộc để bảo đảm hàm số có nguyên hàm trên một khoảng là gì?",
      options: ["Tính liên tục trên khoảng đó", "Tính khả vi tại mọi điểm", "Hàm số luôn dương", "Hàm số là hàm đa thức"],
      correctAnswerIndex: 0,
      explanation: "Tài liệu khẳng định tính liên tục trên một khoảng là điều kiện đủ quen thuộc để bảo đảm hàm số có nguyên hàm trên khoảng đó.",
      sourceExcerpt: q3Excerpt,
    };
    const q3Result = parseGroundedQuizCandidates(JSON.stringify([q3]), 1, q3Excerpt);
    expect(q3Result.questions).toHaveLength(0);
    expect(q3Result.groundingFailure).toBe("ungrounded-answer");

    const q4Source = "Thứ hai, ta được phép đưa hằng số khác không ra ngoài dấu nguyên hàm: $\\int k f(x)dx = k \\int f(x)dx$ với $k \\neq 0$.";
    const q4 = {
      id: "q4",
      question: "Tính tuyến tính của nguyên hàm cho phép ta thực hiện điều gì với hằng số k khác không?",
      options: ["Đưa hằng số ra ngoài dấu nguyên hàm", "Bỏ qua hằng số trong biểu thức", "Cộng hằng số vào mọi số hạng", "Biến đổi hằng số thành C"],
      correctAnswerIndex: 0,
      explanation: "Theo tính tuyến tính, ta được phép đưa hằng số khác không ra ngoài dấu nguyên hàm.",
      sourceExcerpt: "ta được phép đưa hằng số khác không ra ngoài dấu nguyên hàm: \\int k f(x)dx = k \\int f(x)dx với k \\neq 0.",
    };
    const q4Result = parseGroundedQuizCandidates(JSON.stringify([q4]), 1, q4Source);
    expect(q4Result.questions).toHaveLength(0);
    expect(q4Result.groundingFailure).toBe("ungrounded-answer");
  });
  it("uses a longer source term when the exact answer is a short word", () => {
    const source = "The cat is asleep.";
    const catQuestion = {
      id: "cat-q1",
      question: "Which animal is asleep?",
      options: ["cat", "dog", "bird", "fish"],
      correctAnswerIndex: 0,
      explanation: "The cat is asleep.",
      sourceExcerpt: source,
    };

    expect(parseGeneratedQuiz(JSON.stringify([catQuestion]), 1, source)).toEqual([catQuestion]);
  });
  it("does not treat one short overlap as concept evidence", () => {
    const englishSource = "The cat is asleep.";
    const unrelatedEnglishQuestion = {
      id: "cat-q2",
      question: "Which sentence appears in this passage?",
      options: ["cat", "dog", "bird", "fish"],
      correctAnswerIndex: 0,
      explanation: "The passage is a sentence about sleep.",
      sourceExcerpt: englishSource,
    };
    expect(() => parseGeneratedQuiz(JSON.stringify([unrelatedEnglishQuestion]), 1, englishSource)).toThrow();
  });

  it("does not treat short English function words as concept evidence", () => {
    const source = "His cat has a nap.";
    const unrelatedDogQuestion = {
      id: "cat-q3",
      question: "What breed is the dog?",
      options: ["cat", "dog", "bird", "fish"],
      correctAnswerIndex: 0,
      explanation: "His claim has no evidence.",
      sourceExcerpt: source,
    };
    expect(() => parseGeneratedQuiz(JSON.stringify([unrelatedDogQuestion]), 1, source)).toThrow();
  });

  it("does not treat Vietnamese stopwords as concept evidence", () => {
    const vietnameseSource = "Đây là một câu trả lời chính xác.";
    const stopwordOnlyQuestion = {
      id: "vietnamese-stopword-q1",
      question: "Đây là nội dung nào?",
      options: ["câu trả lời", "phép tính", "định nghĩa", "ví dụ"],
      correctAnswerIndex: 0,
      explanation: "Đây là một lựa chọn.",
      sourceExcerpt: vietnameseSource,
    };
    expect(() => parseGeneratedQuiz(JSON.stringify([stopwordOnlyQuestion]), 1, vietnameseSource)).toThrow();
  });
  it("keeps Vietnamese math grounding strict when the answer is not quoted or the question is off topic", () => {
    const source = "Đạo hàm của x² là 2x.";
    const derivativeQuestion = {
      id: "derivative-q1",
      question: "Đạo hàm của x² là gì?",
      options: ["2x", "x", "x²", "0"],
      correctAnswerIndex: 0,
      explanation: "Đạo hàm của x² là 2x.",
      sourceExcerpt: source,
    };

    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...derivativeQuestion,
      options: ["3x", "x", "x²", "0"],
    }]), 1, source)).toThrow();
    expect(() => parseGeneratedQuiz(JSON.stringify([{
      ...derivativeQuestion,
      question: "Enzyme ATP synthase tạo ra chất gì?",
      explanation: "ATP synthase tạo năng lượng cho tế bào.",
    }]), 1, source)).toThrow();
  });
  it("accepts a glossary answer when the answer is quoted and its headword grounds the question", () => {
    const source = "abandon (v): từ bỏ, bỏ rơi.";
    expect(parseGeneratedQuiz(JSON.stringify([glossaryQuestion]), 1, source)).toEqual([glossaryQuestion]);
  });
  it("rejects an answer that occurs only inside another source word", () => {
    const source = "partial chart";
    const substringAnswer = {
      ...question,
      question: "What does partial describe?",
      options: ["art", "whole", "complete", "full"],
      correctAnswerIndex: 0,
      explanation: "Partial describes the chart.",
      sourceExcerpt: source,
    };
    expect(() => parseGeneratedQuiz(JSON.stringify([substringAnswer]), 1, source)).toThrow();
    expect(parseGeneratedQuiz(JSON.stringify([{
      ...substringAnswer, options: ["chart", "whole", "complete", "full"],
    }]), 1, source)).toHaveLength(1);
  });
  it("accepts optional knowledge points and a thirty-question response", () => {
    const questions = Array.from({ length: 30 }, (_, index) => ({
      ...question,
      id: `q${index}`,
      knowledgePoint: `Concept ${index}`,
    }));
    expect(parseGeneratedQuiz(JSON.stringify(questions), 30)).toHaveLength(30);
    expect(parseGeneratedQuiz(JSON.stringify([question]), 1)[0]).not.toHaveProperty("knowledgePoint");
  });
  it.each([
    { options: ["A", "B", "C"] }, { options: ["A", "B", "C", "D", "E"] },
    { options: ["A", " a ", "C", "D"] }, { correctAnswerIndex: -1 },
    { correctAnswerIndex: 4 }, { correctAnswerIndex: 1.5 },
    { correctAnswerIndex: "1" }, { question: " " }, { explanation: "" },
    { id: "" }, { knowledgePoint: "" }, { knowledgePoint: "x".repeat(201) }, { extra: true },
  ])("rejects malformed question %j", patch => {
    expect(() => parseGeneratedQuiz(JSON.stringify([{ ...question, ...patch }]), 1)).toThrow();
  });
  it("rejects wrong count, duplicate IDs, envelopes, fenced and oversized JSON", () => {
    for (const [text, count] of [
      [JSON.stringify([question]), 2],
      [JSON.stringify([question, question]), 2],
      [JSON.stringify({ questions: [question] }), 1],
      ["```json\n[]\n```", 1], ["x".repeat(128 * 1024 + 1), 1],
    ] as const) expect(() => parseGeneratedQuiz(text, count)).toThrow();
  });
});
