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

type MathCloseDelimiter = "$" | "$$" | "\\)" | "\\]";

function hasMathCloseBeforeFence(value: string, start: number, delimiter: MathCloseDelimiter) {
  for (let index = start; index < value.length; index += 1) {
    if ((index === 0 || value[index - 1] === "\n") && fenceAtLineStart(value, index)) return false;

    if (delimiter === "$") {
      if (value.startsWith("$$", index)) {
        index += 1;
        continue;
      }
      if (value[index] === "$" && value[index - 1] !== "\\") return true;
    } else if (delimiter === "$$") {
      if (value.startsWith("$$", index) && value[index - 1] !== "\\") return true;
    } else if (value.startsWith(delimiter, index) && value[index - 1] !== "\\") {
      return true;
    }
  }
  return false;
}

/**
 * Decodes Markdown line-break markers emitted as literal backslash-n by an AI
 * provider. The caller must opt in based on provenance; this is not suitable
 * for arbitrary user-authored Markdown. Within fenced code, only decode the
 * separator after the opening fence or immediately before its closing fence.
 * Other escaped separators are ambiguous with code string escapes, so stay
 * literal.
 */
function normalizeStudyGuideText(value: string, repairProviderMathTabEscape: boolean) {
  const output: string[] = [];
  let index = 0;
  let lineStart = true;
  let fence: { marker: "`" | "~"; length: number } | undefined;
  let fenceOpeningLine = false;
  let inlineCode = false;
  let mathDelimiter: "$" | "$$" | "\\)" | "\\]" | undefined;
  let mathRecoveryAllowed = false;

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
          if (mathDelimiter !== undefined) mathRecoveryAllowed = false;
        } else if (isFenceCloseAt(value, index, fence)) {
          fence = undefined;
          fenceOpeningLine = false;
        }
      }
    }

    const arrowCommandEnd = index + 1 + "ightarrow".length;
    if (repairProviderMathTabEscape && !inlineCode && !fence && mathDelimiter !== undefined && mathRecoveryAllowed &&
        value[index] === "\r" && value.startsWith("ightarrow", index + 1) &&
        !/[A-Za-z]/u.test(value[arrowCommandEnd] ?? "")) {
      append("\\rightarrow");
      index = arrowCommandEnd;
      continue;
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
        mathRecoveryAllowed = repairProviderMathTabEscape && hasMathCloseBeforeFence(value, index + 2, mathDelimiter);
        append("\\(");
        index += 2;
        continue;
      }
      if (value.startsWith("\\[", index)) {
        mathDelimiter = "\\]";
        mathRecoveryAllowed = repairProviderMathTabEscape && hasMathCloseBeforeFence(value, index + 2, mathDelimiter);
        append("\\[");
        index += 2;
        continue;
      }
      if (mathDelimiter === "\\)" && value.startsWith("\\)", index)) {
        mathDelimiter = undefined;
        mathRecoveryAllowed = false;
        append("\\)");
        index += 2;
        continue;
      }
      if (mathDelimiter === "\\]" && value.startsWith("\\]", index)) {
        mathDelimiter = undefined;
        mathRecoveryAllowed = false;
        append("\\]");
        index += 2;
        continue;
      }
    }

    const commandEnd = index + 1 + "riangle".length;
    const hasTeXCommandBoundary = !/[A-Za-z]/u.test(value[commandEnd] ?? "");
    if (repairProviderMathTabEscape && !inlineCode && !fence && mathDelimiter !== undefined && mathRecoveryAllowed &&
        value[index] === "\t" && value.startsWith("riangle", index + 1) && hasTeXCommandBoundary) {
      append("\\triangle");
      index += 1 + "riangle".length;
      continue;
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
        mathRecoveryAllowed = mathDelimiter !== undefined && repairProviderMathTabEscape &&
          hasMathCloseBeforeFence(value, index + 2, mathDelimiter);
        append("$$");
        index += 2;
        continue;
      }
      if (value[index] === "$" && value[index - 1] !== "\\" && mathDelimiter !== "$$") {
        mathDelimiter = mathDelimiter === "$" ? undefined : "$";
        mathRecoveryAllowed = mathDelimiter !== undefined && repairProviderMathTabEscape &&
          hasMathCloseBeforeFence(value, index + 1, mathDelimiter);
      }
    }

    append(value[index]);
    index += 1;
  }

  return output.join("");
}

/** Legacy/display normalization; intentionally does not repair formula text. */
export function normalizeStudyGuideAiText(value: string) {
  return normalizeStudyGuideText(value, false);
}

/** Provider-only recovery for a valid JSON `\t` escape in a TeX math expression. */
export function normalizeNewStudyGuideProviderText(value: string) {
  return normalizeStudyGuideText(value, true);
}
