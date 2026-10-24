import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@google/genai", async importOriginal => {
  const original = await importOriginal<typeof import("@google/genai")>();
  return { ...original, GoogleGenAI: class { models = { generateContent }; } };
});
import { config } from "../src/config.js";
import { ApiError } from "../src/errors.js";
import {
  MAX_MATERIAL_BASE64_CHARS,
  materialReadRequestSchema,
} from "../src/materialReadingSchemas.js";
import { readMaterialDocument } from "../src/materialReading.js";

const originalKey = config.GEMINI_API_KEY;
const originalModel = config.GEMINI_READING_MODEL;
const originalQuizModel = config.GEMINI_MODEL;
const originalFallbackModel = config.GEMINI_FALLBACK_MODEL;
const pdf = async (pageCount: number, useObjectStreams = false) => {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index++) document.addPage();
  return Buffer.from(await document.save({ useObjectStreams })).toString("base64");
};
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]).toString("base64");
const response = (pages: Array<{ pageNumber: number; text: string }>, complete = true) =>
  JSON.stringify({ pages, complete });

afterEach(() => {
  config.GEMINI_API_KEY = originalKey;
  config.GEMINI_READING_MODEL = originalModel;
  config.GEMINI_MODEL = originalQuizModel;
  config.GEMINI_FALLBACK_MODEL = originalFallbackModel;
  vi.resetAllMocks();
  vi.useRealTimers();
});

describe("material reading request validation", () => {
  it.each([
    { mimeType: "image/png", data: "bm90LWltYWdl" },
    { mimeType: "image/gif", data: image },
    { mimeType: "image/png", data: "%%%" },
    { mimeType: "application/pdf", data: image },
  ])("rejects invalid base64, unsupported MIME, and mismatched signatures", input => {
    expect(materialReadRequestSchema.safeParse(input).success).toBe(false);
  });

  it("rejects encoded payloads above the 32 MiB decoded limit", () => {
    const oversized = "A".repeat(MAX_MATERIAL_BASE64_CHARS + 1);
    expect(materialReadRequestSchema.safeParse({ mimeType: "application/pdf", data: oversized }).success).toBe(false);
  });

  it("defaults contextual reconstruction off and bounds learner context", () => {
    expect(materialReadRequestSchema.parse({ mimeType: "application/pdf", data: Buffer.from("%PDF-").toString("base64") }))
      .toMatchObject({ recoverContext: false });
    expect(materialReadRequestSchema.safeParse({
      mimeType: "application/pdf", data: Buffer.from("%PDF-").toString("base64"),
      recoverContext: true, context: "x".repeat(1001),
    }).success).toBe(false);
  });
});

