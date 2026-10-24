import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MaterialSourceReader } from '../src/adventure/MaterialSourceReader.ts';
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

test('renders read-only text with safe paragraph and chemistry notation', () => {
  const html = renderToStaticMarkup(createElement(MaterialSourceReader, {
    title: 'Ghi chú',
    text: 'Nước tham gia phản ứng.\n\nCông thức: $\\ce{H2O}$.',
  }));

  assert.match(html, /<p>Nước tham gia phản ứng\.<\/p>/);
  assert.match(html, /H<sub>2<\/sub>O/);
  assert.doesNotMatch(html, /material-reader__toolbar/);
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
  assert.match(html, /AgNO<sub>3<\/sub>/);
  assert.equal(source.text, original);
});
