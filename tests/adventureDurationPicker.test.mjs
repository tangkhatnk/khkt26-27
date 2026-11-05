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

  const { DurationPicker, DurationPickerControls } = await vite.ssrLoadModule('/src/adventure/DurationPicker.tsx');
  const render = (props = {}) => renderToStaticMarkup(createElement(DurationPicker, {
    value: 25,
    breakCount: 0,
    breakMinutes: 5,
    onChange: () => {},
    onBreakCountChange: () => {},
    onBreakMinutesChange: () => {},
    ...props,
  }));
  const findElements = (tree, predicate, found = []) => {
    if (Array.isArray(tree)) {
      for (const child of tree) findElements(child, predicate, found);
    } else if (tree && typeof tree === 'object' && 'type' in tree) {
      if (predicate(tree)) found.push(tree);
      findElements(tree.props?.children, predicate, found);
    }
    return found;
  };

  await t.test('slider, number input, and all presets call the same controlled change callback', () => {
    assert.equal(typeof DurationPickerControls, 'function');
    const changes = [];
    const tree = DurationPickerControls({
      id: 'duration-test', value: 45, onChange: value => changes.push(value),
      durationValid: true, durationLocked: false,
      durationHelpId: 'duration-help', durationErrorId: 'duration-error',
    });
    const slider = findElements(tree, element => element.type === 'input' && element.props.type === 'range')[0];
    const number = findElements(tree, element => element.type === 'input' && element.props.type === 'number')[0];
    const presets = findElements(tree, element => element.type === 'button');

    assert.ok(slider);
    assert.ok(number);
    assert.equal(presets.length, 4);
    slider.props.onChange({ target: { value: '90' }, currentTarget: { value: '90' } });
    number.props.onChange({ target: { value: '1.5' }, currentTarget: { value: '1.5' } });
    number.props.onChange({ target: { value: '' }, currentTarget: { value: '' } });
    for (const value of [0, 241]) {
      number.props.onChange({ target: { value: String(value) } });
    }
    presets.forEach(preset => preset.props.onClick());

    assert.deepEqual(changes.slice(0, 2), [90, 1.5]);
    assert.ok(Number.isNaN(changes[2]));
    assert.deepEqual(changes.slice(3), [0, 241, 15, 25, 45, 60]);
  });

  await t.test('slider and numeric control share the controlled minute values from 1 through 240', () => {
    assert.equal(typeof DurationPickerControls, 'function');
    for (const minutes of [1, 45, 90, 240]) {
      const changes = [];
      const tree = DurationPickerControls({
        id: `duration-${minutes}`, value: minutes, onChange: value => changes.push(value),
        durationValid: true, durationLocked: false,
        durationHelpId: `help-${minutes}`, durationErrorId: `error-${minutes}`,
      });
      const slider = findElements(tree, element => element.type === 'input' && element.props.type === 'range')[0];
      const number = findElements(tree, element => element.type === 'input' && element.props.type === 'number')[0];
      const currentValue = findElements(tree, element => element.type === 'output')[0];

      assert.equal(slider.props.value, minutes);
      assert.equal(slider.props.min, 1);
      assert.equal(slider.props.max, 240);
      assert.equal(slider.props.step, 1);
      assert.equal(number.props.value, minutes);
      assert.equal(currentValue.props.children, `${minutes} phút`);
      slider.props.onChange({ currentTarget: { value: String(minutes) } });
      number.props.onChange({ target: { value: String(minutes) } });
      assert.deepEqual(changes, [minutes, minutes]);
    }
  });

  await t.test('invalid duration values remain visible and do not change the break fields', () => {
    for (const value of [NaN, 0, 1.5, 241]) {
      const html = render({ value, breakCount: 1, breakMinutes: 7 });
      const inputs = [...html.matchAll(/<input\b[^>]*>/gu)].map(([input]) => input);
      const slider = inputs.find(input => input.includes('type="range"'));
      const duration = inputs.find(input => input.includes('type="number"') && input.includes('-duration"'));
      const breaks = inputs.filter(input => input.includes('-break-'));

      assert.ok(slider?.includes('aria-invalid="true"'));
      assert.ok(slider?.includes('aria-valuetext="Giá trị nhập hiện tại:'));
      assert.ok(slider?.includes(Number.isNaN(value) ? 'Chưa nhập số phút' : `${value} phút · không hợp lệ`));
      assert.ok(duration?.includes('aria-invalid="true"'));
      assert.equal(breaks.length, 2);
      assert.ok(breaks[0].includes('value="1"'));
      assert.ok(breaks[1].includes('value="7"'));
      assert.match(html, /Vui lòng nhập số phút nguyên từ 1 đến 240\./u);
      assert.match(html, /duration-total-invalid/u);
      assert.doesNotMatch(html, /<strong>12 phút<\/strong>|<details/u);
      assert.match(html, Number.isNaN(value) ? /Chưa nhập/u : new RegExp(`${value} phút`));

      const changes = [];
      const tree = DurationPickerControls({
        id: `invalid-${String(value)}`, value, onChange: next => changes.push(next),
        durationValid: false, durationLocked: false,
        durationHelpId: 'invalid-help', durationErrorId: 'invalid-error',
      });
      const number = findElements(tree, element => element.type === 'input' && element.props.type === 'number')[0];
      number.props.onChange({ target: { value: Number.isNaN(value) ? '' : String(value) } });
      assert.equal(changes.length, 1);
      assert.equal(Number.isNaN(value) ? Number.isNaN(changes[0]) : changes[0] === value, true);
    }
  });

  await t.test('duration slider, numeric input, and presets have accessible labels and visible keyboard focus', async () => {
    const html = render({ value: 45 });
    const styles = await import('node:fs/promises').then(fs => fs.readFile(
      new URL('../src/adventure/duration.css', import.meta.url), 'utf8'));
    const controls = DurationPickerControls({
      id: 'keyboard-duration', value: 45, onChange() {}, durationValid: true,
      durationLocked: false, durationHelpId: 'duration-help', durationErrorId: 'duration-error',
    });
    const slider = findElements(controls, element => element.type === 'input' && element.props.type === 'range')[0];

    assert.match(html, /<label[^>]*>Thời gian tùy chỉnh/u);
    assert.match(html, /Thời lượng học/u);
    assert.match(html, /aria-valuetext="45 phút"/u);
    assert.equal(slider.props['aria-label'], 'Thời lượng học');
    assert.match(html, /aria-invalid="false"/u);
    assert.match(styles, /\.duration-slider:focus-visible/u);
    assert.match(styles, /\.custom-duration input:focus-visible/u);
    assert.match(styles, /\.quick-times button:focus-visible/u);
    assert.match(styles, /html\[data-theme="dark"\] \.adventure \.duration-slider/u);
    assert.match(styles, /html\[data-theme="dark"\] \.adventure \.duration-current-value\.is-invalid/u);
  });

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

  await t.test('a synchronized trip locks both shared break controls', () => {
    const html = render({ breakCount: 1, breaksLocked: true });
    const inputs = [...html.matchAll(/<input\b[^>]*>/gu)].map(([input]) => input);
    const breakCountInput = inputs.find((input) => input.includes('-break-count'));
    const breakMinutesInput = inputs.find((input) => input.includes('-break-minutes'));

    assert.ok(breakCountInput?.includes('disabled=""'));
    assert.ok(breakMinutesInput?.includes('disabled=""'));
  });
});
