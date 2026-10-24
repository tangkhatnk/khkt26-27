import { normalizeStudyGuideAiText } from "../../backend/src/studyGuideText.ts";

export type StudyGuideMathPart =
  | { type: "text"; text: string }
  | { type: "subscript" | "superscript"; text: string }
  | { type: "labelled-arrow"; symbol: string; label: StudyGuideMathPart[] };

export type StudyGuideInlineNode =
  | { type: "text"; text: string }
  | { type: "strong" | "emphasis"; children: StudyGuideInlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: StudyGuideInlineNode[] }
  | { type: "math"; parts: StudyGuideMathPart[] };

export type StudyGuideBlock =
  | { type: "heading"; level: number; children: StudyGuideInlineNode[] }
  | { type: "paragraph"; children: StudyGuideInlineNode[] }
  | { type: "list"; ordered: boolean; items: StudyGuideInlineNode[][] }
  | { type: "table"; headers: StudyGuideInlineNode[][]; rows: StudyGuideInlineNode[][][] }
  | { type: "quote"; children: StudyGuideInlineNode[] }
  | { type: "code"; text: string }
  | { type: "math-block"; parts: StudyGuideMathPart[] }
  | { type: "rule" };

function appendText(nodes: StudyGuideInlineNode[], text: string) {
  if (!text) return;
  const last = nodes.at(-1);
  if (last?.type === "text") last.text += text;
  else nodes.push({ type: "text", text });
}

function safeMarkdownHref(value: string) {
  const candidate = value.trim().replace(/^<|>$/g, "");
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

function formatFractionTerm(term: string) {
  const value = term.trim();
  return Array.from(value).length > 1 ? `(${value})` : value;
}

/** Normalizes legacy AI-generated text for display without changing its saved source. */
export const normalizeStudyGuideAiTextForDisplay = normalizeStudyGuideAiText;

function mathParts(source: string): StudyGuideMathPart[] {
  let value = source.trim();
  let chemistry = false;
  const labelledArrows: { symbol: string; label: string }[] = [];
  const chemicalNotation = value.match(/^\\ce\s*\{([\s\S]*)\}$/u);
  if (chemicalNotation) {
    chemistry = true;
    value = chemicalNotation[1];
  }

  value = value.replace(/(?<!\\)\\xrightarrow\s*\{([^{}]*)\}/gu, (_match, label: string) => {
    const index = labelledArrows.push({ symbol: "→", label }) - 1;
    return `\uE000${index}\uE001`;
  });

  value = value
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/gu, (_match, numerator: string, denominator: string) => `${formatFractionTerm(numerator)}⁄${formatFractionTerm(denominator)}`)
    .replace(/\\sqrt\s*\{([^{}]*)\}/gu, "√($1)")
    .replace(/\\text\s*\{([^{}]*)\}/gu, "$1")
    .replace(/\\(?:left|right)\b/gu, "")
    .replace(/\\(?:,|!|;|quad)/gu, " ")
    .replace(/\\([A-Za-z]+)/gu, macro => ({
      "\\to": "→", "\\rightarrow": "→", "\\longrightarrow": "⟶", "\\gets": "←",
      "\\times": "×", "\\cdot": "·", "\\div": "÷", "\\pm": "±",
      "\\neq": "≠", "\\ne": "≠", "\\le": "≤", "\\leq": "≤",
      "\\ge": "≥", "\\geq": "≥", "\\approx": "≈", "\\equiv": "≡",
      "\\infty": "∞", "\\pi": "π", "\\alpha": "α", "\\beta": "β",
      "\\gamma": "γ", "\\Delta": "Δ", "\\delta": "δ", "\\lambda": "λ", "\\nu": "ν",
      "\\mu": "μ", "\\theta": "θ", "\\omega": "ω",
    }[macro] ?? macro))
    .replace(/\\ce\s*\{([^{}]*)\}/gu, (_match, formula: string) => formula.replace(/([A-Z][a-z]?|\))(\d+)/gu, "$1_{$2}"));

  if (chemistry) value = value.replace(/([A-Z][a-z]?|\))(\d+)/gu, "$1_{$2}");

  const parts: StudyGuideMathPart[] = [];
  let text = "";
  const flush = () => {
    if (text) parts.push({ type: "text", text });
    text = "";
  };
  for (let index = 0; index < value.length; index += 1) {
    const marker = value[index];
    if (marker === "\uE000") {
      const closing = value.indexOf("\uE001", index + 1);
      const arrowIndex = Number(value.slice(index + 1, closing));
      const arrow = labelledArrows[arrowIndex];
      if (closing > index && arrow) {
        flush();
        parts.push({ type: "labelled-arrow", symbol: arrow.symbol, label: mathParts(arrow.label) });
        index = closing;
        continue;
      }
    }
    if ((marker === "_" || marker === "^") && index + 1 < value.length) {
      flush();
      let notation = "";
      if (value[index + 1] === "{") {
        const closing = value.indexOf("}", index + 2);
        if (closing > index + 2) {
          notation = value.slice(index + 2, closing);
          index = closing;
        }
      }
      if (!notation) {
        const next = index + 1;
        if (next < value.length) {
          notation = value[next];
          index = next;
        }
      }
      if (notation) parts.push({ type: marker === "_" ? "subscript" : "superscript", text: notation });
      else text += marker;
    } else text += marker;
  }
  flush();
  return parts.length ? parts : [{ type: "text", text: value }];
}

