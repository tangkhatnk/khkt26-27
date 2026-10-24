import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareMaterialWorker } from '../scripts/prepare-material-worker.mjs';
import { createWorker } from 'tesseract.js';
import {
  MAX_DECODED_IMAGE_PIXELS,
  MAX_OCR_PAGES_PER_FILE,
  MAX_PDF_PAGES,
  createOcrClient,
  extractImageWithOcr,
  extractPdfPagesWithOcr,
  inspectImageDimensions,
  renderPdfPageToBlob,
} from '../src/material/ocrMaterial.mjs';

function pngHeader(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width, height) {
  return new Uint8Array([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
  ]);
}

function webpHeader(width, height) {
  const bytes = new Uint8Array(30);
  bytes.set([...Buffer.from('RIFF'), 22, 0, 0, 0, ...Buffer.from('WEBPVP8X')]);
  bytes[16] = 10;
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[24] = widthMinusOne & 0xff;
  bytes[25] = (widthMinusOne >>> 8) & 0xff;
  bytes[26] = (widthMinusOne >>> 16) & 0xff;
  bytes[27] = heightMinusOne & 0xff;
  bytes[28] = (heightMinusOne >>> 8) & 0xff;
  bytes[29] = (heightMinusOne >>> 16) & 0xff;
  return bytes;
}

function bmpHeader(width, height) {
  const bytes = new Uint8Array(54);
  bytes.set(Buffer.from('BM'));
  const view = new DataView(bytes.buffer);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  return bytes;
}

function fakePdf(pageTexts) {
  const visitedPages = [];
  return {
    visitedPages,
    numPages: pageTexts.length,
    async getPage(pageNumber) {
      visitedPages.push(pageNumber);
      return {
        async getTextContent() {
          return { items: pageTexts[pageNumber - 1] ? [{ str: pageTexts[pageNumber - 1] }] : [] };
        },
        cleanup() {},
        pageNumber,
      };
    },
  };
}

function fakeOcrClient(recognize) {
  const calls = [];
  return {
    calls,
    client: {
      async recognize(image, metadata) {
        calls.push({ image, ...metadata });
        return recognize(image, metadata);
      },
      terminate() {},
    },
  };
}

test('preflights PNG, JPEG, WebP, and BMP dimensions before decoding', () => {
  assert.deepEqual(inspectImageDimensions(pngHeader(640, 480)), {
    width: 640, height: 480, pixels: 307_200, mime: 'image/png',
  });
  assert.deepEqual(inspectImageDimensions(jpegHeader(800, 600)), {
    width: 800, height: 600, pixels: 480_000, mime: 'image/jpeg',
  });
  assert.deepEqual(inspectImageDimensions(webpHeader(320, 200)), {
    width: 320, height: 200, pixels: 64_000, mime: 'image/webp',
  });
  assert.deepEqual(inspectImageDimensions(bmpHeader(120, 90)), {
    width: 120, height: 90, pixels: 10_800, mime: 'image/bmp',
  });

  assert.throws(
    () => inspectImageDimensions(pngHeader(5_000, 5_000)),
    new RegExp(`more than ${MAX_DECODED_IMAGE_PIXELS} pixels`),
  );
  assert.throws(() => inspectImageDimensions(new Uint8Array([1, 2, 3])), /unsupported or malformed image/i);
});

