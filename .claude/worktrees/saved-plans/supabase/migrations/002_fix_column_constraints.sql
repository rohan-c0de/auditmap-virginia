-- ============================================================
-- Fix column constraints that caused import errors
-- Run via Supabase Dashboard → SQL Editor
-- ============================================================

-- credits: INTEGER can't handle decimal values like 1.5, 2.5
-- Change to NUMERIC(4,1) to support one decimal place
ALTER TABLE courses ALTER COLUMN credits TYPE NUMERIC(4,1) USING credits::NUMERIC(4,1);

-- campus: VARCHAR(200) too short for some NC campus descriptions
ALTER TABLE courses ALTER COLUMN campus TYPE TEXT;

-- crn: VARCHAR(20) too short for some NC data
ALTER TABLE courses ALTER COLUMN crn TYPE TEXT;

-- days: VARCHAR(50) too short for some schedule strings
ALTER TABLE courses ALTER COLUMN days TYPE TEXT;

-- mode: VARCHAR(20) may be too short for some modes
ALTER TABLE courses ALTER COLUMN mode TYPE TEXT;

-- instructor: VARCHAR(200) may be too short
ALTER TABLE courses ALTER COLUMN instructor TYPE TEXT;

-- start_time/end_time: VARCHAR(20) too short for multi-meeting concatenated times
ALTER TABLE courses ALTER COLUMN start_time TYPE TEXT;
ALTER TABLE courses ALTER COLUMN end_time TYPE TEXT;
