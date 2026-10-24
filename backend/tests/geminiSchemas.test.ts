import { describe, expect, it } from "vitest";
import { geminiRequestSchema, parseGeneratedQuiz } from "../src/geminiSchemas.js";

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
