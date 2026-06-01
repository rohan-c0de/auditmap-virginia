-- ============================================================
-- Transfer equivalencies table
-- Run via Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE transfers (
  id BIGSERIAL PRIMARY KEY,
  state VARCHAR(2) NOT NULL,
  cc_prefix VARCHAR(10) NOT NULL,
  cc_number TEXT NOT NULL DEFAULT '',
  cc_course TEXT NOT NULL DEFAULT '',
  cc_title TEXT NOT NULL DEFAULT '',
  cc_credits TEXT DEFAULT '',
  university VARCHAR(50) NOT NULL,
  university_name TEXT NOT NULL DEFAULT '',
  univ_course TEXT DEFAULT '',
  univ_title TEXT DEFAULT '',
  univ_credits TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  no_credit BOOLEAN DEFAULT false,
  is_elective BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_transfers_state ON transfers(state);
CREATE INDEX idx_transfers_state_course ON transfers(state, cc_prefix, cc_number);
CREATE INDEX idx_transfers_state_university ON transfers(state, university);

-- Row Level Security: public read, service-role write
ALTER TABLE transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read transfers" ON transfers
  FOR SELECT USING (true);
CREATE POLICY "Service write transfers" ON transfers
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service update transfers" ON transfers
  FOR UPDATE USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service delete transfers" ON transfers
  FOR DELETE USING (auth.role() = 'service_role');
