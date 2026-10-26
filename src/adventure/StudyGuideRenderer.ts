import { createElement, useId, type ReactNode } from "react";
import katex from "katex";
import "katex/contrib/mhchem";
import { normalizeStudyGuideAiTextForDisplay, parseStudyGuideInline, parseStudyGuideMarkdown, type StudyGuideBlock, type StudyGuideInlineNode, type StudyGuideMathPart } from "./studyGuideMarkdown.ts";
import { isValidStudyGuideIllustrations, type StudyGuideIllustration, type StudyGuideIllustrationSection } from "./studyGuideIllustrations.ts";

function renderMath(source: string, key: string, displayMode: boolean): ReactNode {
  try {
    const html = katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      trust: false,
      maxExpand: 100,
      maxSize: 20,
      output: "htmlAndMathml",
    });
    return createElement(displayMode ? "div" : "span", {
      key,
      className: displayMode
        ? "study-guide__notation study-guide__notation--display"
        : "study-guide__notation",
      role: "math",
      dangerouslySetInnerHTML: { __html: html },
    });
  } catch {
    return createElement(displayMode ? "div" : "code", {
      key,
      className: "study-guide__notation study-guide__notation--error",
      role: "math",
    }, source);
  }
}

function renderInline(nodes: StudyGuideInlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case "text": return node.text;
      case "code": return createElement("code", { key }, node.text);
      case "strong": return createElement("strong", { key }, renderInline(node.children, key));
      case "emphasis": return createElement("em", { key }, renderInline(node.children, key));
      case "link": return createElement("a", { key, href: node.href, target: "_blank", rel: "noopener noreferrer" }, renderInline(node.children, key));
      case "math": return renderMath(node.source, key, false);
    }
  });
}

function renderBlock(block: StudyGuideBlock, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 1, 6)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return createElement(Tag, { key }, renderInline(block.children, key));
    }
    case "paragraph": return createElement("p", { key }, renderInline(block.children, key));
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return createElement(Tag, { key }, block.items.map((item, index) => createElement("li", { key: `${key}-item-${index}` }, renderInline(item, `${key}-item-${index}`))));
    }
    case "table": return createElement("div", { key, className: "study-guide__table-wrap", role: "region", "aria-label": "Bảng ôn tập", tabIndex: 0 },
      createElement("table", null,
        createElement("thead", null, createElement("tr", null, block.headers.map((cell, index) => createElement("th", { key: `${key}-header-${index}`, scope: "col" }, renderInline(cell, `${key}-header-${index}`))))),
        createElement("tbody", null, block.rows.map((row, rowIndex) => createElement("tr", { key: `${key}-row-${rowIndex}` }, row.map((cell, cellIndex) => createElement("td", { key: `${key}-cell-${rowIndex}-${cellIndex}` }, renderInline(cell, `${key}-cell-${rowIndex}-${cellIndex}`))))))));
    case "quote": return createElement("blockquote", { key }, renderInline(block.children, key));
    case "code": return createElement("pre", { key }, createElement("code", null, block.text));
    case "math-block": return renderMath(block.source, key, true);
    case "rule": return createElement("hr", { key });
  }
}

const plotPalette = ["#176b87", "#8b4d9b", "#b45b27"] as const;
const plotBounds = { width: 440, height: 280, left: 54, right: 18, top: 22, bottom: 52 } as const;

function renderSequence(illustration: Extract<StudyGuideIllustration, { kind: "sequence" }>, key: string) {
  return createElement("figure", { key, className: "study-guide__illustration study-guide__illustration--sequence" },
    createElement("figcaption", null,
      createElement("strong", null, illustration.title),
      createElement("p", null, illustration.description)),
    createElement("ol", { role: "list" }, illustration.steps.map((step, index) => createElement("li", { key: `${key}-step-${index}` },
      createElement("span", { className: "study-guide__sequence-number", "aria-hidden": "true" }, String(index + 1).padStart(2, "0")),
      createElement("strong", null, step.label),
      step.detail ? createElement("span", { className: "study-guide__sequence-detail" }, step.detail) : null))),
    createElement("p", { className: "study-guide__illustration-note" }, "Hình minh họa do AI đề xuất; hãy đối chiếu với phần nội dung trước khi sử dụng."));
}

function plotX(value: number, min: number, max: number) {
  return plotBounds.left + (value - min) / (max - min) * (plotBounds.width - plotBounds.left - plotBounds.right);
}

function plotY(value: number, min: number, max: number) {
  return plotBounds.top + (1 - (value - min) / (max - min)) * (plotBounds.height - plotBounds.top - plotBounds.bottom);
}

function formatPlotNumber(value: number) {
  return Number(value.toPrecision(4)).toString();
}

