CREATE TABLE tester_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tester_code VARCHAR(12) NOT NULL,
  topic VARCHAR(100) NOT NULL,
  target_seconds INTEGER NOT NULL CHECK (target_seconds BETWEEN 60 AND 14400),
  elapsed_seconds DOUBLE PRECISION NOT NULL CHECK (elapsed_seconds >= 0 AND elapsed_seconds <= target_seconds),
  focused_seconds DOUBLE PRECISION NOT NULL CHECK (focused_seconds >= 0 AND focused_seconds <= target_seconds + 1),
  distractions INTEGER NOT NULL CHECK (distractions BETWEEN 0 AND 10000),
  completion_percent INTEGER CHECK (completion_percent BETWEEN 0 AND 100),
  completed BOOLEAN NOT NULL,
  recorded_at TIMESTAMP(3) NOT NULL,
  published_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TIMESTAMP(3),
  UNIQUE(user_id, session_id)
);
CREATE INDEX tester_runs_recorded_at_idx ON tester_runs(recorded_at DESC);
