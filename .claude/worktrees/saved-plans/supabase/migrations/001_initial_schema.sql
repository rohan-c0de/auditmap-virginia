-- ============================================================
-- Community College Path — Initial Supabase Schema
-- Run via Supabase Dashboard → SQL Editor, or supabase db push
-- ============================================================

-- -----------------------------------------------------------
-- Subscribers table (email notification signups)
-- -----------------------------------------------------------
CREATE TABLE subscribers (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  state VARCHAR(2) NOT NULL,
  verified BOOLEAN DEFAULT false,
  token UUID NOT NULL DEFAULT gen_random_uuid(),
  preferences JSONB DEFAULT '{"newTerm": true}'::jsonb,
  subscribed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(email, state)
);

CREATE INDEX idx_subscribers_state_verified ON subscribers(state, verified);
CREATE INDEX idx_subscribers_token ON subscribers(token);

-- -----------------------------------------------------------
-- Courses table (course section data from all states)
-- -----------------------------------------------------------
CREATE TABLE courses (
  id BIGSERIAL PRIMARY KEY,
  state VARCHAR(2) NOT NULL,
  college_code VARCHAR(50) NOT NULL,
  term VARCHAR(10) NOT NULL,
  course_prefix VARCHAR(10) NOT NULL,
  course_number VARCHAR(10) NOT NULL,
  course_title TEXT NOT NULL,
  credits NUMERIC(4,1) DEFAULT 0,
  crn TEXT NOT NULL,
  days TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  start_date DATE,
  location TEXT DEFAULT '',
  campus TEXT DEFAULT '',
  mode TEXT DEFAULT 'in-person',
  instructor TEXT,
  seats_open INTEGER,
  seats_total INTEGER,
  prerequisite_text TEXT,
  prerequisite_courses TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_courses_state_term ON courses(state, term);
CREATE INDEX idx_courses_college_term ON courses(college_code, term);
CREATE INDEX idx_courses_prefix_number ON courses(course_prefix, course_number);
CREATE INDEX idx_courses_term ON courses(term);

-- Full-text search on course titles
ALTER TABLE courses ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', course_title)) STORED;
CREATE INDEX idx_courses_fts ON courses USING gin(fts);

-- -----------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------

-- Courses: public read, service-role write
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read courses" ON courses
  FOR SELECT USING (true);
CREATE POLICY "Service write courses" ON courses
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update courses" ON courses
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service delete courses" ON courses
  FOR DELETE USING (auth.role() = 'service_role');

-- Subscribers: service-role only (no public access)
ALTER TABLE subscribers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service read subscribers" ON subscribers
  FOR SELECT USING (auth.role() = 'service_role');
CREATE POLICY "Service write subscribers" ON subscribers
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update subscribers" ON subscribers
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service delete subscribers" ON subscribers
  FOR DELETE USING (auth.role() = 'service_role');
