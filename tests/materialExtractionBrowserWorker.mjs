import { parentPort, workerData } from 'node:worker_threads';

// Model the browser globals that OfficeParser's slim browser bundle expects,
// while removing Node globals that can mask accidental server-only usage.
globalThis.window = globalThis;
globalThis.document = {};
globalThis.Buffer = undefined;
globalThis.setImmediate = undefined;

const { extractMaterialFile } = await import('../src/material/extractMaterialFile.mjs');
const input = new File([workerData.bytes], workerData.name);
parentPort.postMessage(await extractMaterialFile(input));
