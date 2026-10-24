import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { extractMaterialFile, materialExtractionErrorMessage, MAX_FILE_BYTES, MAX_TEXT_CHARS } from '../src/material/extractMaterialFile.mjs';
import { prepareMaterialWorker } from '../scripts/prepare-material-worker.mjs';

test('distinguishes local OCR worker failures from PDF reader failures', () => {
  assert.equal(materialExtractionErrorMessage(new Error('Local OCR worker failed.')),
    'Không tải được bộ nhận diện chữ OCR trên thiết bị. Hãy tải lại ứng dụng rồi thử lại.');
});

const encoder = new TextEncoder();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const data = typeof contents === 'string' ? encoder.encode(contents) : contents;
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, end]));
}

function docxFixture() {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Word attachment knowledge phrase</w:t></w:r></w:p></w:body></w:document>',
  });
}

function pptxFixture() {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
    'ppt/presentation.xml': '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
    'ppt/slides/slide1.xml': '<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>Slide attachment knowledge phrase</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  });
}

function xlsxFixture() {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Workbook attachment knowledge phrase</t></is></c></row></sheetData></worksheet>',
  });
}

function pdfFixture(text) {
  const body = `BT /F1 18 Tf 72 720 Td (${text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')}) Tj ET`;
  const content = `<< /Length ${Buffer.byteLength(body, 'ascii')} >>\nstream\n${body}\nendstream`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    content,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return encoder.encode(pdf);
}

function file(name, bytes, type = '') {
  return new File([bytes], name, { type });
}