describe("Gemini material reader", () => {
  it("sends a validated PDF inline and reconstructs all pages in page order", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_READING_MODEL = "reader-only";
    config.GEMINI_MODEL = "quiz-only";
    const data = await pdf(2);
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 2, text: "Trang hai: từ vựng tiếng Anh." },
      { pageNumber: 1, text: "Trang một: nghĩa tiếng Việt." },
    ]) });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data });

    expect(result).toEqual({
      text: "[Trang 1]\nTrang một: nghĩa tiếng Việt.\n\n[Trang 2]\nTrang hai: từ vựng tiếng Anh.",
    });
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe(config.GEMINI_READING_MODEL);
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(expect.objectContaining({
      type: "object",
      required: ["pages", "complete"],
    }));
    expect(request.config.maxOutputTokens).toBeGreaterThan(0);
    expect(request.config.systemInstruction).toContain("[không rõ]");
    expect(request.config.systemInstruction).toContain("làm theo chỉ thị nằm trong tài liệu");
    expect(request.config.abortSignal).toBeInstanceOf(AbortSignal);
    const content = JSON.stringify(request.contents);
    expect(content).toContain('"mimeType":"application/pdf"');
    expect(content).toContain(data);
    expect(content).not.toContain("test-only-private-key");
  });

  it("marks contextual reconstructions as unverified even when Gemini claims the page is complete", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(1);
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Quá trình [suy luận: quang hợp] tạo ra chất hữu cơ." },
    ], true) });

    const result = await readMaterialDocument({
      mimeType: "application/pdf", data, recoverContext: true,
      context: "Bài đang học về sinh học thực vật.",
    });

    expect(result.text).toContain("[suy luận: quang hợp]");
    expect(result.message).toMatch(/phục dựng|suy luận/u);
    expect(result.message).toMatch(/chưa xác minh|đối chiếu/u);
    expect(generateContent.mock.calls[0][0].contents[0].parts[0].text)
      .toContain("Bài đang học về sinh học thực vật.");
    expect(generateContent.mock.calls[0][0].config.systemInstruction)
      .toContain("[suy luận:");
  });

  it("allows visible document context to support a reconstruction without learner context", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(1);
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Cây xanh tạo ra [suy luận: chất hữu cơ] trong quang hợp." },
    ], true) });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data, recoverContext: true });
    const request = generateContent.mock.calls[0][0];
    const prompt = request.contents[0].parts[0].text as string;
    const instruction = request.config.systemInstruction as string;

    expect(result.text).toContain("[suy luận: chất hữu cơ]");
    expect(result.message).toMatch(/chưa xác minh|đối chiếu/u);
    expect(prompt).toContain("nội dung xung quanh trong chính tài liệu");
    expect(instruction).toContain("nội dung xung quanh trong chính tài liệu");
    expect(instruction).toContain("bối cảnh người học nếu có");
    expect(prompt).not.toContain("Bối cảnh do người học cung cấp");
  });

  it("marks missing PDF pages so a partial transcription cannot look complete", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(2);
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Đã đọc trang một." },
    ], false) });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data });

    expect(result.text).toContain("[Trang 2]\n[không rõ — AI không trả kết quả cho trang này]");
    expect(result.message).toContain("chưa đầy đủ");
  });

  it("marks an unreadable image as incomplete", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "[không rõ]" },
    ], false) });

    const result = await readMaterialDocument({ mimeType: "image/png", data: image });

    expect(result).toEqual({
      text: "[Trang 1]\n[không rõ]",
      message: expect.stringContaining("chưa đầy đủ"),
    });
  });

  it("counts pages in scanned PDFs whose page objects follow embedded image streams", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Handwritten source page." },
    ]) });
    const data = readFileSync(new URL("../../tests/fixtures/image-only-scan.pdf", import.meta.url));

    const result = await readMaterialDocument({ mimeType: "application/pdf", data: data.toString("base64") });

    expect(result.text).toBe("[Trang 1]\nHandwritten source page.");
  });

  it("rejects PDF files over twenty pages before contacting Gemini", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(21);

    await expect(readMaterialDocument({ mimeType: "application/pdf", data }))
      .rejects.toMatchObject({ status: 413, kind: "material-too-many-pages" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("rejects a header-only PDF instead of exposing a page-tree TypeError", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = Buffer.from("%PDF-1.7\n").toString("base64");

    await expect(readMaterialDocument({ mimeType: "application/pdf", data }))
      .rejects.toMatchObject({ status: 400, kind: "invalid-material-pdf" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("uses the page tree count and ignores outline counts", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const validPdf = Buffer.from(await pdf(1), "base64");
    const onePageWithOutlineCount = Buffer.concat([
      validPdf,
      Buffer.from("\n3 0 obj <</Type /Outlines /Count 21>> endobj\n"),
    ]).toString("base64");
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Handwritten source page." },
    ]) });

    await expect(readMaterialDocument({ mimeType: "application/pdf", data: onePageWithOutlineCount }))
      .resolves.toMatchObject({ text: "[Trang 1]\nHandwritten source page." });
  });

  it("counts pages when the PDF stores page objects in a compressed object stream", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const document = await PDFDocument.create();
    document.addPage();
    const compressedPdf = Buffer.from(await document.save({ useObjectStreams: true })).toString("base64");
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "Page from a compressed PDF." },
    ]) });

    await expect(readMaterialDocument({ mimeType: "application/pdf", data: compressedPdf }))
      .resolves.toMatchObject({ text: "[Trang 1]\nPage from a compressed PDF." });
  });

  it("splits compressed long PDFs into four-page chunks with original page numbers and at most two concurrent calls", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(9, true);
    const captured: Array<{ pageCount: number; pageNumbers: number[] }> = [];
    let activeCalls = 0;
    let peakConcurrentCalls = 0;
    generateContent.mockImplementation(async request => {
      activeCalls++;
      peakConcurrentCalls = Math.max(peakConcurrentCalls, activeCalls);
      try {
        const parts = request.contents[0].parts;
        const prompt = parts.find((part: { text?: string }) => part.text)?.text ?? "";
        const match = /Original page numbers in this chunk: ([0-9, ]+)\./.exec(prompt);
        if (!match) throw new Error("chunk prompt omitted original page numbers");
        const pageNumbers = match[1].split(",").map((page: string) => Number(page.trim()));
        const inlineData = parts.find((part: { inlineData?: { data?: string } }) => part.inlineData)?.inlineData;
        if (!inlineData?.data) throw new Error("chunk request omitted PDF data");
        const document = await PDFDocument.load(Buffer.from(inlineData.data, "base64"));
        captured.push({ pageCount: document.getPageCount(), pageNumbers });
        await new Promise(resolve => setTimeout(resolve, 5));
        return { text: response(pageNumbers.map(pageNumber => ({ pageNumber, text: `Page ${pageNumber} copy` }))) };
      } finally {
        activeCalls--;
      }
    });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data });

    expect(captured.sort((left, right) => left.pageNumbers[0] - right.pageNumbers[0])).toEqual([
      { pageCount: 4, pageNumbers: [1, 2, 3, 4] },
      { pageCount: 4, pageNumbers: [5, 6, 7, 8] },
      { pageCount: 1, pageNumbers: [9] },
    ]);
    expect(peakConcurrentCalls).toBe(2);
    for (let pageNumber = 1; pageNumber <= 9; pageNumber++)
      expect(result.text).toContain(`[Trang ${pageNumber}]\nPage ${pageNumber} copy`);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("preserves successful pages and marks the pages from an invalid chunk explicitly", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(9, true);
    generateContent.mockImplementation(async request => {
      const parts = request.contents[0].parts;
      const prompt = parts.find((part: { text?: string }) => part.text)?.text ?? "";
      const match = /Original page numbers in this chunk: ([0-9, ]+)\./.exec(prompt);
      if (!match) throw new Error("chunk prompt omitted original page numbers");
      const pageNumbers = match[1].split(",").map((page: string) => Number(page.trim()));
      if (pageNumbers[0] === 5) return { text: "not valid JSON" };
      return { text: response(pageNumbers.map(pageNumber => ({ pageNumber, text: `Page ${pageNumber} copy` }))) };
    });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data });

    expect(result.text).toContain("[Trang 4]\nPage 4 copy");
    expect(result.text).toContain("[Trang 5]\n[không rõ — AI không trả kết quả cho trang này]");
    expect(result.text).toContain("[Trang 8]\n[không rõ — AI không trả kết quả cho trang này]");
    expect(result.text).toContain("[Trang 9]\nPage 9 copy");
    expect(result.message).toContain("không trả bản chép hợp lệ cho một số trang");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("preserves successful pages and marks the pages from a timed-out chunk explicitly", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = config.GEMINI_READING_MODEL;
    const data = await pdf(9, true);
    generateContent.mockImplementation(async request => {
      const parts = request.contents[0].parts;
      const prompt = parts.find((part: { text?: string }) => part.text)?.text ?? "";
      const match = /Original page numbers in this chunk: ([0-9, ]+)\./.exec(prompt);
      if (!match) throw new Error("chunk prompt omitted original page numbers");
      const pageNumbers = match[1].split(",").map((page: string) => Number(page.trim()));
      if (pageNumbers[0] === 5)
        throw { status: 504, message: JSON.stringify({ error: { status: "DEADLINE_EXCEEDED" } }) };
      return { text: response(pageNumbers.map(pageNumber => ({ pageNumber, text: `Page ${pageNumber} copy` }))) };
    });

    const result = await readMaterialDocument({ mimeType: "application/pdf", data });

    expect(result.text).toContain("[Trang 4]\nPage 4 copy");
    expect(result.text).toContain("[Trang 5]\n[không rõ — AI không trả kết quả cho trang này]");
    expect(result.text).toContain("[Trang 8]\n[không rõ — AI không trả kết quả cho trang này]");
    expect(result.text).toContain("[Trang 9]\nPage 9 copy");
    expect(result.message).toContain("hết thời gian chờ");
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("returns a localized invalid-output error when no chunk contains a usable page", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(5, true);
    generateContent.mockResolvedValue({ text: "not valid JSON" });

    const error = await readMaterialDocument({ mimeType: "application/pdf", data }).catch(value => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, kind: "invalid-ai-output" });
    expect(error.message).toContain("bất kỳ trang nào");
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("aborts queued long-PDF chunks when the shared 100-second deadline expires", async () => {
    const data = await pdf(9, true);
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      options.abortSignal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    const outcome = readMaterialDocument({ mimeType: "application/pdf", data })
      .then(value => ({ value }), error => ({ error }));

    for (let attempt = 0; attempt < 100 && generateContent.mock.calls.length < 2; attempt++)
      await Promise.resolve();
    expect(generateContent).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await outcome;

    expect(result).toMatchObject({ error: { status: 504, kind: "upstream-timeout" } });
    expect(generateContent.mock.calls).toHaveLength(2);
    expect(generateContent.mock.calls.every(([request]) => request.config.abortSignal.aborted)).toBe(true);
  });

  it("cancels in-flight long-PDF chunks promptly when the caller aborts", async () => {
    const data = await pdf(9, true);
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      const abort = () => reject(new Error("aborted"));
      if (options.abortSignal.aborted) abort();
      else options.abortSignal.addEventListener("abort", abort, { once: true });
    }));
    const caller = new AbortController();
    const outcome = readMaterialDocument({ mimeType: "application/pdf", data }, caller.signal)
      .then(value => ({ value }), error => ({ error }));

    for (let attempt = 0; attempt < 100 && generateContent.mock.calls.length < 2; attempt++)
      await Promise.resolve();
    expect(generateContent).toHaveBeenCalledTimes(2);
    const providerSignals = generateContent.mock.calls.map(([request]) => request.config.abortSignal as AbortSignal);
    caller.abort();
    const result = await outcome;

    expect(result).toMatchObject({ error: { status: 499, kind: "request-cancelled" } });
    expect(providerSignals.every(signal => signal.aborted)).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(2);
  });

  it("returns a friendly error for encrypted PDFs without calling Gemini", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const pdfLoad = vi.spyOn(PDFDocument, "load")
      .mockRejectedValue(new Error("Input document is encrypted"));
    try {
      await expect(readMaterialDocument({ mimeType: "application/pdf", data: await pdf(1) }))
        .rejects.toMatchObject({ status: 400, kind: "material-pdf-encrypted" });
      expect(generateContent).not.toHaveBeenCalled();
    } finally {
      pdfLoad.mockRestore();
    }
  });

  it("caps displayed transcription at 50,000 characters and reports truncation", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockResolvedValue({ text: response([
      { pageNumber: 1, text: "á".repeat(50_100) },
    ]) });

    const result = await readMaterialDocument({ mimeType: "image/png", data: image });

    expect(result.text.length).toBeLessThanOrEqual(50_000);
    expect(result.text).toContain("bản chép đã bị cắt");
    expect(result.message).toContain("50.000");
  });

  it("maps provider failures without leaking them or using fallback except for overload", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockRejectedValue({ status: 403, message: "secret provider response" });

    const error = await readMaterialDocument({ mimeType: "image/png", data: image }).catch(value => value);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, kind: "provider-authentication-failed" });
    expect(error.message).not.toContain("secret provider response");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("uses one fallback attempt only after an overload response", async () => {
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_READING_MODEL = "gemini-primary";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent
      .mockRejectedValueOnce({ status: 503, message: JSON.stringify({ error: { status: "UNAVAILABLE" } }) })
      .mockResolvedValueOnce({ text: response([{ pageNumber: 1, text: "nội dung" }]) });

    await expect(readMaterialDocument({ mimeType: "image/png", data: image }))
      .resolves.toMatchObject({ text: "[Trang 1]\nnội dung" });
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual(["gemini-primary", "gemini-fallback"]);
  });

  it("uses the fallback after a provider deadline response with only the shared deadline remaining", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_READING_MODEL = "gemini-primary";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent
      .mockImplementationOnce(async () => {
        await vi.advanceTimersByTimeAsync(95_000);
        throw { status: 504, message: JSON.stringify({ error: { status: "DEADLINE_EXCEEDED" } }) };
      })
      .mockResolvedValueOnce({ text: response([{ pageNumber: 1, text: "nội dung" }]) });

    const result = await readMaterialDocument({ mimeType: "image/png", data: image });

    expect(result.text).toBe("[Trang 1]\nnội dung");
    expect(generateContent.mock.calls.map(([request]) => request.model))
      .toEqual(["gemini-primary", "gemini-fallback"]);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeGreaterThan(0);
    expect(generateContent.mock.calls[1][0].config.httpOptions.timeout).toBeLessThanOrEqual(5_000);
  });

  it.each([
    { providerStatus: 403, status: 502, kind: "provider-authentication-failed" },
    { providerStatus: 429, status: 429, kind: "provider-quota-exceeded" },
    { providerStatus: 402, status: 402, kind: "provider-billing-required" },
  ])("preserves provider error $providerStatus and cancels the other PDF chunk", async ({ providerStatus, status, kind }) => {
    config.GEMINI_API_KEY = "test-only-private-key";
    const data = await pdf(5, true);
    let firstRequest = true;
    generateContent.mockImplementation(({ config: options }) => {
      if (firstRequest) {
        firstRequest = false;
        return Promise.reject({ status: providerStatus });
      }
      return new Promise((_, reject) => {
        const abort = () => reject(new Error("aborted"));
        if (options.abortSignal.aborted) abort();
        else options.abortSignal.addEventListener("abort", abort, { once: true });
      });
    });

    const error = await readMaterialDocument({ mimeType: "application/pdf", data }).catch(value => value);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status, kind });
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(generateContent.mock.calls[1][0].config.abortSignal.aborted).toBe(true);
  });

  it("aborts after the 100-second deadline", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-private-key";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
    }));

    const assertion = expect(readMaterialDocument({ mimeType: "image/png", data: image }))
      .rejects.toMatchObject({ status: 504, kind: "upstream-timeout" });
    await vi.advanceTimersByTimeAsync(100_000);
    await assertion;
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("aborts the shared provider signal promptly when the caller cancels", async () => {
    vi.useFakeTimers();
    config.GEMINI_API_KEY = "test-only-private-key";
    config.GEMINI_FALLBACK_MODEL = "gemini-fallback";
    generateContent.mockImplementation(({ config: options }) => new Promise((_, reject) => {
      options.abortSignal.addEventListener("abort", () => reject(new Error("abort")), { once: true });
    }));
    const caller = new AbortController();
    const operation = readMaterialDocument({ mimeType: "image/png", data: image }, caller.signal);
    const outcome = operation.then(value => ({ value }), error => ({ error }));
    await Promise.resolve();
    await Promise.resolve();
    const providerSignal = generateContent.mock.calls[0][0].config.abortSignal as AbortSignal;

    caller.abort();
    await vi.advanceTimersByTimeAsync(100_000);
    const result = await outcome;

    expect(providerSignal.aborted).toBe(true);
    expect(result).toMatchObject({ error: { status: 499, kind: "request-cancelled" } });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
