import type { PrismaClient } from "@prisma/client";
import { generateGeminiQuiz } from "./gemini.js";
import { missing } from "./errors.js";
import type { GenerateQuizInput } from "./geminiSchemas.js";

export async function generateOwnedQuiz(db: PrismaClient, ownerId: string, input: GenerateQuizInput) {
  if (!(await db.topic.findUnique({ where: { id: input.topic } }))) missing("Topic not found");
  const questions = await generateGeminiQuiz(input);
  const rows = await db.$transaction(questions.map(q => db.quizQuestion.create({
    data: {
      topic_id: input.topic, owner_id: ownerId, question: q.question,
      options: q.options, correct_index: q.correctAnswerIndex,
      explanation: q.explanation, knowledge_point: q.knowledgePoint ?? q.question,
      difficulty: "medium", source: "gemini_generated",
    },
  })));
  return rows.map(q => ({
    id: q.id, question: q.question, options: q.options,
    correctAnswerIndex: q.correct_index, explanation: q.explanation,
    knowledgePoint: q.knowledge_point ?? q.question,
  }));
}
