import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MaterialSourceReader, MaterialSourceReviewButton } from '../src/adventure/MaterialSourceReader.ts';
import { createMaterialSource, quizSourceText } from '../src/adventure/materialSources.ts';

test('shows a safe formatted source by default without changing the original or bypassing review', () => {
  const original = '# Phân tử nước\n\nNước có **vai trò** trong trao đổi chất.\n\n- Hòa tan chất\n- Điều hòa nhiệt độ\n\n<img src=x onerror=alert(1)>';
  const source = createMaterialSource('source-1', {
    name: 'Sinh học.txt',
    text: original,
    source: 'ai-generated',
    quality: 'needs-review',
  });

  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: source.name,
    text: source.text,
    onChange: () => {},
    textareaLabel: 'Bản chép tài liệu',
    maxLength: 20000,
  }));

  assert.match(html, /<h2>Phân tử nước<\/h2>/);
  assert.match(html, /<strong>vai trò<\/strong>/);
  assert.match(html, /<ul><li>Hòa tan chất<\/li><li>Điều hòa nhiệt độ<\/li><\/ul>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img\b|<textarea\b/);
  assert.match(html, /aria-pressed="true">Đọc dễ xem<\/button>/);
  assert.equal(source.text, original);
  assert.throws(
    () => quizSourceText('', [source], [{ name: source.name, sourceId: source.id }]),
    /kiểm tra và xác nhận/,
  );
});

test('source review confirmation is an explicit primary action', () => {
  const html = renderToStaticMarkup(createElement(MaterialSourceReviewButton, {
    disabled: false,
    onClick: () => {},
  }));

  assert.match(html, /<button type="button" class="primary">Xác nhận nội dung đã kiểm tra<\/button>/);
});

test('renders read-only text with safe paragraph and chemistry notation', () => {
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: 'Ghi chú',
    text: 'Nước tham gia phản ứng.\n\nCông thức: $\\ce{H2O}$.',
  }));

  assert.match(html, /<p>Nước tham gia phản ứng\.<\/p>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<msub>/);
  assert.match(html, /<mn>2<\/mn>/);
  assert.match(html, /class="katex-html"/);
  assert.match(html, /class="msupsub"/);
  assert.doesNotMatch(html, /material-reader__toolbar/);
});

test('renders vector norms and fractions inside table cells without splitting math or escaped pipes', () => {
  const text = [
    '| Vector | Norm |',
    '| --- | --- |',
    '| a | $|\\vec{a}| = \\sqrt{a_1^2+a_2^2}$ |',
    '| fraction | \\(\\frac{3}{4}\\) |',
    '| label\\|text | plain |',
  ].join('\n');
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: 'Toán', text,
  }));

  assert.equal((html.match(/<th\b/gu) ?? []).length, 2);
  assert.equal((html.match(/<td\b/gu) ?? []).length, 6);
  assert.match(html, /<td>label\|text<\/td>/u);
  assert.match(html, /class="katex"/u);
  assert.match(html, /<mover\b/u);
  assert.match(html, /<msqrt>/u);
  assert.match(html, /<mfrac>/u);
});

test('keeps an escaped pipe in the final table cell when the row has no trailing separator', () => {
  const text = '| First | Last |\n| --- | --- |\n| a | b\\|';
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, { title: 'Ghi chú', text }));

  assert.equal((html.match(/<td\b/gu) ?? []).length, 2);
  assert.match(html, /<td>b\|<\/td>/u);
});

test('ignores spaces after an outer table separator instead of adding an empty cell', () => {
  const text = '| First | Last |\n| --- | --- |\n| a | b |   ';
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, { title: 'Ghi chú', text }));

  assert.equal((html.match(/<td\b/gu) ?? []).length, 2);
  assert.match(html, /<tr><td>a<\/td><td>b<\/td><\/tr>/u);
});

test('does not treat an unmatched currency dollar as an inline math delimiter in a table', () => {
  const text = '| Number | Cost | Note |\n| --- | --- | --- |\n| 10 | $10 | dollar |';
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, { title: 'Ghi chú', text }));

  assert.equal((html.match(/<td\b/gu) ?? []).length, 3);
  assert.match(html, /<tr><td>10<\/td><td>\$10<\/td><td>dollar<\/td><\/tr>/u);
  assert.doesNotMatch(html, /class="katex"/u);
});

test('formats old AI guides for display without changing their saved source or editor value', () => {
  const backslash = String.fromCharCode(92);
  const escapedBreak = `${backslash}n`;
  const original = [
    '# Bản cũ', '', '| Chất | Công thức |', '| --- | --- |', '| Bạc nitrat | $AgNO_3$ |',
  ].join(escapedBreak);
  const source = createMaterialSource('source-old-ai', {
    name: 'Bản cũ.txt', text: original, source: 'ai-generated', quality: 'needs-review',
  });
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: source.name, text: source.text, aiGenerated: source.source === 'ai-generated', onChange: () => {},
  }));

  assert.match(html, /<table>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /AgNO/);
  assert.match(html, /<msub>/);
  assert.match(html, /class="katex-html"/);
  assert.match(html, /class="msupsub"/);
  assert.equal(source.text, original);
});

test('renders saved AI-source illustrations without merging them into the editable source text', () => {
  const illustration = {
    kind: 'coordinate-plot', afterSection: 'theory', title: 'Đồ thị hàm số',
    description: 'Mẫu điểm được nối bằng đường thẳng.',
    xAxis: { label: 'x', min: -1, max: 1 }, yAxis: { label: 'y', min: -1, max: 1 },
    series: [{ label: 'f(x)', points: [[-1, -1], [0, 0], [1, 1]] }],
  };
  const original = '## 2. Lý thuyết\nĐồ thị là công cụ trực quan.';
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: 'Toán học.txt', text: original, aiGenerated: true, illustrations: [illustration], onChange: () => {},
  }));

  assert.match(html, /Đồ thị hàm số/u);
  assert.match(html, /<polyline/u);
  assert.doesNotMatch(html, /<textarea\b/u);
  assert.equal(original, '## 2. Lý thuyết\nĐồ thị là công cụ trực quan.');
});
