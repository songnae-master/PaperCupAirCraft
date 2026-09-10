-- Flying Cup Challenge schema
-- server.js가 시작될 때 자동으로 동일 스키마를 생성합니다.
-- 수동 확인/운영용 참고 파일입니다.

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('student','teacher')),
  login_name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  class_name TEXT NOT NULL DEFAULT '',
  student_no TEXT NOT NULL DEFAULT '',
  team_name TEXT NOT NULL DEFAULT '',
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lock_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  baseline_avg NUMERIC(10,3),
  improved_avg NUMERIC(10,3),
  delta_m NUMERIC(10,3),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_student_time
  ON submissions(student_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS assessments (
  id BIGSERIAL PRIMARY KEY,
  submission_id UUID NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  teacher_id BIGINT NOT NULL REFERENCES users(id),
  concept_level SMALLINT NOT NULL CHECK (concept_level BETWEEN 1 AND 4),
  design_level SMALLINT NOT NULL CHECK (design_level BETWEEN 1 AND 4),
  experiment_level SMALLINT NOT NULL CHECK (experiment_level BETWEEN 1 AND 4),
  analysis_level SMALLINT NOT NULL CHECK (analysis_level BETWEEN 1 AND 4),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
