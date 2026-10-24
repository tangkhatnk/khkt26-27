import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudyGuideArticle, StudyGuideInlineText } from '../src/adventure/StudyGuideRenderer.ts';
import { createStudyGuideReviewState, hasPendingStudyGuide, reduceStudyGuideReview } from '../src/adventure/studyGuideReview.ts';

function renderArticle(title, text) {
  return renderToStaticMarkup(createElement(StudyGuideArticle, { title, text }));
}

test('renders guide Markdown as readable article structure and typesets common chemistry and math notation', () => {
  const html = renderArticle(
    'Ôn tập quang hợp',
    '## Ý chính\nQuang hợp tạo **glucose** và giải phóng O₂.\n\n| Chất | Công thức |\n| --- | --- |\n| Nước | $\\ce{H2O}$ |\n\n- Nhận ánh sáng\n- Tạo năng lượng $E = mc^2$\n\nPhản ứng: $\\ce{2H2 + O2 \\rightarrow 2H2O}$. Chỉ số $x_{n+1}$ giúp phân biệt các giá trị.',
  );

  assert.match(html, /<h2>Ôn tập quang hợp<\/h2>/);
  assert.match(html, /<h3>Ý chính<\/h3>/);
  assert.match(html, /<strong>glucose<\/strong>/);
  assert.match(html, /<table>/);
  assert.match(html, /<th scope="col">Chất<\/th>/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<msub>/);
  assert.match(html, /<ul><li>Nhận ánh sáng<\/li><li>Tạo năng lượng/);
  assert.match(html, /<msup>/);
  assert.match(html, /→/);
  assert.match(html, /<article class="study-guide__article" aria-label="Bản xem trước: Ôn tập quang hợp" tabindex="0">/);
});

test('keeps amino-acid charge signs separate from following bonds', () => {
  const html = renderArticle('Amino acid', '$H_3N^+-R-COO^-$');

  assert.match(html, /class="katex"/);
  assert.match(html, /<msub>/);
  assert.match(html, /<msup>/);
  assert.match(html, /COO/);
});

test('renders nested fractions and keeps unsupported math commands visible', () => {
  const html = renderArticle('Toán học', '$\\frac{a+b}{c+d}$; $\\unknown{x+y}$');

  assert.match(html, /<mfrac>/);
  assert.match(html, /mathcolor="#cc0000"/);
  assert.match(html, /<mtext>\\unknown<\/mtext>/);
  assert.match(html, /\\unknown\{x\+y\}/);
  assert.match(renderArticle('Phân số', '$\\frac{a}{2x}$'), /<mfrac>/);
});

test('typesets nested fractions, scripts, integrals, and sums in display and inline math', () => {
  const display = renderArticle('Tích phân', String.raw`$$\int_0^1 \frac{1}{1 + \frac{1}{x^2}}\,dx = \sum_{n=1}^{\infty} \frac{1}{n^2}$$`);
  const inline = renderToStaticMarkup(createElement(StudyGuideInlineText, {
    text: String.raw`$x_{n+1}^{2} = \frac{a + \frac{b}{c}}{d}$`,
  }));

  assert.match(display, /class="katex-display"/u);
  assert.match(display, /<mfrac>/u);
  assert.match(display, /∫/u);
  assert.match(display, /∑/u);
  assert.doesNotMatch(display.replace(/<annotation\b[\s\S]*?<\/annotation>/gu, ''), /\\(?:int|sum|frac)/u);
  assert.match(inline, /class="katex"/u);
  assert.match(inline, /<msubsup>/u);
  assert.match(inline, /<mfrac>/u);
  assert.doesNotMatch(inline.replace(/<annotation\b[\s\S]*?<\/annotation>/gu, ''), /\\frac/u);
});

