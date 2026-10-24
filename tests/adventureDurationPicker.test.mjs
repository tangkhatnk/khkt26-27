import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('DurationPicker summarizes valid plans and keeps exact intervals behind a disclosure', async (t) => {
  const vite = await createServer({
    root,
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
  });
  t.after(() => vite.close());

  const { DurationPicker } = await vite.ssrLoadModule('/src/adventure/DurationPicker.tsx');
  const render = (props = {}) => renderToStaticMarkup(createElement(DurationPicker, {
    value: 25,
    breakCount: 0,
    breakMinutes: 5,
    onChange: () => {},
    onBreakCountChange: () => {},
    onBreakMinutesChange: () => {},
    ...props,
  }));

  await t.test('zero breaks reads as continuous study without an empty disclosure', () => {
    const html = render({ breakMinutes: 31 });

    assert.match(html, /<strong>25 phút<\/strong>/);
    assert.match(html, /25 phút học liên tục/);
    assert.doesNotMatch(html, /<details/);
    assert.doesNotMatch(html, /<p class="duration-total-invalid"/);
  });

  await t.test('one break uses singular wording and preserves its exact schedule', () => {
    const html = render({ value: 15, breakCount: 1 });

    assert.match(html, /<strong>20 phút<\/strong>/);
    assert.match(html, /15 phút học · 1 lần nghỉ × 5 phút/);
    assert.match(html, /2 chặng học, chia đều 15 phút học\./);
    assert.match(html, /<details class="duration-details"><summary>Xem lịch từng chặng<\/summary>/);
    assert.match(html, /Học 07:30 → Nghỉ 05:00 → Học 07:30/);
  });

  await t.test('ten breaks summarize to 75 minutes and disclose all eleven rounded study intervals', () => {
    const html = render({ breakCount: 10 });

    assert.match(html, /<strong>75 phút<\/strong>/);
    assert.match(html, /25 phút học · 10 lần nghỉ × 5 phút/);
    assert.match(html, /11 chặng học, chia đều 25 phút học\./);
    assert.match(html, /<details class="duration-details"><summary>Xem lịch từng chặng<\/summary>/);
    assert.match(html, /Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16 → Nghỉ 05:00 → Học 02:16/);

    const detailsStart = html.indexOf('<details');
    const liveSummaryStart = html.indexOf('<div class="duration-total-summary"');
    const liveSummary = html.slice(liveSummaryStart, detailsStart);
    assert.notEqual(liveSummaryStart, -1);
    assert.notEqual(detailsStart, -1);
    assert.match(liveSummary, /aria-live="polite"/);
    assert.doesNotMatch(liveSummary, /Học 02:|Nghỉ 05:/);
    assert.doesNotMatch(html.slice(detailsStart), /<details[^>]*\sopen(?:\s|=|>)/);
  });

  await t.test('invalid plans show errors without a stale total or schedule', () => {
    for (const props of [
      { breakCount: 11 },
      { breakCount: 1, breakMinutes: 31 },
    ]) {
      const html = render(props);

      assert.match(html, /role="alert"/);
      assert.match(html, /<p class="duration-total-invalid"[^>]*aria-live="polite"/);
      assert.doesNotMatch(html, /<strong>75 phút<\/strong>/);
      assert.doesNotMatch(html, /<details/);
    }
  });
});
