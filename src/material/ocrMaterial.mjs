export const MAX_DECODED_IMAGE_PIXELS = 20_000_000;
export const MAX_PDF_PAGES = 20;
export const MAX_OCR_PAGES_PER_FILE = 20;
export const MAX_OCR_TIME_MS = 120_000;
export const MIN_USEFUL_PDF_TEXT_CHARS = 50;

const PDF_PAGE_RENDER_TIMEOUT_MS = 10_000;
const PDF_LOAD_TIMEOUT_MS = 15_000;
const PDF_PAGE_READ_TIMEOUT_MS = 15_000;
const PDF_READ_BUDGET_MS = 120_000;

export class OcrTimeoutError extends Error {
  constructor(message = 'Local OCR exceeded its time limit.') {
    super(message);
    this.name = 'OcrTimeoutError';
  }
}

class PdfLoadTimeoutError extends Error {
  constructor() {
    super('PDF document loading exceeded its time limit.');
    this.name = 'PdfLoadTimeoutError';
  }
}

class PdfReadTimeoutError extends Error {
  constructor() {
    super('PDF page text extraction exceeded its time limit.');
    this.name = 'PdfReadTimeoutError';
  }
}

function abortError() {
  return new DOMException('Material extraction was cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function awaitBounded(value, timeoutMs, timeoutError, onStop, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(result);
    };
    const onAbort = () => {
      try { Promise.resolve(onStop?.()).catch(() => {}); } catch { /* parser is already stopped */ }
      finish(reject, abortError());
    };
    const timer = setTimeout(() => {
      try { Promise.resolve(onStop?.()).catch(() => {}); } catch { /* parser is already stopped */ }
      finish(reject, timeoutError());
    }, Math.max(1, timeoutMs));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(value).then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error),
    );
  });
}

function notify(onProgress, event) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress({ ...event, progress: Math.min(1, Math.max(0, Number(event.progress) || 0)) });
  } catch {
    // Progress reporting is advisory and must not interrupt extraction.
  }
}

function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function dimensions(width, height, mime) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    const error = new TypeError('Unsupported or malformed image dimensions.');
    error.code = 'INVALID_IMAGE';
    throw error;
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_DECODED_IMAGE_PIXELS) {
    const error = new RangeError(`Image contains more than ${MAX_DECODED_IMAGE_PIXELS} pixels.`);
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  return { width, height, pixels, mime };
}

function isBytes(bytes, offset, text) {
  if (offset + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (startOfFrame.has(marker)) {
      if (length < 7) break;
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return dimensions(width, height, 'image/jpeg');
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || !isBytes(bytes, 0, 'RIFF') || !isBytes(bytes, 8, 'WEBP')) return null;
  const view = dataView(bytes);
  let offset = 12;
  const end = Math.min(bytes.length, view.getUint32(4, true) + 8);
  while (offset + 8 <= end) {
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + size > end) return null;
    if (isBytes(bytes, offset, 'VP8X') && size >= 10) {
      const width = 1 + bytes[dataOffset + 4] + (bytes[dataOffset + 5] << 8) + (bytes[dataOffset + 6] << 16);
      const height = 1 + bytes[dataOffset + 7] + (bytes[dataOffset + 8] << 8) + (bytes[dataOffset + 9] << 16);
      return dimensions(width, height, 'image/webp');
    }
    if (isBytes(bytes, offset, 'VP8 ') && size >= 10 && bytes[dataOffset + 3] === 0x9d &&
        bytes[dataOffset + 4] === 0x01 && bytes[dataOffset + 5] === 0x2a) {
      const width = (bytes[dataOffset + 6] | (bytes[dataOffset + 7] << 8)) & 0x3fff;
      const height = (bytes[dataOffset + 8] | (bytes[dataOffset + 9] << 8)) & 0x3fff;
      return dimensions(width, height, 'image/webp');
    }
    if (isBytes(bytes, offset, 'VP8L') && size >= 5 && bytes[dataOffset] === 0x2f) {
      const b1 = bytes[dataOffset + 1];
      const b2 = bytes[dataOffset + 2];
      const b3 = bytes[dataOffset + 3];
      const b4 = bytes[dataOffset + 4];
      const width = 1 + b1 + ((b2 & 0x3f) << 8);
      const height = 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10);
      return dimensions(width, height, 'image/webp');
    }
    offset = dataOffset + size + (size % 2);
  }
  return null;
}