function renderPlot(illustration: Extract<StudyGuideIllustration, { kind: "coordinate-plot" }>, key: string) {
  const xAt = (value: number) => plotX(value, illustration.xAxis.min, illustration.xAxis.max);
  const yAt = (value: number) => plotY(value, illustration.yAxis.min, illustration.yAxis.max);
  const grid = Array.from({ length: 5 }, (_, index) => index / 4);
  const markerLabelX = (value: number) => Math.min(plotBounds.width - plotBounds.right - 12, Math.max(plotBounds.left + 3, xAt(value) + 7));
  const markerLabelY = (value: number) => Math.min(plotBounds.height - plotBounds.bottom - 4, Math.max(plotBounds.top + 12, yAt(value) - 7));
  return createElement("figure", { key, className: "study-guide__illustration study-guide__illustration--plot" },
    createElement("figcaption", null,
      createElement("strong", null, illustration.title),
      createElement("p", null, illustration.description)),
    createElement("div", { className: "study-guide__plot-wrap" },
      createElement("svg", {
        viewBox: `0 0 ${plotBounds.width} ${plotBounds.height}`,
        role: "img",
        "aria-label": illustration.title,
        "aria-describedby": `${key}-description`,
        focusable: "false",
      },
      createElement("title", null, illustration.title),
      createElement("desc", { id: `${key}-description` }, illustration.description),
      ...grid.map((fraction, index) => {
        const x = plotBounds.left + fraction * (plotBounds.width - plotBounds.left - plotBounds.right);
        const y = plotBounds.top + fraction * (plotBounds.height - plotBounds.top - plotBounds.bottom);
        const xValue = illustration.xAxis.min + fraction * (illustration.xAxis.max - illustration.xAxis.min);
        const yValue = illustration.yAxis.max - fraction * (illustration.yAxis.max - illustration.yAxis.min);
        return createElement("g", { key: `${key}-grid-${index}` },
          createElement("line", { x1: x, y1: plotBounds.top, x2: x, y2: plotBounds.height - plotBounds.bottom, className: "study-guide__plot-grid" }),
          createElement("line", { x1: plotBounds.left, y1: y, x2: plotBounds.width - plotBounds.right, y2: y, className: "study-guide__plot-grid" }),
          createElement("text", { x, y: plotBounds.height - plotBounds.bottom + 16, textAnchor: "middle", className: "study-guide__plot-tick" }, formatPlotNumber(xValue)),
          createElement("text", { x: plotBounds.left - 7, y: y + 3, textAnchor: "end", className: "study-guide__plot-tick" }, formatPlotNumber(yValue)));
      }),
      createElement("line", { x1: plotBounds.left, y1: plotBounds.height - plotBounds.bottom, x2: plotBounds.width - plotBounds.right, y2: plotBounds.height - plotBounds.bottom, className: "study-guide__plot-axis" }),
      createElement("line", { x1: plotBounds.left, y1: plotBounds.top, x2: plotBounds.left, y2: plotBounds.height - plotBounds.bottom, className: "study-guide__plot-axis" }),
      ...illustration.series.map((series, seriesIndex) => createElement("polyline", {
        key: `${key}-series-${seriesIndex}`,
        points: series.points.map(([x, y]) => `${xAt(x).toFixed(2)},${yAt(y).toFixed(2)}`).join(" "),
        className: `study-guide__plot-series study-guide__plot-series--${seriesIndex}`,
        stroke: plotPalette[seriesIndex],
      })),
      ...(illustration.markers ?? []).map((marker, markerIndex) => createElement("g", { key: `${key}-marker-${markerIndex}` },
        createElement("circle", { cx: xAt(marker.x), cy: yAt(marker.y), r: 4, className: "study-guide__plot-marker" }),
        createElement("text", { x: markerLabelX(marker.x), y: markerLabelY(marker.y), className: "study-guide__plot-label" }, String(markerIndex + 1)))),
      createElement("text", { x: plotBounds.width / 2, y: plotBounds.height - 10, textAnchor: "middle", className: "study-guide__plot-axis-label" }, "x"),
      createElement("text", { x: plotBounds.left, y: 14, className: "study-guide__plot-axis-label" }, "y"))),
    createElement("div", { className: "study-guide__plot-axis-names" },
      createElement("p", null, createElement("strong", null, "Trục x · "), illustration.xAxis.label, ` (${formatPlotNumber(illustration.xAxis.min)} đến ${formatPlotNumber(illustration.xAxis.max)})`),
      createElement("p", null, createElement("strong", null, "Trục y · "), illustration.yAxis.label, ` (${formatPlotNumber(illustration.yAxis.min)} đến ${formatPlotNumber(illustration.yAxis.max)})`)),
    createElement("ul", { className: "study-guide__diagram-legend", "aria-label": "Chú giải đồ thị" },
      illustration.series.map((series, index) => createElement("li", { key: `${key}-legend-${index}` },
        createElement("span", { className: `study-guide__legend-swatch study-guide__legend-swatch--${index}`, "aria-hidden": "true" }), series.label)),
      ...(illustration.markers ?? []).map((marker, index) => createElement("li", { key: `${key}-marker-legend-${index}` }, createElement("span", { className: "study-guide__plot-marker-number", "aria-hidden": "true" }, String(index + 1)), marker.label))),
    createElement("p", { className: "study-guide__illustration-note" }, "Hình minh họa do AI đề xuất; hãy đối chiếu với phần nội dung trước khi sử dụng."));
}