function extractInBrowserLikeWorker(name, bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./materialExtractionBrowserWorker.mjs', import.meta.url), {
      type: 'module',
      workerData: { name, bytes },
    });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Browser-like extraction worker exited with code ${code}.`));
    });
  });
}

test('extracts supported office formats, PDF, and safe text locally', async () => {
  const cases = [
    [file('lesson.docx', docxFixture()), 'Word attachment knowledge phrase'],
    [file('lesson.pptx', pptxFixture()), 'Slide attachment knowledge phrase'],
    [file('lesson.xlsx', xlsxFixture()), 'Workbook attachment knowledge phrase'],
    [file('lesson.csv', encoder.encode('unit,summary\nscience,CSV knowledge phrase'), 'text/csv'), 'CSV knowledge phrase'],
    [file('lesson.txt', encoder.encode('Plain-text knowledge phrase')), 'Plain-text knowledge phrase'],
    [file('lesson.json', encoder.encode('{"topic":"JSON knowledge phrase"}'), 'application/json'), 'JSON knowledge phrase'],
    [file('lesson.html', encoder.encode('<html><body><h1>HTML knowledge phrase</h1><script>doNotSend()</script></body></html>'), 'text/html'), 'HTML knowledge phrase'],
  ];

  for (const [input, expected] of cases) {
    const result = await extractMaterialFile(input);
    assert.equal(result.status, 'extracted', `${input.name}: ${result.message}`);
    assert.ok(result.text.includes(expected), `${input.name} should contain extracted text`);
    assert.ok(!result.text.includes('doNotSend'), 'script contents must not enter quiz material');
  }
});

test('parses DOCX through the browser OfficeParser bundle without Node Buffer or setImmediate globals', async () => {
  const result = await extractInBrowserLikeWorker('lesson.docx', docxFixture());
  assert.equal(result.status, 'extracted', result.message);
  assert.match(result.text, /Word attachment knowledge phrase/);
});

test('returns OCR provenance, confidence, and an explicit review requirement', async () => {
  const previousWorker = globalThis.Worker;
  const fixture = await readFile(new URL('./fixtures/high-contrast-vietnamese-english.png', import.meta.url));
  globalThis.Worker = class TestOcrWorker {
    listeners = new Map();
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type) { this.listeners.delete(type); }
    postMessage(request) {
      queueMicrotask(() => this.listeners.get('message')?.({ data: {
        type: 'result', id: request.id, text: 'term\nnghĩa tiếng Việt', confidence: 31,
      } }));
    }
    terminate() {}
  };

  try {
    const result = await extractMaterialFile(file('notes.png', fixture, 'image/png'));
    assert.equal(result.status, 'extracted');
    assert.equal(result.text, 'term\nnghĩa tiếng Việt');
    assert.equal(result.source, 'local-ocr');
    assert.equal(result.quality, 'needs-review');
    assert.equal(result.confidence, 31);
  } finally {
    if (previousWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = previousWorker;
  }
});

test('extracts PDF text with the local PDF.js worker', async (t) => {
  let canvas;
  try {
    canvas = await import('@napi-rs/canvas');
  } catch {
    t.skip('pdfjs-dist optional canvas polyfill is unavailable in this environment');
    return;
  }

  const previousGlobals = Object.fromEntries(['DOMMatrix', 'ImageData', 'Path2D'].map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, { DOMMatrix: canvas.DOMMatrix, ImageData: canvas.ImageData, Path2D: canvas.Path2D });
  try {
    const worker = path.resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs');
    const result = await extractMaterialFile(
      file('lesson.pdf', pdfFixture('PDF attachment knowledge phrase with enough searchable text for this test')),
      { pdfWorkerSrc: pathToFileURL(worker).href },
    );
    assert.equal(result.status, 'extracted', result.message);
    assert.match(result.text, /PDF attachment knowledge phrase with enough searchable text/);

    const scan = await extractMaterialFile(file('scanned.pdf', pdfFixture('')),
      { pdfWorkerSrc: pathToFileURL(worker).href });
    assert.equal(scan.status, 'truncated');
    assert.match(scan.message, /không thể khởi chạy OCR cục bộ/iu);

    const invalidPdf = await extractMaterialFile(file('broken.pdf', encoder.encode('not a PDF')),
      { pdfWorkerSrc: pathToFileURL(worker).href });
    assert.equal(invalidPdf.status, 'error');
    assert.match(invalidPdf.message, /tệp bị hỏng/iu);
  } finally {
    for (const key of ['DOMMatrix', 'ImageData', 'Path2D']) {
      if (previousGlobals[key] === undefined) delete globalThis[key];
      else globalThis[key] = previousGlobals[key];
    }
  }
});

test('extracts legacy XLS files with bounded sheet output', async () => {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['Topic', 'Fact'], ['History', 'Legacy XLS knowledge phrase']]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Lesson');
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xls' });
  const result = await extractMaterialFile(file('lesson.xls', bytes));
  assert.equal(result.status, 'extracted', result.message);
  assert.match(result.text, /Legacy XLS knowledge phrase/);
});

test('preserves metadata and returns a clear status for unsupported, oversized, or empty input', async () => {
  assert.equal(MAX_FILE_BYTES, 32 * 1024 * 1024);
  const unsupported = await extractMaterialFile(file('scan.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38])));
  assert.equal(unsupported.status, 'metadata-only');
  assert.equal(unsupported.name, 'scan.gif');
  assert.equal(unsupported.text, '');
  assert.match(unsupported.message, /chưa trích xuất được nội dung/iu);

  const legacy = await extractMaterialFile(file('archive.doc', encoder.encode('not parsed')));
  assert.equal(legacy.status, 'metadata-only');
  assert.equal(legacy.text, '');
  assert.match(legacy.message, /Office cũ/iu);

  const tooLarge = await extractMaterialFile({ name: 'large.txt', size: MAX_FILE_BYTES + 1, type: 'text/plain', arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(tooLarge.status, 'too-large');
  assert.equal(tooLarge.text, '');
  assert.match(tooLarge.message, /32 MB/iu);

  let acceptedLargePdfRead = false;
  const largerScan = await extractMaterialFile({
    name: 'Vocabulary.pdf',
    size: 21_278_187,
    type: 'application/pdf',
    async arrayBuffer() { acceptedLargePdfRead = true; return new ArrayBuffer(0); },
  });
  assert.equal(acceptedLargePdfRead, true, 'a 21.3 MB scan should pass the file-size gate');
  assert.equal(largerScan.status, 'empty');
  assert.match(largerScan.message, /không tìm thấy văn bản/iu);

  const empty = await extractMaterialFile(file('blank.txt', new Uint8Array()));
  assert.equal(empty.status, 'empty');
  assert.equal(empty.text, '');
  assert.match(empty.message, /không có văn bản có thể đọc/iu);
  assert.doesNotMatch(empty.message, /PDF|OCR/iu);
});

test('distinguishes encrypted documents, corrupt files, and a missing browser parser', () => {
  const encrypted = materialExtractionErrorMessage({ officeIssue: { code: 'PASSWORD_REQUIRED' } });
  assert.match(encrypted, /mật khẩu|mã hóa/iu);

  const corrupt = materialExtractionErrorMessage({ officeIssue: { code: 'ZIP_NO_ENTRIES_FOUND' } });
  assert.match(corrupt, /hỏng|định dạng/iu);
  assert.doesNotMatch(corrupt, /mật khẩu|mã hóa/iu);

  const parserUnavailable = materialExtractionErrorMessage({ materialExtractionIssue: 'parser-module' });
  assert.match(parserUnavailable, /không tải được.*đọc tài liệu/iu);
  assert.doesNotMatch(parserUnavailable, /hỏng|mật khẩu/iu);

  const workerUnavailable = materialExtractionErrorMessage(new TypeError(
    'Setting up fake worker failed: "Failed to fetch dynamically imported module: /pdf.worker.min.mjs"',
  ));
  assert.match(workerUnavailable, /bộ đọc PDF/iu);
});

test('strictly rejects invalid text bytes and malformed supported documents', async () => {
  const invalidText = await extractMaterialFile(file('broken.txt', new Uint8Array([0xc3, 0x28])));
  assert.equal(invalidText.status, 'error');
  assert.equal(invalidText.text, '');

  const malformed = await extractMaterialFile(file('broken.docx', encoder.encode('not a zip')));
  assert.equal(malformed.status, 'error');
  assert.equal(malformed.text, '');
  assert.match(malformed.message, /tệp bị hỏng.*định dạng/iu);
});

test('caps extracted text at the requested remaining quiz budget', async () => {
  const noRemainingBudget = await extractMaterialFile(file('lesson.txt', encoder.encode('still has source text')), { maxTextChars: 0 });
  assert.equal(noRemainingBudget.status, 'truncated');
  assert.equal(noRemainingBudget.text, '');

  const result = await extractMaterialFile(file('lesson.txt', encoder.encode('0123456789')), { maxTextChars: 5 });
  assert.equal(result.status, 'truncated');
  assert.equal(result.text, '01234');
  assert.equal(result.text.length, 5);

  const cappedAtProductLimit = await extractMaterialFile(file('lesson.txt', encoder.encode('x'.repeat(MAX_TEXT_CHARS + 5))), { maxTextChars: MAX_TEXT_CHARS + 5 });
  assert.equal(cappedAtProductLimit.status, 'truncated');
  assert.equal(cappedAtProductLimit.text.length, MAX_TEXT_CHARS);

  let imageRead = false;
  const noBudgetImage = await extractMaterialFile({
    name: 'scan.png',
    size: 1_000,
    type: 'image/png',
    async arrayBuffer() { imageRead = true; return new ArrayBuffer(0); },
  }, { maxTextChars: 0 });
  assert.equal(noBudgetImage.status, 'truncated');
  assert.equal(imageRead, false, 'zero remaining quiz budget must skip OCR image decoding');
});

test('prepares the matching PDF.js worker as a local same-origin public asset', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'viendu-material-worker-'));
  try {
    const officeParserDirectory = path.join(projectRoot, 'node_modules/officeparser');
    const pdfJsDirectory = path.join(projectRoot, 'node_modules/pdfjs-dist/legacy/build');
    const tesseractDirectory = path.join(projectRoot, 'node_modules/tesseract.js/dist');
    const coreDirectory = path.join(projectRoot, 'node_modules/tesseract.js-core');
    await mkdir(officeParserDirectory, { recursive: true });
    await mkdir(pdfJsDirectory, { recursive: true });
    await mkdir(tesseractDirectory, { recursive: true });
    await mkdir(coreDirectory, { recursive: true });
    await writeFile(path.join(officeParserDirectory, 'package.json'), JSON.stringify({ dependencies: { 'pdfjs-dist': '6.2.108' } }));
    await writeFile(path.join(projectRoot, 'node_modules/pdfjs-dist/package.json'), JSON.stringify({ version: '6.2.108' }));
    await writeFile(path.join(projectRoot, 'node_modules/tesseract.js/package.json'), JSON.stringify({ version: '7.0.0' }));
    await writeFile(path.join(projectRoot, 'node_modules/tesseract.js-core/package.json'), JSON.stringify({ version: '7.0.0' }));
    const source = path.join(pdfJsDirectory, 'pdf.worker.min.mjs');
    await writeFile(source, 'test worker source');
    await writeFile(path.join(tesseractDirectory, 'worker.min.js'), 'test OCR worker source');
    const requiredCoreFiles = [
      'tesseract-core-relaxedsimd-lstm.wasm.js',
      'tesseract-core-relaxedsimd-lstm.wasm',
      'tesseract-core-simd-lstm.wasm.js',
      'tesseract-core-simd-lstm.wasm',
      'tesseract-core-lstm.wasm.js',
      'tesseract-core-lstm.wasm',
    ];
    for (const name of requiredCoreFiles) await writeFile(path.join(coreDirectory, name), `test ${name}`);
    for (const language of ['eng', 'vie']) {
      const languageRoot = path.join(projectRoot, 'node_modules/@tesseract.js-data', language);
      const bestDataRoot = path.join(languageRoot, '4.0.0_best_int');
      await mkdir(bestDataRoot, { recursive: true });
      await writeFile(path.join(languageRoot, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      await writeFile(path.join(bestDataRoot, `${language}.traineddata.gz`), `${language} local data`);
    }

    const prepared = await prepareMaterialWorker(projectRoot);
    assert.equal(prepared.version, '6.2.108');
    assert.deepEqual(await readFile(prepared.workerDestination), await readFile(source));
    assert.deepEqual(await readFile(path.join(projectRoot, 'public/ocr/worker.min.js')), Buffer.from('test OCR worker source'));
    assert.deepEqual(await readFile(path.join(projectRoot, 'public/ocr/core/tesseract-core-simd-lstm.wasm.js')), Buffer.from('test tesseract-core-simd-lstm.wasm.js'));
    assert.deepEqual(await readFile(path.join(projectRoot, 'public/ocr/lang/vie.traineddata.gz')), Buffer.from('vie local data'));
    assert.equal(prepared.ocrAssets.length, 1 + requiredCoreFiles.length + 2);

    await writeFile(path.join(projectRoot, 'node_modules/pdfjs-dist/package.json'), JSON.stringify({ version: '9.9.9' }));
    await assert.rejects(prepareMaterialWorker(projectRoot), /PDF worker mismatch/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
