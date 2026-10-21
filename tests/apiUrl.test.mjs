import assert from 'node:assert/strict';
import test from 'node:test';
import { apiConnectionFailure, resolveApiUrl } from '../src/services/apiUrl.ts';

test('accepts explicitly configured local endpoints', () => {
  for (const host of ['localhost', '127.0.0.1']) {
    const endpoint = `http://${host}:4000/api/v1`;
    assert.equal(resolveApiUrl(endpoint), endpoint);
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
test('missing or blank env always falls back to localhost', () => {
  assert.equal(resolveApiUrl(' '), 'http://localhost:3000/api/v1');
  assert.equal(resolveApiUrl(undefined), 'http://localhost:3000/api/v1');
  assert.equal(resolveApiUrl(undefined), 'http://localhost:3000/api/v1');
  assert.equal(resolveApiUrl(), 'http://localhost:3000/api/v1');
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
