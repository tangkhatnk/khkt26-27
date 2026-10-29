ALTER TABLE study_exercise_sets
  ADD COLUMN requested_counts JSONB;

ALTER TABLE study_exercise_sets
  ADD CONSTRAINT study_exercise_sets_requested_counts_check
  CHECK (
    requested_counts IS NULL OR
    CASE
      WHEN jsonb_typeof(requested_counts) <> 'object' THEN false
      WHEN NOT (requested_counts ?& ARRAY['multipleChoice', 'trueFalse', 'shortAnswer', 'essay']) THEN false
      WHEN requested_counts - ARRAY['multipleChoice', 'trueFalse', 'shortAnswer', 'essay'] <> '{}'::jsonb THEN false
      WHEN (requested_counts->>'multipleChoice') !~ '^(0|[1-5])$' THEN false
      WHEN (requested_counts->>'trueFalse') !~ '^(0|[1-5])$' THEN false
      WHEN (requested_counts->>'shortAnswer') !~ '^(0|[1-5])$' THEN false
      WHEN (requested_counts->>'essay') !~ '^(0|[1-5])$' THEN false
      ELSE (
        (requested_counts->>'multipleChoice')::integer +
        (requested_counts->>'trueFalse')::integer +
        (requested_counts->>'shortAnswer')::integer +
        (requested_counts->>'essay')::integer
      ) BETWEEN 1 AND 20
    END
  );
