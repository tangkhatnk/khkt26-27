export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 50_000;

const OFFICE_FORMATS = new Map([
  ['docx', 'docx'],
  ['pptx', 'pptx'],
  ['xlsx', 'xlsx'],
  ['pdf', 'pdf'],
  ['rtf', 'rtf'],
  ['odt', 'odt'],
  ['ods', 'ods'],
  ['odp', 'odp'],
  ['odg', 'odg'],
  ['epub', 'epub'],
  ['html', 'html'],
  ['htm', 'html'],
]);

const PLAIN_TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'md', 'markdown', 'json', 'csv', 'tsv', 'xml', 'tex', 'yaml', 'yml', 'toml',
  'ini', 'log', 'sql', 'js', 'jsx', 'ts', 'tsx', 'css', 'py', 'java', 'c', 'h', 'cpp', 'sh',
  'properties', 'conf', 'rst', 'svg',
]);

const LEGACY_OFFICE_EXTENSIONS = new Set(['doc', 'ppt']);
const PARSE_TIMEOUT_MS = 15_000;

function extensionOf(name) {
  const dot = String(name).lastIndexOf('.');
  return dot > 0 ? String(name).slice(dot + 1).toLowerCase() : '';
}

function formatFromFile(file) {
  const extension = extensionOf(file.name);
  if (OFFICE_FORMATS.has(extension)) return { kind: 'office', format: OFFICE_FORMATS.get(extension) };
  if (extension === 'xls') return { kind: 'xls' };
  if (PLAIN_TEXT_EXTENSIONS.has(extension)) return { kind: 'text', format: extension };
  if (LEGACY_OFFICE_EXTENSIONS.has(extension)) return { kind: 'unsupported-legacy' };

  const mime = String(file.type || '').split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/pdf') return { kind: 'office', format: 'pdf' };
  if (mime === 'application/json' || mime === 'application/ld+json' || mime.endsWith('+json')) return { kind: 'text', format: 'json' };
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return { kind: 'office', format: 'html' };
  if (mime === 'text/csv' || mime === 'text/tab-separated-values') return { kind: 'text', format: 'csv' };
  if (mime.startsWith('text/')) return { kind: 'text', format: 'txt' };
  return { kind: 'unsupported' };
}

function messageFor(status, format = '') {
  if (status === 'extracted') return 'Đã trích xuất nội dung từ tệp.';
  if (status === 'truncated') return 'Đã trích xuất một phần nội dung theo giới hạn dung lượng bài quiz.';
  if (status === 'too-large') return 'Tệp vượt quá giới hạn 20 MB nên chưa được đọc.';
  if (status === 'metadata-only') {
    return format === 'legacy'
      ? 'Đã giữ thông tin tệp; định dạng Office cũ này chưa được trích xuất nội dung.'
      : 'Đã giữ thông tin tệp; ứng dụng chưa trích xuất được nội dung của định dạng này.';
  }
  if (status === 'empty') {
    return format === 'pdf'
      ? 'Không tìm thấy văn bản trong PDF. Tệp có thể là ảnh quét; ứng dụng chưa hỗ trợ OCR.'
      : 'Tệp không có văn bản có thể đọc.';
  }
  return 'Không đọc được nội dung tệp. Tệp có thể bị lỗi hoặc sai định dạng.';
}

function makeResult(file, status, text = '', format = '', message) {
  return {
    name: String(file?.name || 'Tệp không tên'),
    size: Number.isFinite(Number(file?.size)) ? Number(file.size) : 0,
    type: String(file?.type || ''),
    text,
    status,
    message: message ?? messageFor(status, format),
  };
}