test('keeps malformed math visible and unsafe source inert, while code remains literal', () => {
  const malformed = renderArticle('Lỗi công thức', String.raw`\[\frac{1}{2\]`);
  const unsafe = renderArticle('Nguồn không tin cậy', [
    String.raw`$\htmlClass{evil}{x}$ <img src=x onerror=alert(1)>`,
    '',
    '```tex',
    String.raw`\int_0^1 x\,dx`,
    '```',
    'Inline `\\sum_{n=1}^N`.',
  ].join('\n'));

  assert.match(malformed, /\\frac\{1\}\{2/u);
  assert.match(malformed, /katex-error/u);
  assert.doesNotMatch(unsafe, /<img\b|class="evil"/u);
  assert.match(unsafe, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(unsafe, /<pre><code>\\int_0\^1 x\\,dx<\/code><\/pre>/u);
  assert.match(unsafe, /<code>\\sum_\{n=1\}\^N<\/code>/u);
});

test('renders common chemistry arrows and quiz inline notation through the safe inline renderer', () => {
  const arrow = renderArticle('Hóa học', String.raw`$2H_2 + O_2 \xrightarrow{t^o} 2H_2O$`);
  const inline = renderToStaticMarkup(createElement(StudyGuideInlineText, {
    text: String.raw`$AgNO_3$ / $Cu(OH)_2$ <img src=x onerror=alert(1)>`,
  }));

  assert.match(arrow, /class="katex"/);
  assert.match(arrow, /<msub>/);
  assert.match(arrow, /→/);
  assert.match(arrow, /<mover/);
  assert.doesNotMatch(arrow.replace(/<annotation\b[\s\S]*?<\/annotation>/gu, ''), /\\xrightarrow/);
  assert.match(inline, /class="katex"/);
  assert.match(inline, /AgNO/);
  assert.match(inline, /Cu/);
  assert.match(inline, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(inline, /<img\b/);
});

test('normalizes escaped line breaks only for explicitly identified AI guide display', () => {
  const backslash = String.fromCharCode(92);
  const escapedBreak = `${backslash}n`;
  const source = [
    '## So sánh', '', '| Chất | Công thức |', '| --- | --- |', '| Bạc nitrat | $AgNO_3$ |', '',
    `Ký hiệu tần số $${backslash}nu$.`, '', '```txt',
    `const literal = "line${backslash}nnext";`, '```',
  ].join(escapedBreak);
  const renderedAi = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Hóa học', text: source, aiGenerated: true,
  }));
  const renderedUser = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Hóa học', text: source,
  }));

  assert.match(renderedAi, /<table>/);
  assert.match(renderedAi, /<th scope="col">Chất<\/th>/);
  assert.match(renderedAi, /class="katex"/);
  assert.match(renderedAi, /ν/);
  assert.match(renderedAi, /<pre><code>const literal = &quot;line\\nnext&quot;;<\/code><\/pre>/);
  assert.doesNotMatch(renderedAi, /\\n\\n\|/);
  assert.doesNotMatch(renderedUser, /<table>/);
  assert.match(renderedUser, /\\n\\n\|/);
});

test('treats raw HTML as text and omits unsafe Markdown links while keeping HTTPS links usable', () => {
  const html = renderArticle(
    'Kiểm tra an toàn',
    '<img src=x onerror=alert(1)> [mở trang lạ](javascript:alert(1)) [nguồn](https://example.com)',
  );

  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img\b/);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /mở trang lạ/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">nguồn<\/a>/);
});

test('does not repeat a document title when the first Markdown heading already matches it', () => {
  const html = renderArticle('Ôn tập tế bào', '# Ôn tập tế bào\n\n## Màng tế bào');

  assert.equal((html.match(/<h2>Ôn tập tế bào<\/h2>/g) ?? []).length, 1);
  assert.match(html, /<h3>Màng tế bào<\/h3>/);
});

test('switches between preview and editing without replacing the original editable Markdown draft', () => {
  const draft = { title: 'Ôn Sinh học', text: '## Tế bào\nMàng tế bào điều hòa trao đổi chất.' };
  const initial = createStudyGuideReviewState();
  const generated = reduceStudyGuideReview(initial, { type: 'generated', draft });
  const editing = reduceStudyGuideReview(generated, { type: 'set-view', view: 'edit' });
  const edited = reduceStudyGuideReview(editing, { type: 'edit-text', text: `${draft.text}\nGhi chú riêng.` });
  const preview = reduceStudyGuideReview(edited, { type: 'set-view', view: 'preview' });

  assert.equal(generated.view, 'preview');
  assert.equal(generated.draft.text, draft.text);
  assert.equal(editing.view, 'edit');
  assert.equal(editing.draft.text, draft.text);
  assert.equal(edited.draft.text, `${draft.text}\nGhi chú riêng.`);
  assert.equal(preview.view, 'preview');
  assert.equal(preview.draft.text, `${draft.text}\nGhi chú riêng.`);
});

test('keeps generated guide confirmation pending across review changes and clears it only on explicit discard', () => {
  const original = { title: 'Ôn Sinh học', text: '## Tế bào\nMàng tế bào điều hòa trao đổi chất.' };
  const replacement = { title: 'Ôn Toán học', text: '## Tích phân\nTính tích phân từng phần.' };
  const initial = createStudyGuideReviewState();
  const generated = reduceStudyGuideReview(initial, { type: 'generated', draft: original });
  const editing = reduceStudyGuideReview(generated, { type: 'set-view', view: 'edit' });
  const edited = reduceStudyGuideReview(editing, { type: 'edit-text', text: `${original.text}\nGhi chú.` });
  const replaced = reduceStudyGuideReview(edited, { type: 'generated', draft: replacement });
  const discarded = reduceStudyGuideReview(replaced, { type: 'discard' });

  assert.equal(hasPendingStudyGuide(initial), false);
  assert.equal(hasPendingStudyGuide(generated), true);
  assert.equal(hasPendingStudyGuide(edited), true);
  assert.equal(edited.draft.text, `${original.text}\nGhi chú.`);
  assert.equal(replaced.draft.title, replacement.title);
  assert.equal(hasPendingStudyGuide(discarded), false);
  assert.equal(discarded.view, 'preview');
});