function bmpDimensions(bytes) {
  if (bytes.length < 26 || !isBytes(bytes, 0, 'BM')) return null;
  const view = dataView(bytes);
  const headerSize = view.getUint32(14, true);
  if (headerSize === 12) {
    return dimensions(view.getUint16(18, true), view.getUint16(20, true), 'image/bmp');
  }
  if (headerSize >= 40 && bytes.length >= 30) {
    const width = view.getInt32(18, true);
    const height = Math.abs(view.getInt32(22, true));
    return dimensions(width, height, 'image/bmp');
  }
  return null;
}

export function inspectImageDimensions(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 24 && bytes[0] === 0x89 && isBytes(bytes, 1, 'PNG\r\n\x1a\n') && isBytes(bytes, 12, 'IHDR')) {
    const view = dataView(bytes);
    return dimensions(view.getUint32(16, false), view.getUint32(20, false), 'image/png');
  }
  const jpeg = jpegDimensions(bytes);
  if (jpeg) return jpeg;
  const webp = webpDimensions(bytes);
  if (webp) return webp;
  const bmp = bmpDimensions(bytes);
  if (bmp) return bmp;
  const error = new TypeError('Unsupported or malformed image.');
  error.code = 'INVALID_IMAGE';
  throw error;
}

function defaultWorkerFactory() {
  if (typeof Worker !== 'function') throw new Error('Local OCR workers are unavailable in this environment.');
  return new Worker(new URL('./ocrWorker.mjs', import.meta.url), {
    type: 'module',
    name: 'viendu-material-ocr',
  });
}

export function createOcrClient({
  signal,
  onProgress,
  workerFactory = defaultWorkerFactory,
  timeoutMs = MAX_OCR_TIME_MS,
} = {}) {
  throwIfAborted(signal);
  const worker = workerFactory();
  let nextRequestId = 0;
  let stopped = false;
  let stoppedError = null;
  const pending = new Map();

  const removeListener = (type, listener) => worker.removeEventListener?.(type, listener);
  const stop = (error) => {
    if (stopped) return;
    stopped = true;
    stoppedError = error || null;
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    removeListener('message', onMessage);
    removeListener('error', onError);
    worker.terminate();
    for (const request of pending.values()) request.reject(error || new Error('OCR worker stopped.'));
    pending.clear();
  };

  const onMessage = (event) => {
    const message = event?.data || {};
    if (message.type === 'progress') {
      notify(onProgress, {
        phase: message.phase === 'recognizing' ? 'recognizing' : 'loading',
        progress: message.progress,
        ...(Number.isInteger(message.page) ? { page: message.page } : {}),
        ...(Number.isInteger(message.totalPages) ? { totalPages: message.totalPages } : {}),
      });
      return;
    }
    if (!Number.isInteger(message.id) || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.type === 'result') {
      const confidence = message.confidence;
      request.resolve({
        text: String(message.text || ''),
        ...(typeof confidence === 'number' && Number.isFinite(confidence)
          ? { confidence: Math.max(0, Math.min(100, confidence)) }
          : {}),
      });
    } else request.reject(new Error(String(message.message || 'Local OCR could not read this page.')));
  };

  const onError = (event) => {
    const error = new Error(String(event?.message || 'Local OCR worker failed.'));
    stop(error);
  };
  const onAbort = () => stop(abortError());
  const timeout = setTimeout(() => stop(new OcrTimeoutError()), Math.max(1, timeoutMs));

  worker.addEventListener?.('message', onMessage);
  worker.addEventListener?.('error', onError);
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    recognize(image, { page, totalPages } = {}) {
      if (stopped) return Promise.reject(stoppedError || new Error('OCR worker has stopped.'));
      try {
        throwIfAborted(signal);
      } catch (error) {
        stop(error);
        return Promise.reject(error);
      }
      const id = ++nextRequestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ type: 'recognize', id, image, page, totalPages });
        } catch (error) {
          pending.delete(id);
          reject(error);
          stop(error);
        }
      });
    },
    terminate() {
      stop(null);
    },
  };
}

function safeText(value) {
  // OCR line breaks are meaningful for paired vocabulary and must survive extraction.
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u0000/g, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t ]+/gu, ' ')
    .replace(/[ ]*\n[ ]*/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

function recognitionFrom(value) {
  const text = safeText(typeof value === 'string' ? value : value?.text);
  const rawConfidence = typeof value === 'object' && value !== null ? value.confidence : undefined;
  const confidence = typeof rawConfidence === 'number' && Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(100, rawConfidence))
    : undefined;
  return { text, confidence };
}