export function materialExtractionErrorMessage(error) {
  const code = error?.officeIssue?.code ?? error?.code;
  const detail = [
    error?.message,
    error?.cause?.message,
    error?.details?.originalError?.message,
    error?.officeIssue?.details?.originalError?.message,
  ].filter(Boolean).join(' ');

  if (code === 'PDF_WORKER_MISSING' ||
      /pdf(?:\.js)? worker|worker.{0,40}(?:failed|missing|load)|(?:failed|missing|load).{0,40}worker|workerSrc/i.test(detail)) {
    return 'Không tải được bộ đọc PDF trên thiết bị. Hãy tải lại ứng dụng rồi thử lại.';
  }

  if (error?.materialExtractionIssue === 'parser-module' ||
      error?.name === 'ChunkLoadError' ||
      code === 'ERR_MODULE_NOT_FOUND' ||
      /failed to fetch dynamically imported module|error loading dynamically imported module/i.test(detail)) {
    return 'Không tải được thành phần đọc tài liệu. Hãy tải lại ứng dụng rồi thử lại.';
  }

  if (['PASSWORD_REQUIRED', 'PASSWORD_INCORRECT', 'DOCUMENT_DECRYPTION_FAILED'].includes(code) ||
      /password-protected|password required|password incorrect|encrypted document|could not decrypt/i.test(detail)) {
    return 'Tệp được bảo vệ bằng mật khẩu hoặc mã hóa; hãy gỡ bảo vệ rồi nhập lại.';
  }

  if (['FILE_CORRUPTED', 'IMPROPER_BUFFERS', 'INVALID_INPUT', 'ZIP_NO_ENTRIES_FOUND', 'ZIP_TRUNCATED', 'REQUIRED_PART_MISSING'].includes(code) ||
      /corrupt|malformed|not a zip|invalid (?:pdf|xml|document|file)|pdf.{0,30}(?:corrupt|invalid)|missing its required/i.test(detail)) {
    return 'Tệp bị hỏng, bị cắt hoặc nội dung không khớp với định dạng đã chọn.';
  }

  return messageFor('error');
}

function safeText(value) {
  // Text imported from files must not retain NUL bytes.
  // eslint-disable-next-line no-control-regex
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return text;
}

function limitText(value, requestedLimit) {
  const normalized = safeText(value);
  const limit = Math.min(MAX_TEXT_CHARS, Math.max(0, Math.floor(requestedLimit)));
  if (normalized.length <= limit) return { text: normalized, truncated: false };
  let text = normalized.slice(0, limit);
  if (text.length && /[\uD800-\uDBFF]/u.test(text.at(-1))) text = text.slice(0, -1);
  return { text, truncated: true };
}

function decodeText(bytes) {
  let encoding = 'utf-8';
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  // Reject binary/control bytes while accepting tabs and line breaks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(decoded)) {
    throw new TypeError('Binary data is not safe to use as quiz text.');
  }
  return decoded;
}

function pdfWorkerUrl(override) {
  if (override) return String(override);
  const locationHref = globalThis.location?.href;
  if (locationHref) {
    try {
      return new URL('/pdf.worker.min.mjs', locationHref).href;
    } catch {
      // Keep the same-origin path; the parser will report a readable error if unavailable.
    }
  }
  return '/pdf.worker.min.mjs';
}

