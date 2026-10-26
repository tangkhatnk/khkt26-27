import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudyGuideArticle, StudyGuideInlineText } from '../src/adventure/StudyGuideRenderer.ts';
import { createStudyGuideReviewState, hasPendingStudyGuide, reduceStudyGuideReview } from '../src/adventure/studyGuideReview.ts';

const studyGuideStyles = readFileSync(new URL('../src/adventure/studyGuide.css', import.meta.url), 'utf8');

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

test('repairs flattened AI headings, lists, tables, and worked steps for display only', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const source = [
    '## 2. Lý thuyết',
    "Đạo hàm là một trong những khái niệm nền tảng của giải tích toán học. Để học tốt, ta sẽ đi qua các bước từ định nghĩa đến ứng dụng chuyên sâu. ### 1. Định nghĩa và ý nghĩa đạo hàm Cho hàm số $y=f(x)$ xác định trên khoảng mở chứa $x_0$. Đạo hàm của hàm số tại điểm $x_0$ là giới hạn hữu hạn (nếu có).",
    "Quy tắc tính: - Đạo hàm hàm hằng: $(C)' = 0$. - Đạo hàm hàm lũy thừa: $(x^n)' = nx^{n-1}$.",
    '',
    '## 4. So sánh',
    "Khi học giải tích, ta thường phân biệt rõ hai khái niệm có liên quan mật thiết nhưng khác bản chất là Đạo hàm và Vi phân. | Tiêu chí | Đạo hàm | Vi phân |||---|---|---|| Ký hiệu | $f'(x)$ hoặc $dy/dx$ | $dy = f'(x)dx$ || Bản chất | Đại lượng vô hướng (tốc độ thay đổi tức thời) | Đại lượng tuyến tính xấp xỉ số gia của hàm số || Vai trò | Xác định tính đồng biến, nghịch biến, cực trị | Ước lượng sai số, tính toán gần đúng |",
    '',
    '## 5. Ví dụ minh họa',
    'Xét bài toán tìm phương trình tiếp tuyến của đồ thị hàm số tại một điểm. Các bước giải chi tiết như sau: Bước 1: Tính giá trị tung độ của tiếp điểm. Thay điểm vào hàm số để tìm tung độ. Bước 2: Tính đạo hàm của hàm số để tìm hệ số góc. Bước 3: Thay hoành độ vào đạo hàm để tìm hệ số góc tiếp tuyến. Bước 4: Viết phương trình tiếp tuyến theo công thức.',
    '',
    `Inline ${String.fromCharCode(96)}### 8. literal - item | --- |${String.fromCharCode(96)} and $x_{n-1}$ stay inline.`,
    `${fence}txt`,
    '### 9. literal - item | --- |',
    fence,
  ].join('\n');
  const aiHtml = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Đạo hàm', text: source, aiGenerated: true,
  }));
  const userHtml = renderArticle('Đạo hàm', source);

  assert.match(aiHtml, /<h4>1\. Định nghĩa và ý nghĩa đạo hàm<\/h4>/u);
  assert.match(aiHtml, /<p>Cho hàm số/u);
  assert.match(aiHtml, /<ul><li>Đạo hàm hàm hằng:/u);
  assert.match(aiHtml, /<table>/u);
  assert.match(aiHtml, /<th scope="col">Tiêu chí<\/th>/u);
  assert.match(aiHtml, /<ol><li>Bước 1: Tính giá trị tung độ/u);
  assert.match(aiHtml, /<code>### 8\. literal - item \| --- \|<\/code>/u);
  assert.match(aiHtml, /<pre><code>### 9\. literal - item \| --- \|<\/code><\/pre>/u);
  assert.match(aiHtml, /class="katex"/u);
  assert.doesNotMatch(userHtml, /<h4>1\. Định nghĩa|<ul>|<table>|<ol>/u);
  assert.match(source, /### 1\. Định nghĩa và ý nghĩa đạo hàm Cho hàm số/u);
  assert.match(source, /\| Tiêu chí \| Đạo hàm \| Vi phân \|\|\|---/u);
  const ambiguousTitle = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Đạo hàm', text: '## 2. Lý thuyết\nÝ nghĩa được trình bày như sau. ### 1. Ý nghĩa đạo hàm Đạo hàm mô tả tốc độ thay đổi của hàm số.', aiGenerated: true,
  }));
  assert.doesNotMatch(ambiguousTitle, /<h4>1\. Ý nghĩa đạo hàm/u);
  assert.match(ambiguousTitle, /### 1\. Ý nghĩa đạo hàm Đạo hàm mô tả/u);
});

test('repairs lowercase and mixed-case flattened step labels without changing source text or ordinary prose', () => {
  const source = '## 5. Ví dụ minh họa\nGiải lần lượt: bước 1: tính giá trị. bƯớC 2: thay vào công thức.\nTrong phần mô tả, từ bước này chỉ là lời văn; không phải nhãn bước 1.';
  const original = source;
  const html = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Ôn tập', text: source, aiGenerated: true,
  }));

  assert.match(html, /<p>Giải lần lượt:<\/p><ol><li>bước 1: tính giá trị\.<\/li><li>bƯớC 2: thay vào công thức\.<\/li><\/ol>/u);
  assert.match(html, /Trong phần mô tả, từ bước này chỉ là lời văn; không phải nhãn bước 1\./u);
  assert.equal(source, original);
});

