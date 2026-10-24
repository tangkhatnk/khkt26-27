import assert from 'node:assert/strict';
import test from 'node:test';
import { apiConnectionFailure, resolveApiUrl } from '../src/services/apiUrl.ts';
import viteConfig from '../vite.config.ts';

test('accepts explicitly configured local endpoints', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    const endpoint = `http://${host}:4000/api/v1`;
    assert.equal(resolveApiUrl(endpoint), endpoint);
  }
});
test('browser HTTP pages default to their own origin for local and deployed hosts', () => {
  for (const pageUrl of [
    'http://localhost:8084/',
    'http://127.0.0.1:8084/journey',
    'https://viendu.up.railway.app/account',
  ]) {
    assert.equal(resolveApiUrl(undefined, pageUrl), `${new URL(pageUrl).origin}/api/v1`);
    assert.equal(resolveApiUrl('', pageUrl), `${new URL(pageUrl).origin}/api/v1`);
  }
});
test('preserves explicit remote API URLs and local endpoints on local browser pages', () => {
  assert.equal(
    resolveApiUrl('https://api.example.com/', 'https://viendu.up.railway.app/'),
    'https://api.example.com/api/v1',
  );
  assert.equal(
    resolveApiUrl('http://127.0.0.1:3000/api/v1', 'http://localhost:8084/'),
    'http://127.0.0.1:3000/api/v1',
  );
});
test('a public browser page never uses an explicitly configured loopback API', () => {
  const publicPage = 'https://viendu.up.railway.app/account';
  for (const endpoint of [
    'http://localhost:3000/api/v1',
    'http://127.0.0.1:3000/api/v1',
    'http://[::1]:3000/api/v1',
    'http://0.0.0.0:3000/api/v1',
  ]) {
    assert.equal(resolveApiUrl(endpoint, publicPage), 'https://viendu.up.railway.app/api/v1');
  }
});
test('normalizes LAN and HTTPS endpoints without duplicating the API prefix', () => {
  assert.equal(resolveApiUrl(' http://192.168.1.182:3000/// '), 'http://192.168.1.182:3000/api/v1');
  assert.equal(resolveApiUrl('https://api.example.com/api/v1/'), 'https://api.example.com/api/v1');
});
test('web uses the configured deployment endpoint', () => {
  assert.equal(resolveApiUrl('http://192.168.1.182:3000/api/v1'), 'http://192.168.1.182:3000/api/v1');
  assert.equal(resolveApiUrl('https://api.example.com'), 'https://api.example.com/api/v1');
  assert.throws(() => resolveApiUrl('ftp://api.example.com'));
});
test('Node and custom-protocol desktop contexts retain the localhost fallback', () => {
  for (const pageUrl of [undefined, 'viendu://app/', 'file:///Applications/Viễn Du/index.html']) {
    assert.equal(resolveApiUrl(' ', pageUrl), 'http://localhost:3000/api/v1');
    assert.equal(resolveApiUrl(undefined, pageUrl), 'http://localhost:3000/api/v1');
  }
});
test('custom-protocol desktop contexts retain an explicitly configured API', () => {
  assert.equal(
    resolveApiUrl('https://api.example.com/api/v1', 'viendu://app/'),
    'https://api.example.com/api/v1',
  );
});
test('Vite dev and preview proxy same-origin API requests to the local backend', () => {
  for (const server of [viteConfig.server, viteConfig.preview]) {
    assert.equal(server.proxy['/api'].target, 'http://127.0.0.1:3000');
    assert.equal(server.proxy['/api'].changeOrigin, true);
  }
});
test('rejects endpoints that are not HTTP URLs', () => {
  assert.throws(() => resolveApiUrl('ftp://api.example.com'));
  assert.throws(() => resolveApiUrl('192.168.1.182:3000'));
});

test('distinguishes API timeouts from an unavailable API server', () => {
  assert.deepEqual(apiConnectionFailure(true), {
    status: 504,
    message: 'Máy chủ phản hồi quá lâu. Hãy thử lại.',
  });
  assert.deepEqual(apiConnectionFailure(false), {
    status: 0,
    message: 'Không kết nối được máy chủ Viễn Du. Hãy kiểm tra mạng và địa chỉ API.',
  });
});