function findClosing(source: string, marker: string, start: number) {
  const end = source.indexOf(marker, start);
  return end > start ? end : -1;
}

function parseInline(source: string, depth = 0): StudyGuideInlineNode[] {
  if (depth > 8) return [{ type: "text", text: source }];
  const nodes: StudyGuideInlineNode[] = [];
  for (let index = 0; index < source.length;) {
    if (source.startsWith("\\ce{", index)) {
      const end = source.indexOf("}", index + 4);
      if (end > index + 4) {
        nodes.push({ type: "math", parts: mathParts(source.slice(index, end + 1)) });
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "`" && source[index + 1] !== "`") {
      const end = findClosing(source, "`", index + 1);
      if (end > index) {
        nodes.push({ type: "code", text: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }

    const boldMarker = source.startsWith("**", index) ? "**" : source.startsWith("__", index) ? "__" : undefined;
    if (boldMarker) {
      const end = findClosing(source, boldMarker, index + 2);
      if (end > index) {
        nodes.push({ type: "strong", children: parseInline(source.slice(index + 2, end), depth + 1) });
        index = end + 2;
        continue;
      }
    }

    if (source[index] === "*" && source[index + 1] !== "*") {
      const end = findClosing(source, "*", index + 1);
      if (end > index) {
        nodes.push({ type: "emphasis", children: parseInline(source.slice(index + 1, end), depth + 1) });
        index = end + 1;
        continue;
      }
    }

    if (source[index] === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      const linkEnd = labelEnd > index ? source.indexOf(")", labelEnd + 2) : -1;
      if (labelEnd > index && linkEnd > labelEnd) {
        const children = parseInline(source.slice(index + 1, labelEnd), depth + 1);
        const href = safeMarkdownHref(source.slice(labelEnd + 2, linkEnd).split(/\s+/u)[0]);
        if (href) nodes.push({ type: "link", href, children });
        else nodes.push(...children);
        index = linkEnd + 1;
        continue;
      }
    }

    if (source[index] === "$" && source[index + 1] !== "$" && source[index - 1] !== "\\") {
      const end = findClosing(source, "$", index + 1);
      if (end > index && source[end + 1] !== "$") {
        nodes.push({ type: "math", parts: mathParts(source.slice(index + 1, end)) });
        index = end + 1;
        continue;
      }
    }

    if (source.startsWith("\\(", index)) {
      const end = source.indexOf("\\)", index + 2);
      if (end > index + 2) {
        nodes.push({ type: "math", parts: mathParts(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    appendText(nodes, source[index]);
    index += 1;
  }
  return nodes;
}

export function parseStudyGuideInline(source: string) {
  return parseInline(source);
}

function isTableDelimiter(line: string) {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(line);
}

function tableCells(line: string) {
  return line.trim().replace(/^\||\|$/gu, "").split("|").map(cell => cell.trim().replace(/\\\|/gu, "|"));
}

function isListItem(line: string) {
  return /^\s*(?:[-+*]\s+|\d+[.)]\s+)/u.test(line);
}

function isBlockStart(lines: string[], index: number) {
  const line = lines[index];
  return /^\s*#{1,6}\s+/u.test(line) || /^\s*```/u.test(line) || /^\s*>/u.test(line) ||
    isListItem(line) || /^\s*(?:\$\$|\\\[)/u.test(line) ||
    /^\s*(?:---+|\*\s*\*\s*\*|___+)\s*$/u.test(line) ||
    (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1]));
}

export function parseStudyGuideMarkdown(markdown: string): StudyGuideBlock[] {
  const lines = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const blocks: StudyGuideBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    if (/^\s*```/u.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/u.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (/^\s*(?:\$\$|\\\[)/u.test(line)) {
      const opening = line.match(/^\s*(\$\$|\\\[)\s*(.*)$/u);
      const closer = opening?.[1] === "$$" ? "$$" : "\\]";
      let content = opening?.[2] ?? line;
      const closeAt = content.indexOf(closer);
      if (closeAt >= 0) content = content.slice(0, closeAt);
      else {
        const mathLines = [content];
        index += 1;
        while (index < lines.length && !lines[index].includes(closer)) mathLines.push(lines[index++]);
        if (index < lines.length) {
          const last = lines[index].slice(0, lines[index].indexOf(closer));
          mathLines.push(last);
        }
        content = mathLines.join(" ");
      }
      blocks.push({ type: "math-block", parts: mathParts(content.trim()) });
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1])) {
      const headers = tableCells(line).map(cell => parseInline(cell));
      const rows: StudyGuideInlineNode[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(tableCells(lines[index]).map(cell => parseInline(cell)));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    if (isListItem(line)) {
      const ordered = /^\s*\d+[.)]\s+/u.test(line);
      const items: StudyGuideInlineNode[][] = [];
      while (index < lines.length && isListItem(lines[index]) && /^\s*\d+[.)]\s+/u.test(lines[index]) === ordered) {
        items.push(parseInline(lines[index].replace(/^\s*(?:[-+*]\s+|\d+[.)]\s+)/u, "")));
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    if (/^\s*>/u.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/u.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/u, ""));
      blocks.push({ type: "quote", children: parseInline(quote.join(" ")) });
      continue;
    }

    if (/^\s*(?:---+|\*\s*\*\s*\*|___+)\s*$/u.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}
