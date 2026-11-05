#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geminiQuestionSchema } from "../../backend/src/geminiSchemas.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CASES = path.join(SCRIPT_DIR, "ai-qa-cases.json");

function parseArgs(argv: string[]) {
  const result: { cases?: string; output?: string; help?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (argument !== "--cases" && argument !== "--output") throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    result[argument.slice(2) as "cases" | "output"] = path.resolve(value);
    index += 1;
  }
  return result;
}

function normalize(value: string) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: npm --prefix backend run evaluation:qa [-- --cases FILE] [--output FILE]");
    return;
  }
  const suite = JSON.parse(await readFile(args.cases ?? DEFAULT_CASES, "utf8")) as {
    suiteId: string;
    fixtureMode: string;
    cases: Array<{
      caseId: string;
      taskFamily: string;
      locale: string;
      source?: unknown;
      item?: {
        stem?: unknown;
        question?: unknown;
        options?: unknown;
        answerKeyIndex?: unknown;
        correctAnswerIndex?: unknown;
        explanation?: unknown;
        evidenceExcerpt?: unknown;
        sourceExcerpt?: unknown;
      };
      expectedAutomated?: { structure: "pass" | "fail"; evidenceSpan: "pass" | "fail" };
    }>;
  };
  if (!Array.isArray(suite.cases) || suite.cases.length === 0) throw new Error("QA suite must contain cases.");
  if (new Set(suite.cases.map(row => row.caseId)).size !== suite.cases.length)
    throw new Error("QA case identifiers must be unique.");

  const rows = suite.cases.map(testCase => {
    const item = testCase.item ?? {};
    const evidenceExcerpt = typeof item.evidenceExcerpt === "string"
      ? item.evidenceExcerpt
      : typeof item.sourceExcerpt === "string" ? item.sourceExcerpt : "";
    const schemaResult = geminiQuestionSchema.safeParse({
      id: testCase.caseId,
      question: item.question ?? item.stem,
      options: item.options,
      correctAnswerIndex: item.correctAnswerIndex ?? item.answerKeyIndex,
      explanation: item.explanation,
      sourceExcerpt: evidenceExcerpt || undefined,
    });
    const structure = schemaResult.success ? "pass" : "fail";
    const evidence = normalize(evidenceExcerpt);
    const source = typeof testCase.source === "string" ? testCase.source : "";
    const evidenceSpan = evidence && normalize(source).includes(evidence) ? "pass" : "fail";
    return {
      caseId: testCase.caseId,
      taskFamily: testCase.taskFamily,
      locale: testCase.locale,
      structure,
      evidenceSpan,
      expectedControlMatch: testCase.expectedAutomated
        ? structure === testCase.expectedAutomated.structure && evidenceSpan === testCase.expectedAutomated.evidenceSpan
        : null,
    };
  });
  const counts = (dimension: "structure" | "evidenceSpan") => ({
    pass: rows.filter(row => row[dimension] === "pass").length,
    fail: rows.filter(row => row[dimension] === "fail").length,
  });
  const output = {
    suiteId: suite.suiteId,
    fixtureMode: suite.fixtureMode,
    appSchema: "backend/src/geminiSchemas.ts:geminiQuestionSchema",
    cases: rows.length,
    automatedDimensions: {
      schemaShape: counts("structure"),
      literalEvidenceSpan: counts("evidenceSpan"),
      controlsMatched: rows.filter(row => row.expectedControlMatch === true).length,
      controlsDefined: rows.filter(row => row.expectedControlMatch !== null).length,
    },
    notAutomated: ["semantic evidence support", "answer-key correctness", "distractor plausibility", "clarity or grade suitability", "learning effect"],
    provider: { called: false, model: null, version: null, latencyMs: null, cost: null },
    humanReview: { status: "not-rated", scores: null },
    rows,
  };
  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) await writeFile(args.output, json, "utf8");
  console.log(json.trimEnd());
  if (rows.some(row => row.expectedControlMatch === false)) process.exitCode = 1;
}

main().catch(error => {
  console.error(`AI QA evaluation failed: ${error?.message || error}`);
  process.exitCode = 1;
});
