import { createWorker } from 'tesseract.js';

let engine;
let enginePromise;
let currentJob;
let queue = Promise.resolve();

function progress(message) {
  if (!currentJob) return;
  const status = String(message?.status || '').toLowerCase();
  self.postMessage({
    type: 'progress',
    phase: status.includes('recogniz') ? 'recognizing' : 'loading',
    progress: message?.progress,
    page: currentJob.page,
    totalPages: currentJob.totalPages,
  });
}

function createLocalEngine() {
  const ocrRoot = new URL('/ocr/', self.location.href);
  return createWorker(['eng', 'vie'], 1, {
    workerPath: new URL('worker.min.js', ocrRoot).href,
    corePath: new URL('core/', ocrRoot).href,
    langPath: new URL('lang', ocrRoot).href,
    workerBlobURL: false,
    gzip: true,
    cacheMethod: 'write',
    logger: progress,
  });
}

async function handleMessage(message) {
  if (message?.type === 'dispose') {
    try {
      await engine?.terminate();
    } finally {
      engine = undefined;
      self.close();
    }
    return;
  }
  if (message?.type !== 'recognize' || !Number.isInteger(message.id)) return;
  currentJob = { page: message.page, totalPages: message.totalPages };
  try {
    if (!enginePromise) enginePromise = createLocalEngine();
    engine = await enginePromise;
    const result = await engine.recognize(message.image);
    const confidence = result?.data?.confidence;
    self.postMessage({
      type: 'result',
      id: message.id,
      text: result?.data?.text || '',
      ...(typeof confidence === 'number' && Number.isFinite(confidence)
        ? { confidence: Math.max(0, Math.min(100, confidence)) }
        : {}),
    });
  } catch (error) {
    enginePromise = undefined;
    try { await engine?.terminate(); } catch { /* worker is already failing */ }
    engine = undefined;
    self.postMessage({
      type: 'error',
      id: message.id,
      message: String(error?.message || 'Local OCR could not read this page.'),
    });
  } finally {
    currentJob = undefined;
  }
}

self.addEventListener('message', (event) => {
  queue = queue.then(() => handleMessage(event.data)).catch(() => {
    // The individual request reports its failure above; keep the worker alive only if possible.
  });
});
