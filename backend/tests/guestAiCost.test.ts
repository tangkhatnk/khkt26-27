import { expect, it } from "vitest";
import { estimateGuestAiProviderUnits } from "../src/guestAiCost.js";

it("reserves the configured worst-case envelope for each accepted provider workload", () => {
  expect(estimateGuestAiProviderUnits({ task: "document", operation: "read" })).toBe(10_000);
  expect(estimateGuestAiProviderUnits({ task: "document", operation: "summarize" })).toBe(2_000);
  expect(estimateGuestAiProviderUnits({ task: "tutor", operation: "study-guide" })).toBe(4_000);
  expect(estimateGuestAiProviderUnits({ task: "tutor", operation: "study-plan" })).toBe(8_000);
  expect(estimateGuestAiProviderUnits({ task: "question", operation: "quiz" })).toBe(6_000);
  expect(estimateGuestAiProviderUnits({ task: "question", operation: "exercise-generation" })).toBe(12_000);
  expect(estimateGuestAiProviderUnits({ task: "evaluation", operation: "exercise-solutions" })).toBe(8_000);
});

it("does not reserve provider units for provided exercises or deterministic grading", () => {
  expect(estimateGuestAiProviderUnits({ task: "question", operation: "provided-exercises" })).toBe(0);
  expect(estimateGuestAiProviderUnits({ task: "evaluation", operation: "deterministic-grade" })).toBe(0);
});