test('renders typed study-guide illustrations as accessible app-owned primitives', () => {
  const illustrations = [
    {
      kind: 'coordinate-plot', afterSection: 'theory', title: 'Đạo hàm tại một điểm',
      description: 'Đường tiếp tuyến biểu diễn tốc độ thay đổi tại điểm được chọn.',
      xAxis: { label: 'Thời gian phản ứng khi điều chỉnh nồng độ dung dịch', min: -2, max: 2 },
      yAxis: { label: 'Số lượng sản phẩm tạo thành sau thời điểm quan sát', min: -2, max: 3 },
      series: [{ label: 'Quá trình tạo sản phẩm theo điều kiện thay đổi', points: [[-2, 2], [-1, -1], [0, 0], [1, 1], [2, 2]] }],
      markers: [{ x: 1, y: 1, label: 'Thời điểm phản ứng đạt trạng thái cân bằng đã được ước tính' }],
    },
    {
      kind: 'sequence', afterSection: 'examples', title: 'Các bước giải',
      description: 'Thực hiện theo thứ tự.',
      steps: [{ label: 'Tính giá trị', detail: 'Thay hoành độ vào hàm số.' }, { label: 'Tính hệ số góc' }],
    },
  ];
  const html = renderToStaticMarkup(createElement(StudyGuideArticle, {
    title: 'Đạo hàm', text: '## 2. Lý thuyết\nĐạo hàm mô tả tốc độ thay đổi.\n\n## 5. Ví dụ minh họa\nTìm tiếp tuyến.', aiGenerated: true, illustrations,
  }));

  assert.match(html, /<figure class="study-guide__illustration study-guide__illustration--plot">/u);
  assert.match(html, /<svg[^>]+role="img"[^>]+aria-label="Đạo hàm tại một điểm/u);
  assert.match(html, /<polyline/u);
  assert.match(html, /class="study-guide__diagram-legend"/u);
  assert.match(html, /Thời gian phản ứng khi điều chỉnh nồng độ dung dịch/u);
  assert.match(html, /Số lượng sản phẩm tạo thành sau thời điểm quan sát/u);
  assert.match(html, /Quá trình tạo sản phẩm theo điều kiện thay đổi/u);
  assert.match(html, /Thời điểm phản ứng đạt trạng thái cân bằng đã được ước tính/u);
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + '</svg>'.length);
  assert.doesNotMatch(svg, /Thời gian phản ứng|Số lượng sản phẩm|Quá trình tạo sản phẩm|Thời điểm phản ứng đạt trạng thái/u);
  assert.match(svg, /class="study-guide__plot-label">1<\/text>/u);
  assert.match(html, /<figure class="study-guide__illustration study-guide__illustration--sequence">/u);
  assert.match(html, /<ol role="list"><li><span class="study-guide__sequence-number" aria-hidden="true">01<\/span><strong>Tính giá trị<\/strong>/u);
  assert.doesNotMatch(html, /<script\b|<img\b|<path\b/u);
  const repeated = renderToStaticMarkup(createElement('div', null,
    createElement(StudyGuideArticle, { title: 'Đạo hàm', text: 'Nội dung.', aiGenerated: true, illustrations: [illustrations[0]] }),
    createElement(StudyGuideArticle, { title: 'Đạo hàm', text: 'Nội dung.', aiGenerated: true, illustrations: [illustrations[0]] })));
  const descriptionIds = [...repeated.matchAll(/<desc id="([^"]+)"/gu)].map(match => match[1]);
  assert.equal(descriptionIds.length, 2);
  assert.equal(new Set(descriptionIds).size, 2);
});

test('gives each plot series a distinct dark-theme stroke and legend color', () => {
  const palette = ['#6bc4df', '#d39be0', '#f0a978'];

  palette.forEach((color, index) => {
    assert.ok(studyGuideStyles.includes(`html[data-theme="dark"] .adventure .study-guide__plot-series--${index} { stroke: ${color}; }`));
    assert.ok(studyGuideStyles.includes(`html[data-theme="dark"] .adventure .study-guide__legend-swatch--${index} { background: ${color}; }`));
  });
  const mobileStyles = studyGuideStyles.split('@media (max-width: 600px)')[1];
  assert.match(mobileStyles, /\.adventure \.study-guide__plot-label, \.adventure \.study-guide__plot-axis-label, \.adventure \.study-guide__plot-tick \{ font-size: 16px; \}/u);
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

test('clears generated illustrations as soon as the draft Markdown changes', () => {
  const draft = {
    title: 'Ôn Toán', text: '## 2. Lý thuyết\nĐạo hàm là tốc độ thay đổi.',
    illustrations: [{ kind: 'sequence', afterSection: 'theory', title: 'Các bước', description: 'Theo thứ tự.', steps: [{ label: 'Một' }, { label: 'Hai' }] }],
  };
  const generated = reduceStudyGuideReview(createStudyGuideReviewState(), { type: 'generated', draft });
  const edited = reduceStudyGuideReview(generated, { type: 'edit-text', text: `${draft.text}\nGhi chú.` });

  assert.equal(generated.draft.illustrations, draft.illustrations);
  assert.equal(edited.draft.text, `${draft.text}\nGhi chú.`);
  assert.equal(edited.draft.illustrations, undefined);
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
