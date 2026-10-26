import { afterEach, describe, expect, it, vi } from "vitest";

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});

import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import * as materialReading from "../src/materialReading.js";
import * as materialReadingSchemas from "../src/materialReadingSchemas.js";

const schemaExports = materialReadingSchemas as unknown as Record<string, unknown>;
const requestSchema = schemaExports.materialSummaryRequestSchema as {
  parse(input: unknown): { text: string };
  safeParse(input: unknown): { success: boolean };
} | undefined;
const responseSchema = schemaExports.materialSummaryResponseSchema as {
  parse(input: unknown): { summary: string };
  safeParse(input: unknown): { success: boolean };
} | undefined;
const summarizeMaterialText = (materialReading as unknown as Record<string, unknown>)
  .summarizeMaterialText as ((input: { text: string }, signal?: AbortSignal) => Promise<{ summary: string }>) | undefined;

const originalKey = config.GEMINI_API_KEY;
const originalReadingModel = config.GEMINI_READING_MODEL;

afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  config.GEMINI_READING_MODEL = originalReadingModel;
  vi.resetAllMocks();
});

describe("material summary schemas", () => {
  it("preserves the exact source string while enforcing trimmed and code-unit limits", () => {
    expect(requestSchema).toBeDefined();
    if (!requestSchema) return;

    const source = "  Nội dung nguồn có khoảng trắng đầu cuối.  \n";
    expect(requestSchema.parse({ text: source }).text).toBe(source);
    expect(requestSchema.safeParse({ text: ` ${"x".repeat(8)} ` }).success).toBe(false);
    expect(requestSchema.parse({ text: "x".repeat(50_000) }).text).toHaveLength(50_000);
    expect(requestSchema.parse({ text: "😀".repeat(25_000) }).text.length).toBe(50_000);
    expect(requestSchema.safeParse({ text: "x".repeat(50_001) }).success).toBe(false);
    expect(requestSchema.safeParse({ text: "😀".repeat(25_001) }).success).toBe(false);
    expect(requestSchema.safeParse({ text: source, unexpected: true }).success).toBe(false);
  });

  it("trims generated summaries and rejects empty, oversized, or extra fields", () => {
    expect(responseSchema).toBeDefined();
    if (!responseSchema) return;

    expect(responseSchema.parse({ summary: "  Tóm tắt nội dung chính.  " }).summary)
      .toBe("Tóm tắt nội dung chính.");
    expect(responseSchema.parse({ summary: ` ${"😀".repeat(2_000)} ` }).summary.length).toBe(4_000);
    expect(responseSchema.safeParse({ summary: ` ${"😀".repeat(2_001)} ` }).success).toBe(false);
    expect(responseSchema.parse({ summary: "x".repeat(4_000) }).summary).toHaveLength(4_000);
    expect(responseSchema.safeParse({ summary: "   " }).success).toBe(false);
    expect(responseSchema.safeParse({ summary: "x".repeat(4_001) }).success).toBe(false);
    expect(responseSchema.safeParse({ summary: "Nội dung.", extra: true }).success).toBe(false);
  });
});

describe("Gemini material summary", () => {
  it("summarizes only the submitted source and validates a strict JSON response", async () => {
    expect(typeof summarizeMaterialText).toBe("function");
    if (!summarizeMaterialText) return;

    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_READING_MODEL = "summary-model";
    const source = "  Nội dung nguồn nguyên văn: hình bình hành có hai cặp cạnh song song.  \n";
    generateContent.mockResolvedValue({ text: JSON.stringify({ summary: "  Hình bình hành có hai cặp cạnh đối song song.  " }) });
    const caller = new AbortController();

    await expect(summarizeMaterialText({ text: source }, caller.signal)).resolves.toEqual({
      summary: "Hình bình hành có hai cặp cạnh đối song song.",
    });
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe("summary-model");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    });
    expect(JSON.parse(request.contents)).toEqual({ sourceText: source });
    expect(request.config.systemInstruction).toMatch(/chỉ.*nguồn|không.*thêm.*nguồn/iu);
    expect(request.config.systemInstruction).toMatch(/không.*làm theo.*chỉ dẫn/iu);
    expect(request.config.abortSignal).toBe(caller.signal);
    expect(JSON.stringify(request)).not.toContain("test-only-private-key");
  });

  it("rejects malformed or oversized provider summaries without returning provider details", async () => {
    expect(typeof summarizeMaterialText).toBe("function");
    if (!summarizeMaterialText) return;

    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: JSON.stringify({ summary: "x".repeat(4_001) }) });

    await expect(summarizeMaterialText({ text: "Nguồn học tập có đủ mười ký tự." }))
      .rejects.toMatchObject({ status: 502, kind: "invalid-ai-output" });
  });

  it("maps provider errors without exposing their private message", async () => {
    expect(typeof summarizeMaterialText).toBe("function");
    if (!summarizeMaterialText) return;

    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockRejectedValueOnce({ status: 400, message: "private provider details" });

    const error = await summarizeMaterialText({ text: "Nguồn học tập có đủ mười ký tự." })
      .then(() => null, cause => cause as ApiError);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, kind: "provider-configuration-error" });
    expect(error?.message).not.toContain("private provider details");
  });

  it("does not call Gemini when the caller is already cancelled", async () => {
    expect(typeof summarizeMaterialText).toBe("function");
    if (!summarizeMaterialText) return;

    config.GEMINI_API_KEY = "test-only-private-key";
    const caller = new AbortController();
    caller.abort();

    await expect(summarizeMaterialText({ text: "Nguồn học tập có đủ mười ký tự." }, caller.signal))
      .rejects.toMatchObject({ status: 499, kind: "request-cancelled" });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
