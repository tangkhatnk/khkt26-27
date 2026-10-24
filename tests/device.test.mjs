import test from 'node:test';
import assert from 'node:assert/strict';

const deviceModule = await import('../src/adventure/device.ts').catch(() => ({}));
const detectDeviceCategory = deviceModule.detectDeviceCategory;

test('maps common desktop, phone, and tablet user agents to coarse categories', () => {
  const cases = [
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0, 'pc'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 0, 'pc'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, 'pc'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 1, 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, 'tablet'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 5, 'tablet'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36', 5, 'android'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Safari/537.36', 5, 'tablet'],
    ['unrecognized-device', 0, 'unknown'],
  ];

  for (const [userAgent, maxTouchPoints, expected] of cases) {
    assert.equal(detectDeviceCategory?.(userAgent, maxTouchPoints), expected, userAgent);
  }
});