function pageTextFromItems(items) {
  const lines = [];
  let line = '';
  let previousY;
  const finishLine = () => {
    const normalized = line.trim();
    if (normalized) lines.push(normalized);
    line = '';
  };

  for (const item of items || []) {
    const text = safeText(item?.str).replace(/\n/gu, ' ').trim();
    if (!text) continue;
    const y = Number(item?.transform?.[5]);
    if (line && Number.isFinite(y) && Number.isFinite(previousY) && Math.abs(y - previousY) > 1) {
      finishLine();
    }
    if (line && !line.endsWith(' ')) line += ' ';
    line += text;
    if (item?.hasEOL) finishLine();
    if (Number.isFinite(y)) previousY = y;
  }
  finishLine();
  return lines.join('\n');
}

function makePdfPageText(pageNumber, text) {
  return text ? `[Trang ${pageNumber}]\n${text}` : '';
}

function appendBounded(current, value, limit) {
  if (!value) return { text: current, truncated: false };
  const separator = current ? '\n\n' : '';
  const available = Math.max(0, limit - current.length - separator.length);
  if (value.length <= available) return { text: current + separator + value, truncated: false };
  let clipped = value.slice(0, available);
  if (clipped.length && /[\uD800-\uDBFF]/u.test(clipped.at(-1))) clipped = clipped.slice(0, -1);
  return { text: current + separator + clipped, truncated: true };
}

function messageForLimit(reason) {
  if (reason === 'ocr-page-limit') return `Đã đọc được một phần tệp; OCR đã dừng sau ${MAX_OCR_PAGES_PER_FILE} trang để giữ thời gian xử lý an toàn.`;
  if (reason === 'ocr-time-limit') return 'Đã đọc được một phần tệp; OCR đã dừng khi hết giới hạn thời gian xử lý.';
  if (reason === 'pdf-page-limit') return `Đã đọc được ${MAX_PDF_PAGES} trang đầu; các trang sau chưa được trích xuất.`;
  if (reason === 'pdf-render-timeout') return 'Đã đọc được một phần tệp; một trang PDF mất quá nhiều thời gian để dựng ảnh nên OCR đã dừng.';
  if (reason === 'pdf-load-timeout') return 'PDF mất quá nhiều thời gian để mở nên chưa thể trích xuất nội dung.';
  if (reason === 'pdf-read-timeout') return 'Đã giữ nội dung các trang đã đọc; phần còn lại mất quá nhiều thời gian để trích xuất.';
  if (reason === 'ocr-unavailable') return 'Không thể khởi chạy OCR cục bộ; văn bản chọn được trong PDF vẫn đã được giữ lại.';
  if (reason === 'text-limit') return 'Đã trích xuất một phần nội dung theo giới hạn dung lượng bài quiz.';
  return 'Đã đọc được một phần tệp; OCR chưa xử lý được tất cả các trang cần đọc.';
}

