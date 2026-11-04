#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker } from 'tesseract.js';
import {
  MAX_OCR_TIME_MS,
  OcrTimeoutError,
  extractImageWithOcr,
} from '../../src/material/ocrMaterial.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '../..');
const DATASET_REVISION = '7c1c9114c610150b8b36783f089199eee62348b2';
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'docs/research/vn-synthetic-ocr-7c1c9114.sha256');
const LANGUAGE_MODEL = '4.0.0_best_int';

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      result.help = true;
      continue;
    }
    if (!['--dataset-dir', '--manifest', '--output'].includes(argument))
      throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    result[argument.slice(2)] = path.resolve(value);
    index += 1;
  }
  return result;
}

function usage() {
  return [
    'Usage: node scripts/evaluation/run-ocr.mjs --dataset-dir DIR [--manifest FILE] [--output FILE]',
    `Requires the vn-synthetic-ocr checkout at ${DATASET_REVISION}.`,
    'If Git LFS is unavailable, LFS pointer images are hydrated from that immutable Hugging Face revision.',
  ].join('\n');
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function readManifest(manifestPath, dataDir) {
  const source = await readFile(manifestPath, 'utf8');
  const entries = source.split(/\r?\n/u).filter(Boolean).map((line) => {
    const match = line.match(/^([0-9a-f]{64})\s+(.+)$/u);
    if (!match) throw new Error('Checksum manifest has a malformed line.');
    const relativePath = match[2].trim();
    const absolutePath = path.resolve(dataDir, relativePath);
    if (!within(dataDir, absolutePath)) throw new Error('Checksum manifest contains a path outside the dataset directory.');
    return { expected: match[1], relativePath, absolutePath };
  });

  const imageEntries = entries.filter((entry) => /^(clean|noisy)\/\d{3}\.png$/u.test(entry.relativePath));
  const metadataEntries = entries.filter((entry) => /^(clean|noisy)\/metadata\.jsonl$/u.test(entry.relativePath));
  if (entries.length !== 42 || imageEntries.length !== 40 || metadataEntries.length !== 2)
    throw new Error('Expected exactly 40 PNG rows and two metadata files in the checksum manifest.');
  if (new Set(entries.map((entry) => entry.relativePath)).size !== entries.length)
    throw new Error('Checksum manifest contains duplicate paths.');
  return entries;
}

async function hydratePointer(entry) {
  const contents = await readFile(entry.absolutePath).catch(() => Buffer.alloc(0));
  if (!contents.subarray(0, 128).toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1')) return;

  const url = `https://huggingface.co/datasets/nrl-ai/vn-synthetic-ocr/resolve/${DATASET_REVISION}/${entry.relativePath}?download=true`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not hydrate pinned corpus asset ${entry.relativePath}: HTTP ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_000_000) throw new Error(`Pinned corpus asset exceeded the 5 MB limit: ${entry.relativePath}.`);
  await writeFile(entry.absolutePath, bytes);
}

async function verifyDataset(dataDir, manifestPath) {
  let revision;
  try {
    revision = execFileSync('git', ['-C', dataDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Dataset directory must be a Git checkout at the pinned revision.');
  }
  if (revision !== DATASET_REVISION)
    throw new Error(`Dataset revision mismatch: expected ${DATASET_REVISION}, received ${revision}.`);

  const entries = await readManifest(manifestPath, dataDir);
  for (const entry of entries) {
    if (entry.relativePath.endsWith('.png')) await hydratePointer(entry);
    const bytes = await readFile(entry.absolutePath);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== entry.expected) throw new Error(`Checksum mismatch for ${entry.relativePath}.`);
  }
  return { revision, checkedFiles: entries.length };
}

function normalizedForCharacterMetrics(value) {
  return String(value).normalize('NFC').replace(/\r\n?/gu, '\n').trim();
}

function editDistance(left, right) {
  const a = Array.isArray(left) ? left : [...left];
  const b = Array.isArray(right) ? right : [...right];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function summarize(rows) {
  const referenceCharacters = rows.reduce((sum, row) => sum + row.referenceCharacters, 0);
  const characterErrors = rows.reduce((sum, row) => sum + row.characterErrors, 0);
  const referenceTokens = rows.reduce((sum, row) => sum + row.referenceTokens, 0);
  const tokenErrors = rows.reduce((sum, row) => sum + row.tokenErrors, 0);
  const sortedTimes = rows.map((row) => row.elapsedMs).sort((left, right) => left - right);
  const medianElapsedMs = sortedTimes.length
    ? sortedTimes.length % 2
      ? sortedTimes[Math.floor(sortedTimes.length / 2)]
      : (sortedTimes[sortedTimes.length / 2 - 1] + sortedTimes[sortedTimes.length / 2]) / 2
    : null;
  const macroMean = (field) => rows.reduce((sum, row) => sum + row[field], 0) / Math.max(rows.length, 1);
  return {
    cases: rows.length,
    failures: rows.filter((row) => row.failure !== null).length,
    timeouts: rows.filter((row) => row.timeout).length,
    microCer: referenceCharacters ? characterErrors / referenceCharacters : null,
    macroCer: macroMean('cer'),
    microWer: referenceTokens ? tokenErrors / referenceTokens : null,
    macroWer: macroMean('wer'),
    meanElapsedMs: rows.length ? rows.reduce((sum, row) => sum + row.elapsedMs, 0) / rows.length : null,
    medianElapsedMs,
    p95ElapsedMs: rows.length ? sortedTimes[Math.min(sortedTimes.length - 1, Math.ceil(sortedTimes.length * 0.95) - 1)] : null,
    meanConfidence: rows.filter((row) => row.confidence !== null).length
      ? rows.reduce((sum, row) => sum + (row.confidence ?? 0), 0) / rows.filter((row) => row.confidence !== null).length
      : null,
  };
}

function pairedCleanMinusNoisyBootstrap(rows, { replicates = 100_000, seed = 20_261_105 } = {}) {
  const clean = new Map(rows.filter(row => row.stratum === 'clean').map(row => [row.id, row.cer]));
  const noisy = new Map(rows.filter(row => row.stratum === 'noisy').map(row => [row.id, row.cer]));
  const ids = [...clean.keys()].sort();
  if (ids.length !== noisy.size || ids.some(id => !noisy.has(id)))
    throw new Error('Clean and noisy OCR strata must have identical paired row IDs for the bootstrap interval.');

  const differences = ids.map(id => clean.get(id) - noisy.get(id));
  const observedMean = differences.reduce((sum, value) => sum + value, 0) / differences.length;
  const samples = new Array(replicates);
  let state = seed >>> 0;
  const nextRandom = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let sample = 0; sample < replicates; sample += 1) {
    let sum = 0;
    for (let draw = 0; draw < differences.length; draw += 1)
      sum += differences[Math.floor(nextRandom() * differences.length)];
    samples[sample] = sum / differences.length;
  }
  samples.sort((left, right) => left - right);
  const percentile = probability => {
    const position = (samples.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return samples[lower] + (samples[upper] - samples[lower]) * (position - lower);
  };
  return {
    pairedCases: differences.length,
    statistic: 'mean paired per-image CER difference: clean minus noisy',
    pointEstimate: observedMean,
    confidenceLevel: 0.95,
    intervalMethod: 'percentile bootstrap, paired by row ID, resampled with replacement',
    lower: percentile(0.025),
    upper: percentile(0.975),
    replicates,
    seed,
  };
}

function withTimeout(promise, milliseconds) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeoutError()), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function createNodeOcrClient(langPath) {
  let workerPromise;
  let shutdownPromise = Promise.resolve();
  let startupMs = null;
  const worker = () => {
    if (!workerPromise) {
      const startedAt = performance.now();
      workerPromise = createWorker(['eng', 'vie'], 1, {
        langPath,
        cacheMethod: 'none',
        gzip: true,
      }).then((engine) => {
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
        const bytes = Buffer.from(await image.arrayBuffer());
        const { data } = await engine.recognize(bytes);
        return { text: data.text, confidence: data.confidence };
      })();
      return withTimeout(operation, MAX_OCR_TIME_MS);
    },
    terminate() {
      if (workerPromise)
        shutdownPromise = workerPromise.then((engine) => engine.terminate()).catch(() => undefined);
    },
    async waitForShutdown() { await shutdownPromise; },
    get startupMs() { return startupMs; },
  };
}

async function readCases(dataDir) {
  const cases = [];
  for (const stratum of ['clean', 'noisy']) {
    const metadata = await readFile(path.join(dataDir, stratum, 'metadata.jsonl'), 'utf8');
    const lines = metadata.split(/\r?\n/u).filter(Boolean);
    if (lines.length !== 20) throw new Error(`${stratum} metadata must contain exactly 20 rows.`);
    for (const line of lines) {
      const row = JSON.parse(line);
      if (!/^\d{3}$/u.test(row.id) || row.file_name !== `${row.id}.png` || typeof row.text !== 'string' || !row.text)
        throw new Error(`Invalid metadata record in ${stratum}.`);
      if (row.text.normalize('NFC') !== row.text)
        throw new Error(`Ground truth for ${stratum}/${row.id} is not NFC-normalized.`);
      cases.push({ stratum, id: row.id, reference: row.text, imagePath: path.join(dataDir, stratum, row.file_name) });
    }
  }
  return cases;
}

async function evaluateCase(testCase, langPath) {
  const input = new Uint8Array(await readFile(testCase.imagePath));
  const client = await createNodeOcrClient(langPath);
  const startedAt = performance.now();
  let result;
  let failure = null;
  try {
    result = await extractImageWithOcr(input, { createOcrClient: () => client });
  } catch (error) {
    failure = error?.name || 'Error';
    result = { text: '' };
  }
  const elapsedMs = performance.now() - startedAt;
  client.terminate();
  await client.waitForShutdown();
  const reference = normalizedForCharacterMetrics(testCase.reference);
  const hypothesis = normalizedForCharacterMetrics(result?.text ?? '');
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
    stratum: testCase.stratum,
    id: testCase.id,
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
  const packageJson = path.join(REPO_ROOT, 'node_modules', ...packageName.split('/'), 'package.json');
  return JSON.parse(await readFile(packageJson, 'utf8')).version;
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args['dataset-dir']) throw new Error(`--dataset-dir is required.\n${usage()}`);
  const dataDir = args['dataset-dir'];
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const verified = await verifyDataset(dataDir, manifestPath);
  const cases = await readCases(dataDir);
  const langPath = path.join(REPO_ROOT, 'public/ocr/lang');
  const rows = [];
  for (const testCase of cases) rows.push(await evaluateCase(testCase, langPath));

  const groups = Object.fromEntries(['clean', 'noisy'].map((stratum) => [
    stratum,
    summarize(rows.filter((row) => row.stratum === stratum)),
  ]));
  const output = {
    benchmark: 'viendu-app-image-ocr',
    createdAt: new Date().toISOString(),
    dataset: {
      name: 'nrl-ai/vn-synthetic-ocr',
      revision: verified.revision,
      checkedFiles: verified.checkedFiles,
      corpusCases: cases.length,
      license: 'CC0-1.0',
    },
    engine: {
      tesseractJs: await packageVersion('tesseract.js'),
      tesseractCore: await packageVersion('tesseract.js-core'),
      englishLanguagePackage: await packageVersion('@tesseract.js-data/eng'),
      vietnameseLanguagePackage: await packageVersion('@tesseract.js-data/vie'),
      trainedDataModel: LANGUAGE_MODEL,
      languages: ['eng', 'vie'],
      engineMode: 'LSTM (OEM 1)',
      runtime: 'Tesseract.js Node worker injected into app extractImageWithOcr()',
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      system: os.release(),
      langDataSource: 'generated public/ocr/lang assets; no CDN request',
    },
    metricDefinition: {
      normalization: 'Unicode NFC; normalize CRLF to LF; trim outer whitespace; preserve case, punctuation, diacritics, and internal whitespace.',
      cer: 'Unicode code-point Levenshtein distance divided by reference code points; micro and per-row macro.',
      wer: 'Whitespace-token Levenshtein distance divided by reference tokens; Vietnamese whitespace units are syllable-like, not segmented words; micro and per-row macro.',
      timing: 'Time from immediately before extractImageWithOcr() through its return, including worker startup and OCR but excluding asynchronous worker shutdown completion.',
    },
    overall: summarize(rows),
    strata: groups,
    pairedCleanMinusNoisyCer: pairedCleanMinusNoisyBootstrap(rows),
    cases: rows,
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) await writeFile(args.output, json, 'utf8');
  console.log(json.trimEnd());
}

main().catch((error) => {
  console.error(`OCR evaluation failed: ${error?.message || error}`);
  process.exitCode = 1;
});