async function extractOffice(bytes, format, options) {
  // Keep only OfficeParser's browser entry in the web bundle; this flow never runs OCR.
  let parserModule;
  try {
    parserModule = await import('officeparser/slim');
  } catch (cause) {
    const error = new Error('Unable to load the browser document parser.', { cause });
    error.materialExtractionIssue = 'parser-module';
    throw error;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
  try {
    const parser = parserModule.OfficeParser || parserModule.default;
    const ast = await parser.parseOffice(bytes, {
      fileType: format,
      extractAttachments: false,
      includeFormatting: false,
      includeRawContent: false,
      serializeRawContent: false,
      ...(options.pdfWorkerSrc || (typeof window !== 'undefined' && typeof document !== 'undefined')
        ? { pdfWorkerSrc: pdfWorkerUrl(options.pdfWorkerSrc) }
        : {}),
      abortSignal: controller.signal,
      decompressionLimits: {
        maxUncompressedBytes: 64 * 1024 * 1024,
        maxZipEntries: 2_000,
        maxTableCells: 100_000,
        maxXmlElements: 300_000,
        maxRepeatedContent: 2 * 1024 * 1024,
        maxRawContentLength: 0,
      },
      pdfParserConfig: {
        maxTextItems: 5_000,
        maxOperators: 50_000,
        maxAnnotations: 1_000,
        maxTimeMs: 1_500,
        separateProcess: false,
        extractTextColor: false,
      },
    });
    return (await ast.to('text')).value;
  } finally {
    clearTimeout(timeout);
  }
}

async function extractLegacyXls(bytes, requestedLimit) {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(bytes, {
    type: 'array',
    sheetRows: 2_000,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    dense: false,
  });
  const output = [];
  let remainingCells = 25_000;
  let usedChars = 0;
  let truncated = false;

  for (const sheetName of workbook.SheetNames) {
    if (usedChars >= requestedLimit) {
      truncated = true;
      break;
    }
    output.push(`\n[${sheetName}]`);
    usedChars += sheetName.length + 3;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const lastRow = Math.min(range.e.r, range.s.r + 1_999);
    const lastColumn = Math.min(range.e.c, range.s.c + 255);

    for (let row = range.s.r; row <= lastRow; row += 1) {
      if (remainingCells <= 0 || usedChars >= requestedLimit) {
        truncated = true;
        break;
      }
      const cells = [];
      let hasValue = false;
      for (let column = range.s.c; column <= lastColumn; column += 1) {
        remainingCells -= 1;
        const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
        const value = cell && cell.v != null ? String(cell.w ?? cell.v) : '';
        const boundedValue = value.slice(0, Math.min(1_000, requestedLimit - usedChars));
        cells.push(boundedValue);
        if (boundedValue) hasValue = true;
        usedChars += boundedValue.length + 1;
        if (boundedValue.length < value.length || usedChars >= requestedLimit) {
          truncated = true;
          break;
        }
      }
      if (hasValue) output.push(cells.join('\t'));
      if (truncated) break;
    }
    if (truncated) break;
  }

  return { text: output.join('\n'), truncated };
}

/**
 * Extracts quiz-ready text in the browser without uploading the original file.
 * The file bytes remain local; only the returned text is available to the caller.
 *
 * @param {File} file Browser File returned by the file picker.
 * @param {{ maxTextChars?: number, pdfWorkerSrc?: string }} [options]
 * @returns {Promise<{name: string, size: number, type: string, text: string, status: 'extracted'|'truncated'|'metadata-only'|'too-large'|'empty'|'error', message: string}>}
 */
export async function extractMaterialFile(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    return makeResult(file || {}, 'error');
  }

  const size = Number(file.size);
  if (Number.isFinite(size) && size > MAX_FILE_BYTES) return makeResult(file, 'too-large');
  const detected = formatFromFile(file);
  if (detected.kind === 'unsupported-legacy') return makeResult(file, 'metadata-only', '', 'legacy');
  if (detected.kind === 'unsupported') return makeResult(file, 'metadata-only');
  if (Number.isFinite(size) && size === 0) return makeResult(file, 'empty', '', detected.format);

  const requested = Number.isFinite(Number(options.maxTextChars))
    ? Math.min(MAX_TEXT_CHARS, Math.max(0, Math.floor(Number(options.maxTextChars))))
    : MAX_TEXT_CHARS;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > MAX_FILE_BYTES) return makeResult(file, 'too-large');
    if (bytes.byteLength === 0) return makeResult(file, 'empty', '', detected.format);

    let extracted;
    if (detected.kind === 'text') {
      extracted = { text: decodeText(bytes), truncated: false };
    } else if (detected.kind === 'xls') {
      extracted = await extractLegacyXls(bytes, requested);
    } else {
      extracted = { text: await extractOffice(bytes, detected.format, options), truncated: false };
    }

    const sourceText = safeText(extracted.text);
    const limited = limitText(sourceText, requested);
    if (!sourceText) return makeResult(file, 'empty', '', detected.format);
    return makeResult(file, extracted.truncated || limited.truncated ? 'truncated' : 'extracted', limited.text);
  } catch (error) {
    return makeResult(file, 'error', '', '', materialExtractionErrorMessage(error));
  }
}