export async function extractPdfPagesWithOcr(pdf, {
  signal,
  onProgress,
  maxTextChars = 50_000,
  renderPage,
  readBudgetMs = PDF_READ_BUDGET_MS,
  pageReadTimeoutMs = PDF_PAGE_READ_TIMEOUT_MS,
  destroyParser,
  createOcrClient: createClient = () => createOcrClient({ signal, onProgress }),
} = {}) {
  throwIfAborted(signal);
  const requested = Math.max(0, Math.floor(Number(maxTextChars) || 0));
  if (requested === 0) {
    return { text: '', truncated: true, reason: 'text-limit', message: messageForLimit('text-limit') };
  }
  const totalPages = Math.max(0, Math.floor(Number(pdf?.numPages) || 0));
  const pagesToInspect = Math.min(totalPages, MAX_PDF_PAGES);
  let output = '';
  let truncated = totalPages > pagesToInspect;
  let reason = truncated ? 'pdf-page-limit' : '';
  let ocrClient = null;
  let ocrStopped = false;
  let ocrPages = 0;
  let hasEmbeddedText = false;
  let hasOcrText = false;
  const confidences = [];
  const deadline = Date.now() + Math.max(1, readBudgetMs);

  const readTimeout = () => Math.max(1, Math.min(pageReadTimeoutMs, deadline - Date.now()));
  const destroyPdf = destroyParser || (() => pdf.destroy?.());

  const addText = (pageNumber, pageText) => {
    if (!pageText) return true;
    const appended = appendBounded(output, makePdfPageText(pageNumber, pageText), requested);
    output = appended.text;
    if (appended.truncated) {
      truncated = true;
      reason = 'text-limit';
      return false;
    }
    return true;
  };

  try {
    for (let pageNumber = 1; pageNumber <= pagesToInspect; pageNumber += 1) {
      throwIfAborted(signal);
      let page;
      try {
        page = await awaitBounded(
          pdf.getPage(pageNumber),
          readTimeout(),
          () => new PdfReadTimeoutError(),
          destroyPdf,
          signal,
        );
      } catch (error) {
        if (error?.name === 'PdfReadTimeoutError') {
          truncated = true;
          reason = 'pdf-read-timeout';
          break;
        }
        throw error;
      }
      try {
        let content;
        try {
          content = await awaitBounded(
            page.getTextContent({ includeMarkedContent: false }),
            readTimeout(),
            () => new PdfReadTimeoutError(),
            destroyPdf,
            signal,
          );
        } catch (error) {
          if (error?.name === 'PdfReadTimeoutError') {
            truncated = true;
            reason = 'pdf-read-timeout';
            break;
          }
          throw error;
        }
        const selectableText = pageTextFromItems(content?.items);
        if (selectableText) hasEmbeddedText = true;
        let recognizedText = '';
        const shouldOcr = selectableText.length < MIN_USEFUL_PDF_TEXT_CHARS;
        if (shouldOcr && !ocrStopped && ocrPages < MAX_OCR_PAGES_PER_FILE && requested > output.length) {
          try {
            if (!ocrClient) ocrClient = createClient();
            notify(onProgress, { phase: 'rendering', progress: 0, page: pageNumber, totalPages });
            const rendered = await renderPage(page, { page: pageNumber, totalPages, signal });
            throwIfAborted(signal);
            const recognition = recognitionFrom(await ocrClient.recognize(rendered, { page: pageNumber, totalPages }));
            recognizedText = recognition.text;
            if (recognizedText) {
              hasOcrText = true;
              if (Number.isFinite(recognition.confidence)) confidences.push(recognition.confidence);
            }
            ocrPages += 1;
          } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
            ocrStopped = true;
            truncated = true;
            reason = error?.name === 'OcrTimeoutError'
              ? 'ocr-time-limit'
              : error?.name === 'PdfRenderTimeoutError'
                ? 'pdf-render-timeout'
                : 'ocr-unavailable';
            ocrClient?.terminate();
            ocrClient = null;
          }
        } else if (shouldOcr && !ocrStopped && ocrPages >= MAX_OCR_PAGES_PER_FILE) {
          truncated = true;
          reason = 'ocr-page-limit';
        }

        const pageText = [selectableText, recognizedText].filter(Boolean).join('\n');
        if (!addText(pageNumber, pageText)) break;
        notify(onProgress, {
          phase: 'extracting',
          progress: pageNumber / Math.max(1, pagesToInspect),
          page: pageNumber,
          totalPages,
        });
      } finally {
        page.cleanup?.();
      }
      if (output.length >= requested) break;
    }
  } finally {
    ocrClient?.terminate();
  }

  const confidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length)
    : undefined;
  const source = hasEmbeddedText && hasOcrText
    ? 'mixed'
    : hasOcrText
      ? 'local-ocr'
      : hasEmbeddedText
        ? 'embedded-text'
        : undefined;
  return {
    text: output,
    truncated,
    ...(source ? { source } : {}),
    ...(hasOcrText ? { quality: 'needs-review' } : {}),
    ...(Number.isFinite(confidence) ? { confidence } : {}),
    ...(reason ? { reason, message: messageForLimit(reason) } : {}),
  };
}

export async function extractImageWithOcr(bytes, {
  signal,
  onProgress,
  maxTextChars = 50_000,
  createOcrClient: createClient = () => createOcrClient({ signal, onProgress }),
} = {}) {
  throwIfAborted(signal);
  const requested = Math.max(0, Math.floor(Number(maxTextChars) || 0));
  if (requested === 0) {
    return { text: '', truncated: true, reason: 'text-limit', message: messageForLimit('text-limit') };
  }
  const info = inspectImageDimensions(bytes);
  notify(onProgress, { phase: 'extracting', progress: 1 });
  let client;
  try {
    client = createClient();
    notify(onProgress, { phase: 'recognizing', progress: 0, page: 1, totalPages: 1 });
    const image = new Blob([bytes], { type: info.mime });
    const recognition = recognitionFrom(await client.recognize(image, { page: 1, totalPages: 1 }));
    const { text } = recognition;
    throwIfAborted(signal);
    return {
      text,
      truncated: false,
      ...(text ? { source: 'local-ocr', quality: 'needs-review' } : {}),
      ...(Number.isFinite(recognition.confidence) ? { confidence: Math.round(recognition.confidence) } : {}),
    };
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
    if (error?.name === 'OcrTimeoutError') {
      return { text: '', truncated: true, reason: 'ocr-time-limit', message: messageForLimit('ocr-time-limit') };
    }
    throw error;
  } finally {
    client?.terminate();
  }
}

