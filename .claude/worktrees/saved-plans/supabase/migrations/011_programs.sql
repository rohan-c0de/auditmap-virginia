-- 011_programs.sql
--
-- Adds the `programs` table for storing degree/program requirements scraped
-- from community college catalogs (Acalog, Coursedog). Each row is one
-- program at one college (e.g. "AA in Business Administration at NOVA").
--
-- requirement_groups is JSONB rather than normalized tables — matches the
-- existing pattern for prereqs and prerequisite_courses. Read patterns are
-- always "load all groups for one program" so JSONB is a natural fit.
--
-- Execution: Supabase Dashboard SQL Editor (safe in a single transaction,
-- no CONCURRENTLY needed — table is new).

-- Table
CREATE TABLE IF NOT EXISTS programs (
  id            BIGSERIAL PRIMARY KEY,
  state         VARCHAR(2) NOT NULL,
  college_slug  VARCHAR(50) NOT NULL,
  catalog_year  VARCHAR(20) NOT NULL,
  title         TEXT NOT NULL,
  credential    VARCHAR(20) NOT NULL,
  program_code  TEXT,
  catalog_url   TEXT NOT NULL DEFAULT '',
  total_credits NUMERIC(5,1),
  gpa_minimum   NUMERIC(3,2),
  description   TEXT,
  matched_program_slug VARCHAR(60),
  requirement_groups   JSONB NOT NULL DEFAULT '[]'::jsonb,
  scraped_at    TIMESTAMPTZ DEFAULT now(),
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_programs_state_college
  ON programs(state, college_slug);
CREATE INDEX IF NOT EXISTS idx_programs_state_slug
  ON programs(state, matched_program_slug);
CREATE INDEX IF NOT EXISTS idx_programs_state_credential
  ON programs(state, credential);

-- RLS: public read, service-role write (matches courses/transfers pattern)
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'programs' AND policyname = 'Public read access'
  ) THEN
    CREATE POLICY "Public read access" ON programs FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'programs' AND policyname = 'Service role insert'
  ) THEN
    CREATE POLICY "Service role insert" ON programs FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'programs' AND policyname = 'Service role update'
  ) THEN
    CREATE POLICY "Service role update" ON programs FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'programs' AND policyname = 'Service role delete'
  ) THEN
    CREATE POLICY "Service role delete" ON programs FOR DELETE
      USING (auth.role() = 'service_role');
  END IF;
END $$;
