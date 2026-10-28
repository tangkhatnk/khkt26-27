CREATE TABLE study_exercise_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  planned_session_id UUID NOT NULL,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('provided', 'generated')),
  requested_count INTEGER CHECK (requested_count IS NULL OR requested_count BETWEEN 1 AND 5),
  status VARCHAR(20) NOT NULL DEFAULT 'preparing'
    CHECK (status IN ('preparing', 'ready', 'failed', 'invalidated')),
  source_text TEXT NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 20000),
  source_fingerprint CHAR(64) NOT NULL CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  exercises JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  solution JSONB,
  generation_token UUID,
  generation_lease_expires_at TIMESTAMP(3),
  solution_generation_token UUID,
  solution_lease_expires_at TIMESTAMP(3),
  bound_at TIMESTAMP(3),
  expires_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX study_exercise_sets_owner_planned_created_idx
  ON study_exercise_sets (user_id, planned_session_id, created_at DESC);
CREATE INDEX study_exercise_sets_expiry_binding_idx
  ON study_exercise_sets (expires_at, bound_at);

CREATE TABLE study_exercise_invalidations (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  planned_session_id UUID NOT NULL,
  request_id UUID NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, planned_session_id, request_id)
);

CREATE INDEX study_exercise_invalidations_expiry_idx
  ON study_exercise_invalidations (expires_at);
