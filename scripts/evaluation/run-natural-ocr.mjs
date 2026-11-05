#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import { MAX_OCR_TIME_MS, OcrTimeoutError, extractImageWithOcr } from '../../src/material/ocrMaterial.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DATASET_REVISION = '36f3060fd7628937c77c1b1e2a95892f24f562e0';
const EXPECTED_LICENSE = 'Public Domain (Luật SHTT VN, Điều 15)';
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'docs/research/vn-ocr-documents-real-36f3060.sha256');
const LANGUAGE_MODEL = '4.0.0_best_int';

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') { result.help = true; continue; }
    if (!['--dataset-dir', '--manifest', '--output'].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[argument.slice(2)] = path.resolve(value);
    index += 1;
  }
  return result;
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function readManifest(manifestPath, dataDir) {
  const source = await readFile(manifestPath, 'utf8');
  const entries = source.split(/\r?\n/u).filter(Boolean).map(line => {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/u);
    if (!match) throw new Error('Checksum manifest has a malformed line.');
    const relativePath = match[2].trim();
    const absolutePath = path.resolve(dataDir, relativePath);
    if (!within(dataDir, absolutePath)) throw new Error('Checksum manifest contains a path outside the dataset directory.');
    return { expected: match[1], relativePath, absolutePath };
  });
  if (entries.length !== 10 || entries.filter(row => /^real\/real_[a-z0-9_]+_p1\.png$/u.test(row.relativePath)).length !== 9 ||
      entries.filter(row => row.relativePath === 'real/metadata.jsonl').length !== 1)
    throw new Error('Expected nine real page images and one metadata file in the checksum manifest.');
  if (new Set(entries.map(row => row.relativePath)).size !== entries.length)
    throw new Error('Checksum manifest contains duplicate paths.');
  return entries;
}

async function hydratePointer(entry) {
  const contents = await readFile(entry.absolutePath).catch(() => Buffer.alloc(0));
  if (!contents.subarray(0, 128).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) return;
  const url = `https://huggingface.co/datasets/nrl-ai/vn-ocr-documents-eval/resolve/${DATASET_REVISION}/${entry.relativePath}?download=true`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not hydrate pinned corpus asset ${entry.relativePath}: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error(`Pinned page image exceeded 5 MB: ${entry.relativePath}.`);
  await writeFile(entry.absolutePath, bytes);
}

