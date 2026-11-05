import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import type { GuestAiWorkflowProviders } from "../../src/guestAiWorkflows.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "../../..");
const DEFAULT_CASES = path.join(ROOT, "scripts/evaluation/ai-qa-cases.json");
const FIXED_ANSWERS = [0, 1, 1, 0, 0];
const TIMER_TARGET_SECONDS = 25 * 60;

type QaCase = {
  caseId: string;
  source: string;
  objective: string;
  item: {
    stem: string;
    options: string[];
    answerKeyIndex: number;
    explanation: string;
  };
};

function args(argv: string[]) {
  const result: { cases?: string; output?: string; help?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") { result.help = true; continue; }
    if (arg !== "--cases" && arg !== "--output") throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    result[arg.slice(2) as "cases" | "output"] = path.resolve(value);
    index += 1;
  }
  return result;
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: npm --prefix backend run evaluation:functional [-- --cases FILE] [--output FILE]");
    return;
  }
  const suite = JSON.parse(await readFile(options.cases ?? DEFAULT_CASES, "utf8")) as { cases: QaCase[] };
  const cases = suite.cases.filter(testCase => !testCase.caseId.startsWith("negative-")).slice(0, 5);
  if (cases.length !== 5) throw new Error("The fixed task needs five positive synthetic QA cases.");

  // The route modules validate backend configuration at import time. These local-only values are
  // set solely for the injected mock-provider run; no network client or database is constructed.
  process.env.DATABASE_URL ??= "postgresql://pilot:pilot@127.0.0.1:5432/pilot";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.JWT_SECRET ??= "synthetic-functional-pilot-secret-not-for-deployment";
  const [{ ApiError }, { guestAiRoutes }] = await Promise.all([
    import("../../src/errors.js"),
    import("../../src/guestAi.js"),
  ]);

  const redis = new RedisMock();
  const queryDb = { $queryRaw: async () => [{ session: null, sessionOverride: null }] };
  const db = {
    ...queryDb,
    $transaction: async (callback: (tx: typeof queryDb) => unknown) => callback(queryDb),
  } as unknown as PrismaClient;
  const providerCalls: string[] = [];
  const providers: GuestAiWorkflowProviders = {
    readMaterialDocument: async () => {
      providerCalls.push("document-read");
      return { pages: [{ pageNumber: 1, text: cases.map(row => row.source).join("\n") }], complete: true };
    },
    summarizeMaterialText: async () => {
      providerCalls.push("document-summary");
      return { summary: "Synthetic packet covering measurement, photosynthesis, area, circuits, and a small data example." };
    },
    generateStudyGuide: async () => {
      providerCalls.push("study-guide");
      return { title: "Synthetic review guide", text: "Read each source, state the key idea, then retrieve it without looking." };
    },
    generateGeminiQuiz: async () => {
      providerCalls.push("quiz-generation");
      return cases.map((testCase, index) => ({
        id: `synthetic-${index + 1}`,
        question: testCase.item.stem,
        options: testCase.item.options,
        correctAnswerIndex: testCase.item.answerKeyIndex,
        explanation: testCase.item.explanation,
      }));
    },
    generateStudyExerciseQuestions: async () => [],
    generateStudyExerciseSolutions: async () => ({ exercises: [] }),
  } as unknown as GuestAiWorkflowProviders;

  const app = Fastify({ logger: false });
  app.decorateRequest("userId", "");
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof ApiError ? error.status : error.name === "ZodError" ? 400 : 500;
    return reply.code(status).send({ status, detail: error.message });
  });
  guestAiRoutes(app, db, redis as unknown as Redis, providers);
  await app.ready();
  const steps: Array<{ step: string; status: number }> = [];
  try {
    const credential = await app.inject({ method: "POST", url: "/api/v1/ai/guest/credential", payload: {} });
    steps.push({ step: "consented guest credential", status: credential.statusCode });
    if (credential.statusCode !== 201) throw new Error("Guest credential request failed.");
    const token = (credential.json() as { token: string }).token;
    const headers = { authorization: `GuestAI ${token}` };
    const source = cases.map(row => row.source).join("\n");
    const doc = Buffer.from("%PDF-1.7\nsynthetic task fixture\n").toString("base64");

    const read = await app.inject({ method: "POST", url: "/api/v1/ai/guest/materials/read", headers, payload: { mimeType: "application/pdf", data: doc } });
    steps.push({ step: "document reading", status: read.statusCode });
    const summary = await app.inject({ method: "POST", url: "/api/v1/ai/guest/materials/summarize", headers, payload: { text: source } });
    steps.push({ step: "material review", status: summary.statusCode });
    const guide = await app.inject({ method: "POST", url: "/api/v1/ai/guest/materials/generate", headers, payload: {
      topic: "science", goal: "Recall five stated facts", prompt: "Prepare a brief retrieval plan for the synthetic source packet.",
    } });
    steps.push({ step: "goal and study guide", status: guide.statusCode });

    const sessionId = randomUUID();
    const started = await app.inject({ method: "POST", url: "/api/v1/ai/guest/sessions/start", headers, payload: { id: sessionId, target: 1500 } });
    steps.push({ step: "25-minute focus timer configuration", status: started.statusCode });
    const quiz = await app.inject({ method: "POST", url: "/api/v1/ai/guest/quizzes/generate", headers, payload: {
      plannedSessionId: sessionId, topic: "science", goal: "Recall five stated facts", documentText: source,
      documentAttached: true, count: 5,
    } });
    steps.push({ step: "retrieval quiz", status: quiz.statusCode });
    if (quiz.statusCode !== 201) throw new Error("Guest quiz generation failed.");
    const deck = quiz.json() as { id: string; questions: Array<{ id: string }> };
    const answers = deck.questions.map((question, index) => ({ id: question.id, selected: FIXED_ANSWERS[index]! }));
    const grade = await app.inject({ method: "POST", url: `/api/v1/ai/guest/quizzes/${deck.id}/grade`, headers, payload: { answers } });
    steps.push({ step: "evaluation", status: grade.statusCode });
    if (grade.statusCode !== 200) throw new Error("Guest quiz grade failed.");
    const gradeBody = grade.json() as { score: number; total: number };

    const timerReviewAnswers = cases.map((testCase, index) => ({
      selected: FIXED_ANSWERS[index]!,
      correct: FIXED_ANSWERS[index] === testCase.item.answerKeyIndex,
    }));
    const timerReviewChecks = [
      { step: "set a 25-minute timer", completed: TIMER_TARGET_SECONDS === 1500 },
      { step: "review the same five-item synthetic packet", completed: cases.length === 5 && cases.every(testCase => testCase.source.length > 0) },
      { step: "complete the same fixed answer vector", completed: timerReviewAnswers.length === cases.length && timerReviewAnswers.every(answer => Number.isInteger(answer.selected)) },
    ];
    const timerReviewScore = timerReviewAnswers.filter(answer => answer.correct).length;

    const output = {
      benchmark: "fixed-synthetic-functional-tasks",
      fixtureMode: "synthetic-authored; scripted HTTP injection; provider methods return fixed fixtures",
      providerCalls,
      providerQuality: "not measured; no external provider called",
      viendu: {
        steps,
        completed: steps.every(step => step.status >= 200 && step.status < 300),
        fixedAnswerVector: FIXED_ANSWERS,
        commonAssessment: { score: gradeBody.score, total: gradeBody.total },
        timer: { targetSeconds: 1500, wallClockWaited: false, configuredStartTimestamp: (started.json() as { startedAt: number }).startedAt },
      },
      comparisonHarness: {
        timerPlusOrdinaryReview: {
          implementation: "declared local reference harness; no external timer or review application",
          checks: timerReviewChecks,
          completedTasks: timerReviewChecks.filter(check => check.completed).length,
          errors: timerReviewChecks.filter(check => !check.completed).length,
          commonAssessment: { score: timerReviewScore, total: timerReviewAnswers.length },
          elapsedStudyMinutes: 0,
          note: "Comparator operations derive from the fixed fixture; timer duration is configured, not elapsed; not a full Pomodoro protocol.",
        },
      },
      comparisonLimit: "The timer condition is a declared reference harness, not a second product implementation or user task; results describe this script only.",
    };
    const json = `${JSON.stringify(output, null, 2)}\n`;
    if (options.output) await writeFile(options.output, json, "utf8");
    console.log(json.trimEnd());
    if (!output.viendu.completed || gradeBody.score !== 3 || gradeBody.total !== 5) process.exitCode = 1;
  } finally {
    await app.close();
    redis.disconnect();
  }
}

main().catch(error => {
  console.error(`Functional pilot failed: ${error?.message || error}`);
  process.exitCode = 1;
});
