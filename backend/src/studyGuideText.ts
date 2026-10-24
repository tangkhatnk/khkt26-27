const escapedNewlineMathCommands = new Set([
  "nabla", "natural", "ne", "neq", "nexists", "ngtr", "nless", "nmid",
  "nparallel", "nrightarrow", "nleftarrow", "nleftrightarrow", "nsim", "not",
  "notin", "nu", "nvdash", "nvDash",
]);

function fenceAtLineStart(value: string, index: number) {
  return value.slice(index).match(/^[\t ]{0,3}(`{3,}|~{3,})/u)?.[1];
}

function isFenceCloseAt(value: string, index: number, fence: { marker: "`" | "~"; length: number }) {
  const match = fenceAtLineStart(value, index);
  if (!match || match[0] !== fence.marker || match.length < fence.length) return false;
  return /^[\t ]*(?=$|\r?\n|\\n)/u.test(value.slice(index + match.length));
}

/**
 * Decodes Markdown line-break markers emitted as literal backslash-n by an AI
 * provider. The caller must opt in based on provenance; this is not suitable
 * for arbitrary user-authored Markdown. Within fenced code, only decode the
 * separator after the opening fence or immediately before its closing fence.
 * Other escaped separators are ambiguous with code string escapes, so stay
 * literal.
 */
export function normalizeStudyGuideAiText(value: string) {
  const output: string[] = [];
  let index = 0;
  let lineStart = true;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let fenceOpeningLine = false;
  let inlineCode = false;
  let mathDelimiter: "$" | "$$" | "\\)" | "\\]" | undefined;

  const append = (text: string) => {
    output.push(text);
    for (const character of text) {
      if (character === "\n") lineStart = true;
      else if (lineStart && character !== " " && character !== "\t") lineStart = false;
      if (character === "\n" && fenceOpeningLine) fenceOpeningLine = false;
    }
  };

  while (index < value.length) {
    if (lineStart) {
      const fenceMarker = fenceAtLineStart(value, index);
      if (fenceMarker) {
        if (!fence) {
          fence = { marker: fenceMarker[0] as "`" | "~", length: fenceMarker.length };
          fenceOpeningLine = true;
        } else if (isFenceCloseAt(value, index, fence)) {
          fence = undefined;
          fenceOpeningLine = false;
        }
      }
    }

    if (value[index] === "\r" || value[index] === "\n") {
      if (value[index] === "\r" && value[index + 1] === "\n") index += 1;
      append("\n");
      index += 1;
      continue;
    }

    if (!inlineCode && !fence) {
      if (value.startsWith("\\(", index)) {
        mathDelimiter = "\\)";
        append("\\(");
        index += 2;
        continue;
      }
      if (value.startsWith("\\[", index)) {
        mathDelimiter = "\\]";
        append("\\[");
        index += 2;
        continue;
      }
      if (mathDelimiter === "\\)" && value.startsWith("\\)", index)) {
        mathDelimiter = undefined;
        append("\\)");
        index += 2;
        continue;
      }
      if (mathDelimiter === "\\]" && value.startsWith("\\]", index)) {
        mathDelimiter = undefined;
        append("\\]");
        index += 2;
        continue;
      }
    }

    if (value[index] === "\\") {
      let slashEnd = index;
      while (value[slashEnd] === "\\") slashEnd += 1;
      const slashCount = slashEnd - index;
      if (slashCount === 1 && value[slashEnd] === "n") {
        const beforeClosingFence = fence !== undefined && isFenceCloseAt(value, slashEnd + 1, fence);
        if (fence !== undefined) {
          append(fenceOpeningLine || beforeClosingFence ? "\n" : "\\n");
        } else {
          const command = value.slice(index).match(/^\\([A-Za-z]+)/u)?.[1];
          const isTexCommand = command?.startsWith("n") &&
            (mathDelimiter !== undefined || escapedNewlineMathCommands.has(command));
          if (isTexCommand || inlineCode) append("\\n");
          else append("\n");
        }
        index = slashEnd + 1;
        continue;
      }
      append(value.slice(index, slashEnd));
      index = slashEnd;
      continue;
    }

    if (value[index] === "`" && !fence && !mathDelimiter && value[index + 1] !== "`") {
      inlineCode = !inlineCode;
      append(value[index]);
      index += 1;
      continue;
    }

    if (!inlineCode && !fence) {
      if (value.startsWith("$$", index)) {
        mathDelimiter = mathDelimiter === "$$" ? undefined : "$$";
        append("$$");
        index += 2;
        continue;
      }
      if (value[index] === "$" && value[index - 1] !== "\\" && mathDelimiter !== "$$")
        mathDelimiter = mathDelimiter === "$" ? undefined : "$";
    }

    append(value[index]);
    index += 1;
  }

  return output.join("");
}