test('mixed PDFs preserve selectable text and OCR only short or empty pages', async () => {
  const usefulText = 'This searchable page already contains enough selectable lesson text to keep.';
  const pdf = fakePdf([usefulText, 'Short heading', '', 'Title']);
  const progress = [];
  const { calls, client } = fakeOcrClient(async (_image, { page }) => {
    if (page === 2) return { text: 'OCR page two\npaired meaning', confidence: 82 };
    if (page === 3) return { text: 'OCR page three', confidence: 42 };
    return { text: '', confidence: 10 };
  });

  const result = await extractPdfPagesWithOcr(pdf, {
    async renderPage(page) { return `rendered-${page.pageNumber}`; },
    createOcrClient: () => client,
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(calls.map(({ page }) => page), [2, 3, 4]);
  assert.ok(result.text.includes(usefulText));
  assert.ok(result.text.includes('Short heading'));
  assert.ok(result.text.includes('OCR page two\npaired meaning'));
  assert.ok(result.text.includes('OCR page three'));
  assert.ok(result.text.includes('Title'), 'short selectable text remains if OCR returns no text');
  assert.deepEqual(pdf.visitedPages, [1, 2, 3, 4]);
  assert.equal(result.source, 'mixed');
  assert.equal(result.quality, 'needs-review');
  assert.equal(result.confidence, 62);
  assert.ok(progress.some((event) => event.phase === 'rendering' && event.page === 2));
  assert.ok(progress.some((event) => event.phase === 'extracting' && event.totalPages === 4));
});

test('selectable PDF text preserves line boundaries and remains distinguishable from OCR', async () => {
  const pdf = fakePdf(['']);
  pdf.getPage = async () => ({
    async getTextContent() {
      return { items: [
        { str: '1. conserve', transform: [1, 0, 0, 1, 40, 700], hasEOL: true },
        { str: 'bảo tồn nghĩa của từ và ghi nhớ cách dùng', transform: [1, 0, 0, 1, 40, 680], hasEOL: true },
      ] };
    },
    cleanup() {},
  });
  const result = await extractPdfPagesWithOcr(pdf, {
    renderPage() { assert.fail('selectable text must not be OCRed'); },
    createOcrClient() { assert.fail('selectable text must not load OCR'); },
  });
  assert.match(result.text, /1\. conserve\nbảo tồn nghĩa/iu);
  assert.equal(result.source, 'embedded-text');
  assert.equal(result.quality, undefined);
  assert.equal(result.confidence, undefined);
});

test('image OCR returns the original lines, confidence, and a mandatory review marker', async () => {
  const fixture = fileURLToPath(new URL('./fixtures/high-contrast-vietnamese-english.png', import.meta.url));
  const { text, confidence, source, quality } = await extractImageWithOcr(
    new Uint8Array(await readFile(fixture)),
    { createOcrClient: () => ({
      async recognize() { return { text: 'term one\nnghĩa thứ nhất\nterm two\nnghĩa thứ hai', confidence: 31 }; },
      terminate() {},
    }) },
  );
  assert.equal(text, 'term one\nnghĩa thứ nhất\nterm two\nnghĩa thứ hai');
  assert.equal(confidence, 31);
  assert.equal(source, 'local-ocr');
  assert.equal(quality, 'needs-review');

  const apparentlyClear = await extractImageWithOcr(
    new Uint8Array(await readFile(fixture)),
    { createOcrClient: () => ({
      async recognize() { return { text: 'term\nmeaning', confidence: 99 }; },
      terminate() {},
    }) },
  );
  assert.equal(apparentlyClear.quality, 'needs-review', 'confidence alone never verifies OCR text');
});

test('a zero remaining text budget does not create OCR or render a page', async () => {
  const pdf = fakePdf(['']);
  let created = false;
  const result = await extractPdfPagesWithOcr(pdf, {
    maxTextChars: 0,
    async renderPage() { assert.fail('zero budget must not render'); },
    createOcrClient() { created = true; throw new Error('OCR must not start'); },
  });
  assert.equal(result.truncated, true);
  assert.equal(result.text, '');
  assert.equal(created, false);
  assert.deepEqual(pdf.visitedPages, []);
});

test('PDF and OCR work are capped at 20 pages while retaining completed text', async () => {
  assert.equal(MAX_PDF_PAGES, 20);
  assert.equal(MAX_OCR_PAGES_PER_FILE, 20);
  const scanned = fakePdf(Array.from({ length: MAX_PDF_PAGES + 2 }, () => ''));
  const { calls, client } = fakeOcrClient(async (_image, { page }) => `Recognized scanned page ${page}`);
  const limitedOcr = await extractPdfPagesWithOcr(scanned, {
    async renderPage(page) { return page.pageNumber; },
    createOcrClient: () => client,
  });

  assert.equal(calls.length, MAX_PDF_PAGES);
  assert.equal(limitedOcr.truncated, true);
  assert.match(limitedOcr.message, /Đã đọc được 20 trang đầu/iu);
  assert.match(limitedOcr.text, new RegExp(`Recognized scanned page ${MAX_PDF_PAGES}`));
  assert.doesNotMatch(limitedOcr.text, new RegExp(`Recognized scanned page ${MAX_PDF_PAGES + 1}`));

  const overlongPdf = fakePdf(Array.from({ length: MAX_PDF_PAGES + 1 }, (_, index) =>
    `Searchable page ${index + 1} contains enough selectable text to avoid OCR.`));
  const pageCapped = await extractPdfPagesWithOcr(overlongPdf, {
    async renderPage() { assert.fail('selectable PDF pages must not render'); },
    createOcrClient() { assert.fail('selectable PDF pages must not load OCR'); },
  });

  assert.equal(overlongPdf.visitedPages.length, MAX_PDF_PAGES);
  assert.equal(pageCapped.truncated, true);
  assert.match(pageCapped.text, new RegExp(`Searchable page ${MAX_PDF_PAGES}`));
  assert.doesNotMatch(pageCapped.text, new RegExp(`Searchable page ${MAX_PDF_PAGES + 1}`));
});

test('a timed out PDF page keeps earlier selectable text and destroys the parser', async () => {
  let destroyed = 0;
  const pdf = {
    numPages: 3,
    async getPage(pageNumber) {
      return {
        async getTextContent() {
          if (pageNumber === 2) return new Promise(() => {});
          return { items: [{ str: `Searchable page ${pageNumber} contains enough selectable text to avoid OCR.` }] };
        },
        cleanup() {},
      };
    },
    async destroy() { destroyed += 1; },
  };

  const result = await extractPdfPagesWithOcr(pdf, {
    readBudgetMs: 500,
    pageReadTimeoutMs: 10,
    async renderPage() { assert.fail('searchable pages must not render'); },
    createOcrClient() { assert.fail('searchable pages must not create OCR'); },
  });

  assert.equal(result.truncated, true);
  assert.match(result.message, /các trang đã đọc/iu);
  assert.match(result.text, /Searchable page 1/);
  assert.doesNotMatch(result.text, /Searchable page 3/);
  assert.equal(destroyed, 1);
});

test('cancelling while the local OCR worker is loading terminates the worker', async () => {
  const controller = new AbortController();
  const listeners = new Map();
  const worker = {
    terminated: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage() {},
    terminate() { this.terminated = true; },
  };
  const client = createOcrClient({
    signal: controller.signal,
    workerFactory: () => worker,
    timeoutMs: 5_000,
  });
  const recognition = client.recognize(new Blob(['image']), { page: 1, totalPages: 1 });

  controller.abort();
  await assert.rejects(recognition, { name: 'AbortError' });
  assert.equal(worker.terminated, true);
  client.terminate();
});

test('OCR worker initialization and recognition have a terminating wall-clock limit', async () => {
  const listeners = new Map();
  const worker = {
    terminated: false,
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage() {},
    terminate() { this.terminated = true; },
  };
  const client = createOcrClient({ workerFactory: () => worker, timeoutMs: 20 });

  await assert.rejects(
    client.recognize(new Blob(['image']), { page: 1, totalPages: 1 }),
    { name: 'OcrTimeoutError' },
  );
  assert.equal(worker.terminated, true);
  client.terminate();
});

test('OCR worker result messages preserve recognized confidence and line breaks', async () => {
  const listeners = new Map();
  const worker = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    postMessage() {},
    terminate() {},
  };
  const client = createOcrClient({ workerFactory: () => worker, timeoutMs: 500 });
  const resultPromise = client.recognize(new Blob(['image']), { page: 1, totalPages: 1 });
  listeners.get('message')({ data: {
    type: 'result', id: 1, text: 'vocabulary\nnghĩa tiếng Việt', confidence: 27,
  } });
  assert.deepEqual(await resultPromise, { text: 'vocabulary\nnghĩa tiếng Việt', confidence: 27 });
  client.terminate();
});

test('local OCR reads Vietnamese and English from the bundled trained data', { timeout: 120_000 }, async () => {
  await prepareMaterialWorker();
  const worker = await createWorker(['eng', 'vie'], 1, {
    langPath: path.resolve('public/ocr/lang'),
    cacheMethod: 'none',
  });
  const fixture = fileURLToPath(new URL('./fixtures/high-contrast-vietnamese-english.png', import.meta.url));
  try {
    const { data } = await worker.recognize(fixture);
    assert.ok(Number.isFinite(data.confidence), 'Tesseract returns a page confidence score');
    assert.ok(data.confidence >= 0 && data.confidence <= 100);
    assert.match(data.text, /Ga Khởi đầu.*Đồng cỏ Gió/u);
    assert.match(data.text, /Thời gian tập trung: 25 phút/u);
    assert.match(data.text, /English line: Read, notice, and record three ideas\./u);
  } finally {
    await worker.terminate();
  }
});

test('real scanned and mixed PDFs retain digital text and OCR scanned pages locally', { timeout: 120_000 }, async (t) => {
  let canvasApi;
  try {
    canvasApi = await import('@napi-rs/canvas');
  } catch {
    t.skip('PDF.js optional Node canvas support is unavailable');
    return;
  }

  await prepareMaterialWorker();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const previousGlobals = {
    DOMMatrix: globalThis.DOMMatrix,
    ImageData: globalThis.ImageData,
    Path2D: globalThis.Path2D,
    OffscreenCanvas: globalThis.OffscreenCanvas,
  };
  globalThis.DOMMatrix = canvasApi.DOMMatrix;
  globalThis.ImageData = canvasApi.ImageData;
  globalThis.Path2D = canvasApi.Path2D;
  globalThis.OffscreenCanvas = class TestOffscreenCanvas {
    constructor(width, height) { return canvasApi.createCanvas(width, height); }
  };
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs'),
  ).href;

  const ocrPages = [];
  let ocrWorker;
  const extractFixture = async (filename) => {
    const data = new Uint8Array(await readFile(fileURLToPath(new URL(`./fixtures/${filename}`, import.meta.url))));
    const loadingTask = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      maxImageSize: MAX_DECODED_IMAGE_PIXELS,
      useWorkerFetch: false,
    });
    try {
      const pdf = await loadingTask.promise;
      return await extractPdfPagesWithOcr(pdf, {
        renderPage: (page, metadata) => renderPdfPageToBlob(page, metadata),
        createOcrClient: () => ({
          async recognize(blob, { page }) {
            ocrPages.push(page);
            const { data: recognized } = await ocrWorker.recognize(Buffer.from(await blob.arrayBuffer()));
            return recognized.text;
          },
          terminate() {},
        }),
      });
    } finally {
      await loadingTask.destroy();
    }
  };

  try {
    ocrWorker = await createWorker(['eng', 'vie'], 1, {
      langPath: path.resolve('public/ocr/lang'),
      cacheMethod: 'none',
    });
    const scanned = await extractFixture('image-only-scan.pdf');
    assert.equal(scanned.truncated, false);
    assert.match(scanned.text, /Ga Khởi đầu.*Đồng cỏ Gió/u);
    assert.match(scanned.text, /Thời gian tập trung: 25 phút/u);
    assert.match(scanned.text, /English line: Read, notice, and record three ideas\./u);
    assert.deepEqual(ocrPages, [1]);

    ocrPages.length = 0;
    const mixed = await extractFixture('mixed-text-and-image-pages.pdf');
    assert.equal(mixed.truncated, false);
    assert.match(mixed.text, /This page contains selectable text: focus session 25 minutes\./u);
    assert.match(mixed.text, /Ga Khởi đầu.*Đồng cỏ Gió/u);
    assert.deepEqual(ocrPages, [2], 'only the scanned page should be sent through OCR');
  } finally {
    await ocrWorker?.terminate();
    globalThis.DOMMatrix = previousGlobals.DOMMatrix;
    globalThis.ImageData = previousGlobals.ImageData;
    globalThis.Path2D = previousGlobals.Path2D;
    globalThis.OffscreenCanvas = previousGlobals.OffscreenCanvas;
  }
});
