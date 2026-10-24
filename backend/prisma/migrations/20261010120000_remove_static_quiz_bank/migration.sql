BEGIN;

-- Keep the original question payload for historical answers before removing
-- the static question rows. AI question answers retain their foreign key.
ALTER TABLE quiz_sessions ADD COLUMN question_snapshot JSONB;

UPDATE quiz_sessions AS answer
SET question_snapshot = jsonb_build_object(
  'id', question.id,
  'topic_id', question.topic_id,
  'question', question.question,
  'options', question.options,
  'correct_index', question.correct_index,
  'explanation', question.explanation,
  'knowledge_point', question.knowledge_point,
  'difficulty', question.difficulty,
  'source', question.source,
  'created_at', to_jsonb(question.created_at)
)
FROM quiz_bank AS question
WHERE answer.question_id = question.id AND question.source = 'static';

ALTER TABLE quiz_sessions ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE quiz_sessions DROP CONSTRAINT quiz_sessions_question_id_fkey;
UPDATE quiz_sessions AS answer
SET question_id = NULL
FROM quiz_bank AS question
WHERE answer.question_id = question.id AND question.source = 'static';

DELETE FROM quiz_bank WHERE source = 'static';
ALTER TABLE quiz_bank RENAME TO ai_questions;
ALTER TABLE ai_questions ALTER COLUMN source SET DEFAULT 'ai_generated';

ALTER TABLE ai_questions RENAME CONSTRAINT quiz_bank_pkey TO ai_questions_pkey;
ALTER TABLE ai_questions RENAME CONSTRAINT quiz_bank_topic_id_fkey TO ai_questions_topic_id_fkey;
ALTER TABLE ai_questions RENAME CONSTRAINT quiz_bank_owner_id_fkey TO ai_questions_owner_id_fkey;
ALTER TABLE ai_questions RENAME CONSTRAINT question_index TO ai_questions_question_index;
ALTER TABLE ai_questions RENAME CONSTRAINT question_options TO ai_questions_question_options;
ALTER TABLE ai_questions RENAME CONSTRAINT question_difficulty TO ai_questions_question_difficulty;
ALTER INDEX quiz_bank_topic_id_difficulty_idx RENAME TO ai_questions_topic_id_difficulty_idx;

ALTER TABLE quiz_sessions
  ADD CONSTRAINT quiz_sessions_question_id_fkey
  FOREIGN KEY (question_id) REFERENCES ai_questions(id) ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
