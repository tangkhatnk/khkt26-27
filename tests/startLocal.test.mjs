import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { LOCAL_PORTS, startLocalStack } from '../scripts/start-local.mjs';

test('does not spawn a second local stack when one of its ports is already occupied', async () => {
  const webPort = 8084;
  let spawnCount = 0;
  await assert.rejects(
    startLocalStack({
      ports: { api: 3000, database: 15433, web: webPort },
      portIsAvailable: async (_host, port) => port !== webPort,
      probeHttp: async () => null,
      spawnChild: () => { spawnCount++; throw new Error('must not spawn'); },
    }),
    /web port 8084.*health check/i,
  );
  assert.equal(spawnCount, 0);
});

test('reuses a healthy local API and does not take ownership of its process', async () => {
  const checkedAddresses = [];
  const children = [];
  const stack = await startLocalStack({
    ports: LOCAL_PORTS,
    portIsAvailable: async (host, port) => {
      checkedAddresses.push(host);
      return port !== LOCAL_PORTS.api;
    },
    probeHttp: async (_host, _port, path) => path === '/health'
      ? { status: 200, body: { status: 'healthy', mode: 'local-development', version: '1.0.0' } }
      : null,
    waitForReady: async () => {},
    spawnChild: (_command, args) => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => { child.signalCode = signal; child.emit('exit', null, signal); };
      children.push({ child, args });
      return child;
    },
  });

  assert.ok(checkedAddresses.includes('::1'));
  assert.equal(children.length, 1);
  assert.match(children[0].args.join(' '), /vite\.js/);
  await stack.stop();
});

test('reuses a healthy Viễn Du web server and starts only the local API', async () => {
  const children = [];
  const readyServices = [];
  const checkedAddresses = [];
  const stack = await startLocalStack({
    ports: LOCAL_PORTS,
    portIsAvailable: async (host, port) => {
      checkedAddresses.push(host);
      return port !== LOCAL_PORTS.web;
    },
    probeHttp: async (_host, _port, path) => path === '/'
      ? { status: 200, body: '<title>Viễn Du — Hành trình học tập</title>' }
      : null,
    waitForReady: async (_child, _addresses, _port, _path, label) => readyServices.push(label),
    spawnChild: (_command, args) => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => { child.signalCode = signal; child.emit('exit', null, signal); };
      children.push(args);
      return child;
    },
  });

  assert.ok(checkedAddresses.includes('::1'));
  assert.equal(children.length, 1);
  assert.match(children[0].join(' '), /dev-local\.ts/);
  assert.deepEqual(readyServices, ['Local API']);
  await stack.stop();
});

test('starts the API before Vite and shuts down both owned processes', async () => {
  class FakeChild extends EventEmitter {
    exitCode = null;
    signalCode = null;
    signals = [];
    kill(signal) {
      this.signals.push(signal);
      this.signalCode = signal;
      this.emit('exit', null, signal);
      return true;
    }
  }
  const children = [];
  const spawnCalls = [];
  const stack = await startLocalStack({
    ports: { api: 0, database: 0, web: 0 },
    portIsAvailable: async () => true,
    waitForReady: async () => {},
    spawnChild: (...args) => {
      const child = new FakeChild();
      children.push(child);
      spawnCalls.push(args);
      return child;
    },
    environment: { GEMINI_API_KEY: 'server-only-key' },
  });

  assert.equal(children.length, 2);
  assert.match(spawnCalls[0][1].join(' '), /dev-local\.ts/);
  assert.match(spawnCalls[1][1].join(' '), /vite\.js/);
  assert.equal(spawnCalls[0][2].env.GEMINI_API_KEY, 'server-only-key');
  assert.equal(spawnCalls[1][2].env.GEMINI_API_KEY, undefined);
  assert.equal(spawnCalls[1][2].env.VITE_API_URL, undefined);

  await stack.stop();
  assert.deepEqual(children.map((child) => child.signals), [['SIGTERM'], ['SIGTERM']]);
});

test('preserves an explicit public API URL for Vite without exposing backend secrets', async () => {
  const spawnCalls = [];
  const stack = await startLocalStack({
    ports: { api: 0, database: 0, web: 0 },
    portIsAvailable: async () => true,
    waitForReady: async () => {},
    spawnChild: (...args) => {
      const child = new EventEmitter();
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => { child.signalCode = signal; child.emit('exit', null, signal); };
      spawnCalls.push(args);
      return child;
    },
    environment: {
      GEMINI_API_KEY: 'server-only-key',
      VITE_API_URL: ' https://api.example.com/api/v1/ ',
    },
  });

  const webEnvironment = spawnCalls[1][2].env;
  assert.equal(webEnvironment.VITE_API_URL, 'https://api.example.com/api/v1/');
  assert.equal(webEnvironment.GEMINI_API_KEY, undefined);
  await stack.stop();
});

test('an interrupted startup stops the child it already launched', async () => {
  class FakeChild extends EventEmitter {
    exitCode = null;
    signalCode = null;
    signals = [];
    kill(signal) {
      this.signals.push(signal);
      this.signalCode = signal;
      this.emit('exit', null, signal);
      return true;
    }
  }
  const controller = new AbortController();
  const child = new FakeChild();
  await assert.rejects(
    startLocalStack({
      ports: { api: 0, database: 0, web: 0 },
      portIsAvailable: async () => true,
      spawnChild: () => child,
      waitForReady: async () => { controller.abort(); },
      signal: controller.signal,
    }),
    /interrupted/i,
  );
  assert.deepEqual(child.signals, ['SIGTERM']);
});
