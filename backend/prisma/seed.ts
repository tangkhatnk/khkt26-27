import { studyTopics } from "../src/adventure/topics.js";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

try {
  for (const topic of studyTopics) {
    await db.topic.upsert({
      where: { id: topic.id },
      create: topic,
      update: topic,
    });
  }
} finally {
  await db.$disconnect();
}
