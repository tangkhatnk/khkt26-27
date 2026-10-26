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
  | { type: "math"; source: string; parts: StudyGuideMathPart[] };

export type StudyGuideBlock =
  | { type: "heading"; level: number; children: StudyGuideInlineNode[] }
  | { type: "paragraph"; children: StudyGuideInlineNode[] }
  | { type: "list"; ordered: boolean; items: StudyGuideInlineNode[][] }
  | { type: "table"; headers: StudyGuideInlineNode[][]; rows: StudyGuideInlineNode[][][] }
  | { type: "quote"; children: StudyGuideInlineNode[] }
  | { type: "code"; text: string }
  | { type: "math-block"; source: string; parts: StudyGuideMathPart[] }
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

function splitExplicitHeadings(line: string, depth = 0): string {
  if (depth >= 8) return line;
  const markers = [...line.matchAll(/#{1,6}\s+\d+[.)]\s+/gu)];
  const sentenceStarts = /(?:^|\s)(Cho|Khi|Nếu|Trong|Tại|Một|Với|Xét|Giả sử|Ta có|Để|Sau đó|Trước hết|Cần|Khi đó|Ví dụ)(?=\s|[,.:;!?])/gu;
  const incompleteTitleEnds = new Set(["và", "của", "với", "trong", "tại", "cho", "đến", "những", "các", "một"]);
  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const markerStart = marker.index ?? 0;
    const titleStart = markerStart + marker[0].length;
    const tailEnd = markers[index + 1]?.index ?? line.length;
    const tail = line.slice(titleStart, tailEnd);
    let boundary: number | undefined;
    for (const candidate of tail.matchAll(sentenceStarts)) {
      const phraseStart = (candidate.index ?? 0) + candidate[0].lastIndexOf(candidate[1]);
      const title = tail.slice(0, phraseStart).trim();
      const titleWords = title.split(/\s+/u).filter(Boolean);
      const lastWord = titleWords.at(-1)?.toLocaleLowerCase("vi");
      if (title.length >= 18 && title.length <= 64 && titleWords.length >= 3 &&
          !incompleteTitleEnds.has(lastWord ?? "") && tail.slice(phraseStart).trim().length >= 12) {
        boundary = phraseStart;
        break;
      }
    }

    // Explicit terminal punctuation is recoverable only when the whole bounded
    // marker segment is a short title; punctuation inside a long definition is not.
    const shortTail = tail.trim();
    if (boundary === undefined && shortTail.length <= 40 && /[?!.:]$/u.test(shortTail)) boundary = shortTail.length;
    if (boundary === undefined || boundary <= 0) continue;

    const title = tail.slice(0, boundary).trimEnd();
    const before = line.slice(0, markerStart).trimEnd();
    const after = line.slice(titleStart + boundary).trimStart();
    return [before, `${marker[0].trimEnd()} ${title}`, ...(after ? [splitExplicitHeadings(after, depth + 1)] : [])]
      .filter(Boolean).join("\n");
  }
  return line;
}

function splitConsecutiveSteps(line: string) {
  const stepPattern = /(?:^|\s)(bước)\s+(\d+)\s*[:.)-]\s+/giu;
  const matches = [...line.matchAll(stepPattern)];
  if (matches.length < 2 || matches.some((match, index) => Number(match[2]) !== index + 1)) return line;
  const starts = matches.map(match => (match.index ?? 0) + match[0].lastIndexOf(match[1]));
  const prefix = line.slice(0, starts[0]).trimEnd();
  const output = prefix ? [prefix] : [];
  for (let index = 0; index < starts.length; index += 1) {
    const end = starts[index + 1] ?? line.length;
    output.push(`${index + 1}. ${line.slice(starts[index], end).trim()}`);
  }
  return output.join("\n");
}

function splitDashItems(line: string) {
  const itemPattern = /(?:^|:\s+|[.!?;]\s+)([-+*])\s+/gu;
  const matches = [...line.matchAll(itemPattern)];
  if (matches.length < 2) return line;
  const starts = matches.map(match => (match.index ?? 0) + match[0].lastIndexOf(match[1]));
  const prefix = line.slice(0, starts[0]).trimEnd();
  if (prefix && !/[:.!?;]$/u.test(prefix)) return line;
  const output = prefix ? [prefix] : [];
  for (let index = 0; index < starts.length; index += 1) {
    const end = starts[index + 1] ?? line.length;
    output.push(line.slice(starts[index], end).trim());
  }
  return output.join("\n");
}