function canvasForPage(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('PDF page rendering is unavailable in this environment.');
}

function canvasToBlob(canvas) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PDF page could not be rendered as an image.')), 'image/png');
  });
}

export async function renderPdfPageToBlob(page, { signal, page: pageNumber, totalPages, onProgress } = {}) {
  throwIfAborted(signal);
  const baseViewport = page.getViewport({ scale: 1 });
  const basePixels = baseViewport.width * baseViewport.height;
  if (!Number.isFinite(basePixels) || basePixels <= 0) throw new Error('PDF page has invalid dimensions.');
  const scale = Math.min(2, Math.sqrt(MAX_DECODED_IMAGE_PIXELS / basePixels));
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  if (width * height > MAX_DECODED_IMAGE_PIXELS) throw new RangeError('PDF render exceeds the image pixel limit.');
  const canvas = canvasForPage(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas context is unavailable for PDF rendering.');
  let task;
  let timeout;
  const onAbort = () => task?.cancel?.();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    task = page.render({ canvasContext: context, viewport, background: 'rgb(255, 255, 255)' });
    const timeoutPromise = new Promise((_, reject) => {
      timeout = setTimeout(() => {
        task?.cancel?.();
        const error = new Error('PDF page rendering exceeded its time limit.');
        error.name = 'PdfRenderTimeoutError';
        reject(error);
      }, PDF_PAGE_RENDER_TIMEOUT_MS);
    });
    await Promise.race([task.promise, timeoutPromise]);
    throwIfAborted(signal);
    notify(onProgress, { phase: 'rendering', progress: 1, page: pageNumber, totalPages });
    return await awaitBounded(
      canvasToBlob(canvas),
      PDF_PAGE_RENDER_TIMEOUT_MS,
      () => {
        const error = new Error('PDF page conversion exceeded its time limit.');
        error.name = 'PdfRenderTimeoutError';
        return error;
      },
      () => task?.cancel?.(),
      signal,
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function extractPdfWithOcr(bytes, {
  signal,
  onProgress,
  maxTextChars = 50_000,
  pdfWorkerSrc,
} = {}) {
  let pdfjs;
  try {
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  } catch (cause) {
    const error = new Error('Unable to load the local PDF reader.', { cause });
    error.materialExtractionIssue = 'parser-module';
    throw error;
  }
  throwIfAborted(signal);
  const locationHref = globalThis.location?.href;
  let workerSrc = pdfWorkerSrc;
  if (!workerSrc && locationHref) workerSrc = new URL('/pdf.worker.min.mjs', locationHref).href;
  if (workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    maxImageSize: MAX_DECODED_IMAGE_PIXELS,
    useWorkerFetch: false,
  });
  let loadingStopped = false;
  const stopLoadingTask = () => {
    if (loadingStopped) return;
    loadingStopped = true;
    return loadingTask.destroy();
  };
  try {
    let pdf;
    try {
      pdf = await awaitBounded(
        loadingTask.promise,
        PDF_LOAD_TIMEOUT_MS,
        () => new PdfLoadTimeoutError(),
        stopLoadingTask,
        signal,
      );
    } catch (error) {
      if (error?.name === 'PdfLoadTimeoutError') {
        return { text: '', truncated: true, reason: 'pdf-load-timeout', message: messageForLimit('pdf-load-timeout') };
      }
      throw error;
    }
    notify(onProgress, { phase: 'extracting', progress: 0, totalPages: pdf.numPages });
    return await extractPdfPagesWithOcr(pdf, {
      signal,
      onProgress,
      maxTextChars,
      readBudgetMs: PDF_READ_BUDGET_MS,
      destroyParser: stopLoadingTask,
      renderPage: (page, meta) => renderPdfPageToBlob(page, { ...meta, signal, onProgress }),
    });
  } finally {
    if (!loadingStopped) await stopLoadingTask();
  }
}