async function verifyDataset(dataDir, manifestPath) {
  let revision;
  try { revision = execFileSync('git', ['-C', dataDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { throw new Error('Dataset directory must be a Git checkout at the pinned revision.'); }
  if (revision !== DATASET_REVISION) throw new Error(`Dataset revision mismatch: expected ${DATASET_REVISION}, received ${revision}.`);
  const entries = await readManifest(manifestPath, dataDir);
  for (const entry of entries) {
    if (entry.relativePath.endsWith('.png')) await hydratePointer(entry);
    const actual = createHash('sha256').update(await readFile(entry.absolutePath)).digest('hex');
    if (actual !== entry.expected) throw new Error(`Checksum mismatch for ${entry.relativePath}.`);
  }
  return { revision, checkedFiles: entries.length };
}

function normalizeText(value) {
  return String(value).normalize('NFC').replace(/\r\n?/gu, '\n').replace(/\s+/gu, ' ').trim();
}

function editDistance(left, right) {
  const a = Array.isArray(left) ? left : [...left];
  const b = Array.isArray(right) ? right : [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1)
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

function summarize(rows) {
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  const sorted = rows.map(row => row.elapsedMs).sort((a, b) => a - b);
  const median = sorted.length % 2
    ? sorted[Math.floor(sorted.length / 2)]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const macro = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
  return {
    cases: rows.length,
    failures: rows.filter(row => row.failure !== null).length,
    timeouts: rows.filter(row => row.timeout).length,
    microCer: total('characterErrors') / total('referenceCharacters'),
    macroCer: macro('cer'),
    microWer: total('tokenErrors') / total('referenceTokens'),
    macroWer: macro('wer'),
    meanElapsedMs: total('elapsedMs') / rows.length,
    medianElapsedMs: median,
    p95ElapsedMs: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    meanConfidence: rows.filter(row => row.confidence !== null).reduce((sum, row) => sum + (row.confidence ?? 0), 0) /
      rows.filter(row => row.confidence !== null).length,
  };
}

function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new OcrTimeoutError()), milliseconds); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function createNodeOcrClient(langPath) {
  let workerPromise;
  let shutdownPromise = Promise.resolve();
  let startupMs = null;
  const worker = () => {
    if (!workerPromise) {
      const startedAt = performance.now();
      workerPromise = createWorker(['eng', 'vie'], 1, { langPath, cacheMethod: 'none', gzip: true }).then(engine => {
        startupMs = performance.now() - startedAt;
        return engine;
      });
    }
    return workerPromise;
  };
  return {
    async recognize(image) {
      const operation = (async () => {
        const engine = await worker();
        const { data } = await engine.recognize(Buffer.from(await image.arrayBuffer()));
        return { text: data.text, confidence: data.confidence };
      })();
      return withTimeout(operation, MAX_OCR_TIME_MS);
    },
    terminate() {
      if (workerPromise) shutdownPromise = workerPromise.then(engine => engine.terminate()).catch(() => undefined);
    },
    async waitForShutdown() { await shutdownPromise; },
    get startupMs() { return startupMs; },
  };
}

async function readCases(dataDir) {
  const lines = (await readFile(path.join(dataDir, 'real/metadata.jsonl'), 'utf8')).split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 9) throw new Error('Pinned real-config metadata must contain exactly nine rows.');
  const rows = lines.map(line => JSON.parse(line));
  if (new Set(rows.map(row => row.doc_id)).size !== rows.length) throw new Error('Dataset contains duplicate document IDs.');
  for (const row of rows) {
    const source = new URL(row.source_url);
    if (row.category !== 'government_real' || row.license !== EXPECTED_LICENSE ||
        !['datafiles.chinhphu.vn', 'datafiles.hanoi.gov.vn'].includes(source.hostname) ||
        !/^real_[a-z0-9_]+_p1\.png$/u.test(row.file_name))
      throw new Error(`The pinned real-config row ${row.doc_id} did not meet the documented provenance filter.`);
  }
  return rows;
}

async function evaluateCase(testCase, dataDir, langPath) {
  const bytes = new Uint8Array(await readFile(path.join(dataDir, 'real', testCase.file_name)));
  const reference = normalizeText(testCase.text);
  const client = await createNodeOcrClient(langPath);
  const startedAt = performance.now();
  let result;
  let failure = null;
  try { result = await extractImageWithOcr(bytes, { createOcrClient: () => client }); }
  catch (error) { failure = error?.name || 'Error'; result = { text: '' }; }
  const elapsedMs = performance.now() - startedAt;
  client.terminate();
  await client.waitForShutdown();
  const hypothesis = normalizeText(result?.text ?? '');
  const referenceCharacters = [...reference];
  const hypothesisCharacters = [...hypothesis];
  const referenceTokens = reference ? reference.split(/\s+/u) : [];
  const hypothesisTokens = hypothesis ? hypothesis.split(/\s+/u) : [];
  const characterErrors = editDistance(referenceCharacters, hypothesisCharacters);
  const tokenErrors = editDistance(referenceTokens, hypothesisTokens);
  const timeout = result?.reason === 'ocr-time-limit' || failure === 'OcrTimeoutError';
  if (!failure && result?.reason && !timeout) failure = result.reason;
  if (!failure && !hypothesis) failure = 'empty-output';
  return {
    docId: testCase.doc_id,
    referenceCharacters: referenceCharacters.length,
    outputCharacters: hypothesisCharacters.length,
    characterErrors,
    cer: referenceCharacters.length ? characterErrors / referenceCharacters.length : 0,
    referenceTokens: referenceTokens.length,
    outputTokens: hypothesisTokens.length,
    tokenErrors,
    wer: referenceTokens.length ? tokenErrors / referenceTokens.length : 0,
    confidence: Number.isFinite(result?.confidence) ? result.confidence : null,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    engineStartupMs: Number.isFinite(client.startupMs) ? Number(client.startupMs.toFixed(2)) : null,
    timeout,
    failure,
    quality: result?.quality ?? null,
  };
}

async function packageVersion(packageName) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')).version;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/evaluation/run-natural-ocr.mjs --dataset-dir DIR [--manifest FILE] [--output FILE]');
    return;
  }
  if (!args['dataset-dir']) throw new Error('A pinned dataset Git checkout is required with --dataset-dir.');
  const dataDir = args['dataset-dir'];
  const verified = await verifyDataset(dataDir, args.manifest ?? DEFAULT_MANIFEST);
  const cases = await readCases(dataDir);
  const langPath = path.join(REPO_ROOT, 'public/ocr/lang');
  const rows = [];
  for (const testCase of cases) rows.push(await evaluateCase(testCase, dataDir, langPath));
  const output = {
    benchmark: 'viendu-app-image-ocr-natural-print',
    createdAt: new Date().toISOString(),
    dataset: {
      name: 'nrl-ai/vn-ocr-documents-eval', revision: verified.revision,
      config: 'real', split: 'test', checkedFiles: verified.checkedFiles, corpusCases: cases.length,
      rightsBasis: 'Per-item dataset-author Public Domain declarations citing Luật SHTT VN, Điều 15; no independent legal opinion.',
      textGroundTruth: 'Dataset README states human-verified visual transcription; first page only.',
      records: cases.map(testCase => ({
        docId: testCase.doc_id,
        fileName: testCase.file_name,
        category: testCase.category,
        declaredLicense: testCase.license,
        sourceUrl: testCase.source_url,
      })),
    },
    engine: {
      tesseractJs: await packageVersion('tesseract.js'),
      tesseractCore: await packageVersion('tesseract.js-core'),
      englishLanguagePackage: await packageVersion('@tesseract.js-data/eng'),
      vietnameseLanguagePackage: await packageVersion('@tesseract.js-data/vie'),
      trainedDataModel: LANGUAGE_MODEL, languages: ['eng', 'vie'], engineMode: 'LSTM (OEM 1)',
      runtime: 'Tesseract.js Node worker injected into app extractImageWithOcr()',
      node: process.version, platform: `${process.platform}-${process.arch}`, system: os.release(),
      langDataSource: 'generated public/ocr/lang assets; no CDN request',
    },
    metricDefinition: {
      normalization: 'Unicode NFC; normalize CRLF; collapse all whitespace to one space; trim; preserve case, punctuation, and diacritics.',
      cer: 'Unicode code-point Levenshtein distance divided by normalized reference code points; micro and per-document macro.',
      wer: 'Whitespace-token Levenshtein distance divided by normalized reference tokens; Vietnamese units are syllable-like, not segmented words; micro and per-document macro.',
      timing: 'Time from immediately before extractImageWithOcr() through return; includes worker startup and OCR, excludes asynchronous shutdown completion.',
    },
    summary: summarize(rows),
    cases: rows,
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) await writeFile(args.output, json, 'utf8');
  console.log(json.trimEnd());
}

main().catch(error => {
  console.error(`Natural OCR evaluation failed: ${error?.message || error}`);
  process.exitCode = 1;
});