function normalizeCollapsedRow(segment: string) {
  const cells = segment.trim().replace(/^\|/u, "").replace(/\|$/u, "").split("|").map(cell => cell.trim());
  return `| ${cells.join(" | ")} |`;
}

function splitCollapsedTable(line: string) {
  let attempts = 0;
  for (let start = line.indexOf("|"); start >= 0; start = line.indexOf("|", start + 1)) {
    if (attempts >= 16) break;
    attempts += 1;
    const suffix = line.slice(start);
    const segments = suffix.split(/\|{2,}/u);
    if (segments.length < 3) continue;
    const rows = segments.map(normalizeCollapsedRow);
    const headers = rows[0].trim().replace(/^\||\|$/gu, "").split("|");
    if (headers.length < 2 || !/^\s*\|/u.test(rows[0]) || !/^\s*\|/u.test(rows[1]) ||
        !/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/u.test(rows[1])) continue;
    const columnCount = headers.length;
    if (rows.length < 3 || rows.slice(2).some(row => row.trim().replace(/^\||\|$/gu, "").split("|").length !== columnCount)) continue;
    const prefix = line.slice(0, start).trimEnd();
    return `${prefix ? `${prefix}\n` : ""}${rows.join("\n")}`;
  }
  return line;
}

function recoverFlattenedLine(line: string) {
  const protectedSpans: string[] = [];
  const sentinel = Array.from({ length: 16 }, (_, index) => String.fromCharCode(0xe100 + index))
    .find(candidate => !line.includes(candidate));
  if (!sentinel) return line;
  const protectedLine = line.replace(/(`+[^`\n]*`+|\$\$[^$\n]*\$\$|(?<!\\)\$(?!\$)[^$\n]+(?<!\\)\$|\\\([^\n]*?\\\)|\\\[[^\n]*?\\\]|\\ce\s*\{[^}\n]*\})/gu,
    span => `${sentinel}${protectedSpans.push(span) - 1}\uE101`);
  const restore = (value: string) => value.replace(new RegExp(`${sentinel}(\\d+)\\uE101`, "gu"), (_match, index: string) => protectedSpans[Number(index)] ?? _match);
  const headings = splitExplicitHeadings(protectedLine);
  const recovered = headings.split("\n").map(part => splitCollapsedTable(splitDashItems(splitConsecutiveSteps(part)))).join("\n");
  return restore(recovered);
}

/** Repairs only explicit high-confidence Markdown markers for AI display; saved text remains untouched. */
export function normalizeStudyGuideAiTextForDisplay(value: string) {
  const normalized = normalizeStudyGuideAiText(value);
  let fence: { marker: "`" | "~"; length: number } | undefined;
  return normalized.split("\n").map(line => {
    const opening = line.match(/^[\t ]{0,3}(`{3,}|~{3,})/u)?.[1];
    if (fence) {
      const closing = opening && opening[0] === fence.marker && opening.length >= fence.length &&
        /^[\t ]*(?=$)/u.test(line.slice(line.indexOf(opening) + opening.length));
      if (closing) fence = undefined;
      return line;
    }
    if (opening) {
      fence = { marker: opening[0] as "`" | "~", length: opening.length };
      return line;
    }
    return recoverFlattenedLine(line);
  }).join("\n");
}

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
        const mathSource = source.slice(index, end + 1);
        nodes.push({ type: "math", source: mathSource, parts: mathParts(mathSource) });
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
        const mathSource = source.slice(index + 1, end);
        nodes.push({ type: "math", source: mathSource, parts: mathParts(mathSource) });
        index = end + 1;
        continue;
      }
    }

    if (source.startsWith("\\(", index)) {
      const end = source.indexOf("\\)", index + 2);
      if (end > index + 2) {
        const mathSource = source.slice(index + 2, end);
        nodes.push({ type: "math", source: mathSource, parts: mathParts(mathSource) });
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
      const mathSource = content.trim();
      blocks.push({ type: "math-block", source: mathSource, parts: mathParts(mathSource) });
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
