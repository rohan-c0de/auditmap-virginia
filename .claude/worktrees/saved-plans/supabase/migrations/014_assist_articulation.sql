-- Phase 3: ASSIST.org articulation schema for CA community college transfer pathways

-- Parent agreement record (one per CC-receiving-uni-major combo)
CREATE TABLE assist_agreements (
  id BIGSERIAL PRIMARY KEY,
  state VARCHAR(2) NOT NULL,
  cc_id INT NOT NULL,
  cc_name VARCHAR(255) NOT NULL,
  cc_slug VARCHAR(255) NOT NULL,
  receiving_institution_id INT NOT NULL,
  receiving_institution_name VARCHAR(255) NOT NULL,
  receiving_institution_slug VARCHAR(255) NOT NULL,
  major_name VARCHAR(255) NOT NULL,
  major_slug VARCHAR(255) NOT NULL,
  academic_year_id INT,
  agreement_key VARCHAR(512) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT assist_agreements_unique UNIQUE (state, cc_id, receiving_institution_id, major_slug)
);

-- Requirement groups (GE, major core, electives, etc.)
CREATE TABLE assist_requirement_groups (
  id BIGSERIAL PRIMARY KEY,
  agreement_id BIGINT NOT NULL REFERENCES assist_agreements(id) ON DELETE CASCADE,
  group_name VARCHAR(255) NOT NULL,
  group_type VARCHAR(50), -- 'GE', 'MAJOR', 'ELECTIVE', 'OTHER'
  position INT, -- display order
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Individual requirements (Math 1A, CS 101, etc.)
CREATE TABLE assist_requirements (
  id BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES assist_requirement_groups(id) ON DELETE CASCADE,
  receiving_course_prefix VARCHAR(10),
  receiving_course_number VARCHAR(10),
  receiving_course_title VARCHAR(255),
  receiving_course_units VARCHAR(20),
  requirement_label VARCHAR(255),
  position INT,
  no_articulation_reason VARCHAR(500), -- e.g., "Not offered at CA CCs"
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sending courses (CC courses that satisfy receiving requirements)
CREATE TABLE assist_sending_options (
  id BIGSERIAL PRIMARY KEY,
  requirement_id BIGINT NOT NULL REFERENCES assist_requirements(id) ON DELETE CASCADE,
  cc_course_prefix VARCHAR(10) NOT NULL,
  cc_course_number VARCHAR(10) NOT NULL,
  cc_course_title VARCHAR(255),
  cc_course_units VARCHAR(20),
  conjunction VARCHAR(10), -- 'AND' or 'OR'
  position INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_assist_agreements_state ON assist_agreements(state);
CREATE INDEX idx_assist_agreements_cc ON assist_agreements(cc_slug);
CREATE INDEX idx_assist_agreements_receiving ON assist_agreements(receiving_institution_slug);
CREATE INDEX idx_assist_agreements_major ON assist_agreements(major_slug);
CREATE INDEX idx_assist_requirement_groups_agreement ON assist_requirement_groups(agreement_id);
CREATE INDEX idx_assist_requirements_group ON assist_requirements(group_id);
CREATE INDEX idx_assist_sending_options_requirement ON assist_sending_options(requirement_id);

-- RLS policies
ALTER TABLE assist_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_requirement_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE assist_sending_options ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY assist_agreements_select ON assist_agreements FOR SELECT USING (true);
CREATE POLICY assist_requirement_groups_select ON assist_requirement_groups FOR SELECT USING (true);
CREATE POLICY assist_requirements_select ON assist_requirements FOR SELECT USING (true);
CREATE POLICY assist_sending_options_select ON assist_sending_options FOR SELECT USING (true);

-- Service role write/update/delete
CREATE POLICY assist_agreements_write ON assist_agreements FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY assist_agreements_update ON assist_agreements FOR UPDATE USING (auth.role() = 'service_role');
CREATE POLICY assist_agreements_delete ON assist_agreements FOR DELETE USING (auth.role() = 'service_role');

CREATE POLICY assist_requirement_groups_write ON assist_requirement_groups FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY assist_requirement_groups_delete ON assist_requirement_groups FOR DELETE USING (auth.role() = 'service_role');

CREATE POLICY assist_requirements_write ON assist_requirements FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY assist_requirements_delete ON assist_requirements FOR DELETE USING (auth.role() = 'service_role');

CREATE POLICY assist_sending_options_write ON assist_sending_options FOR INSERT WITH CHECK (auth.role() = 'service_role');
CREATE POLICY assist_sending_options_delete ON assist_sending_options FOR DELETE USING (auth.role() = 'service_role');