function renderIllustration(illustration: StudyGuideIllustration, key: string) {
  return illustration.kind === "sequence" ? renderSequence(illustration, key) : renderPlot(illustration, key);
}

function mainSection(block: StudyGuideBlock): { number?: number; text: string } | undefined {
  if (block.type !== "heading" || block.level !== 2) return undefined;
  const text = block.children.map(inlineText).join("").trim();
  const numbered = text.match(/^([1-8])[.)]\s*/u);
  return { ...(numbered ? { number: Number(numbered[1]) } : {}), text: text.replace(/^\d+[.)]\s*/u, "").trim().toLocaleLowerCase("vi") };
}

function illustrationSection(block: StudyGuideBlock): StudyGuideIllustrationSection | undefined {
  const section = mainSection(block);
  if (!section) return undefined;
  if (section.number === 2 || /^(?:lý thuyết|theory)\b/iu.test(section.text)) return "theory";
  if (section.number === 5 || /^(?:ví dụ minh họa|examples)\b/iu.test(section.text)) return "examples";
  return undefined;
}

function renderArticleContent(blocks: StudyGuideBlock[], illustrations: StudyGuideIllustration[], idPrefix: string) {
  const afterBlock = new Map<number, StudyGuideIllustration[]>();
  const fallback: StudyGuideIllustration[] = [];
  for (const illustration of illustrations) {
    const start = blocks.findIndex(block => illustrationSection(block) === illustration.afterSection);
    if (start < 0) {
      fallback.push(illustration);
      continue;
    }
    let end = start;
    for (let index = start + 1; index < blocks.length; index += 1) {
      if (mainSection(blocks[index])) break;
      end = index;
    }
    afterBlock.set(end, [...(afterBlock.get(end) ?? []), illustration]);
  }
  const rendered: ReactNode[] = [];
  blocks.forEach((block, index) => {
    rendered.push(renderBlock(block, `guide-block-${index}`));
    for (const [illustrationIndex, illustration] of (afterBlock.get(index) ?? []).entries())
      rendered.push(renderIllustration(illustration, `${idPrefix}-illustration-${index}-${illustrationIndex}`));
  });
  for (const [index, illustration] of fallback.entries()) rendered.push(renderIllustration(illustration, `${idPrefix}-illustration-fallback-${index}`));
  return rendered;
}

export function StudyGuideInlineText({ text }: { text: string }) {
  return createElement("span", { className: "study-guide__inline-text" }, renderInline(parseStudyGuideInline(text), "study-guide-inline"));
}

export function StudyGuideArticle({ title, text, label = "Bản xem trước", aiGenerated = false, illustrations }: {
  title: string; text: string; label?: string; aiGenerated?: boolean; illustrations?: StudyGuideIllustration[];
}) {
  const idPrefix = useId();
  const displayText = aiGenerated ? normalizeStudyGuideAiTextForDisplay(text) : text;
  const blocks = parseStudyGuideMarkdown(displayText);
  const titleText = title.trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi");
  const firstBlock = blocks[0];
  const firstHeadingText = firstBlock?.type === "heading"
    ? firstBlock.children.map(inlineText).join("").trim().replace(/\s+/gu, " ").toLocaleLowerCase("vi")
    : undefined;
  const content = firstHeadingText === titleText ? blocks.slice(1) : blocks;
  return createElement("article", { className: "study-guide__article", "aria-label": `${label}: ${title}`, tabIndex: 0 },
    createElement("h2", null, title),
      createElement("div", { className: "study-guide__article-body" },
        renderArticleContent(content, aiGenerated && isValidStudyGuideIllustrations(illustrations ?? []) ? illustrations ?? [] : [], idPrefix)));
}

function inlineText(node: StudyGuideInlineNode): string {
  switch (node.type) {
    case "text":
    case "code": return node.text;
    case "strong":
    case "emphasis":
    case "link": return node.children.map(inlineText).join("");
    case "math": return node.parts.map(part => part.type === "labelled-arrow"
      ? `${part.label.map(mathPartText).join("")}${part.symbol}`
      : part.text).join("");
  }
}

function mathPartText(part: StudyGuideMathPart): string {
  return part.type === "labelled-arrow" ? `${part.label.map(mathPartText).join("")}${part.symbol}` : part.text;
}
