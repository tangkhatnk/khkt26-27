/** Internal, conservative capacity units for the largest input/output and bounded retries each route accepts. */
export function estimateGuestAiProviderUnits(input:
  | { task: "document"; operation: "read" | "summarize" }
  | { task: "tutor"; operation: "study-guide" | "study-plan" }
  | { task: "question"; operation: "quiz" | "exercise-generation" | "provided-exercises" }
  | { task: "evaluation"; operation: "exercise-solutions" | "deterministic-grade" },
) {
  switch (input.operation) {
    case "read": return 10_000; // 5 PDF chunks × 2 bounded model attempts.
    case "summarize": return 2_000; // One 50,000-character source and bounded 4,000-character output.
    case "study-guide": return 4_000; // One primary plus one bounded fallback for a 4,000-character prompt.
    case "study-plan": return 8_000; // Up to 50,000 source characters, 8 steps, and one bounded fallback.
    case "quiz": return 6_000; // Up to 30 questions, 50,000 source characters, and one repair/fallback.
    case "exercise-generation": return 12_000; // Up to 20 exercises across four typed batches and one repair/failover.
    case "exercise-solutions": return 8_000; // Up to 20 solutions across four batches and one failover per batch.
    case "provided-exercises":
    case "deterministic-grade": return 0;
  }
}
