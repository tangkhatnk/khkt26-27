const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { fileURLToPath } = require('node:url');

const projectRoot = resolve(__dirname, '../..');

test('Electron serves its bundled shell with only the configured API origin in CSP', async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'viendu-electron-protocol-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));

  const desktop = join(fixture, 'desktop');
  const dist = join(desktop, 'dist');
  const webDist = join(desktop, 'web-dist');
  mkdirSync(dist, { recursive: true });
  mkdirSync(webDist, { recursive: true });
  cpSync(join(projectRoot, 'desktop/dist'), dist, { recursive: true });
  writeFileSync(join(webDist, 'index.html'), 'bundled shell');
  writeFileSync(join(webDist, '..preview.png'), 'asset name beginning with two dots');
  writeFileSync(join(webDist, 'pdf.worker.min.mjs'), 'export const worker = true;');
  mkdirSync(join(webDist, 'ocr'), { recursive: true });
  writeFileSync(join(webDist, 'ocr', 'worker.min.js'), 'self.ocr = true;');
  writeFileSync(join(webDist, 'ocr', 'engine.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(
    join(webDist, 'desktop-config.json'),
    JSON.stringify({ apiOrigin: 'http://192.168.1.50:3000' }),
  );

  let readyTask;
  let protocolHandler;
  const fetches = [];
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.loadURL = async () => {};
    }
    loadURL = async () => {};
    show() {}
    focus() {}
  }

  const electron = {
    app: Object.assign(new EventEmitter(), {
      requestSingleInstanceLock: () => true,
      whenReady: () => ({
        then: (callback) => {
          readyTask = Promise.resolve().then(callback);
          return readyTask;
        },
      }),
      quit() {},
    }),
    BrowserWindow: FakeWindow,
    net: {
      fetch: async (url) => {
        fetches.push(url);
        return new Response(readFileSync(fileURLToPath(url)), {
          headers: { 'content-type': 'text/html' },
        });
      },
    },
    protocol: {
      registerSchemesAsPrivileged() {},
      handle: (scheme, handler) => {
        assert.equal(scheme, 'viendu');
        protocolHandler = handler;
      },
    },
    session: {
      defaultSession: {
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
      },
    },
    powerMonitor: new EventEmitter(),
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electron;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    require(join(dist, 'adventureMain.js'));
  } finally {
    Module._load = originalLoad;
  }
  await readyTask;

  const dotNameResponse = await protocolHandler({
    url: 'viendu://app/..preview.png',
    method: 'GET',
  });
  assert.equal(dotNameResponse.status, 200);
  assert.equal(await dotNameResponse.text(), 'asset name beginning with two dots');

  const response = await protocolHandler({ url: 'viendu://app/', method: 'GET' });
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' http:\/\/192\.168\.1\.50:3000/);
  assert.match(csp, /http:\/\/localhost:3000/);
  assert.match(csp, /http:\/\/127\.0\.0\.1:3000/);
  assert.doesNotMatch(csp, /connect-src[^;]*\bhttps:/);
  const workerResponse = await protocolHandler({ url: 'viendu://app/pdf.worker.min.mjs', method: 'GET' });
  assert.match(workerResponse.headers.get('content-type'), /javascript/);
  assert.match(csp, /worker-src 'self' blob:/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /(?:^|\s)'unsafe-eval'/);
  const ocrWorker = await protocolHandler({ url: 'viendu://app/ocr/worker.min.js', method: 'GET' });
  assert.match(ocrWorker.headers.get('content-type'), /javascript/);
  const wasm = await protocolHandler({ url: 'viendu://app/ocr/engine.wasm', method: 'GET' });
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer())], [0, 97, 115, 109]);
  assert.equal(fetches.length, 5);
  assert.match(fetches[1], /web-dist[\\/]index\.html/);
});
