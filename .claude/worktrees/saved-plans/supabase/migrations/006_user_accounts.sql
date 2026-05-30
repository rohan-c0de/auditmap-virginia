-- ============================================================================
-- 006: User Accounts — profiles, saved data tables, triggers
-- ============================================================================
-- Adds user account support via Supabase Auth. The profiles table extends
-- auth.users with app-specific fields. Saved schedules, courses, and transfer
-- comparisons are stored per-user with RLS enforcing user-only access.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profiles table
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  auth_provider TEXT,                -- 'google', 'apple', 'github', etc.
  default_state VARCHAR(2),
  subscriber_id BIGINT REFERENCES subscribers(id) ON DELETE SET NULL,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Service role manage profiles"
  ON profiles FOR ALL
  USING (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. Auto-create profile on user signup
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url, auth_provider)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    ),
    NEW.raw_app_meta_data->>'provider'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Auto-link existing email subscribers on profile creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION link_subscriber_on_signup()
RETURNS TRIGGER AS $$
DECLARE
  user_email TEXT;
  sub_id BIGINT;
BEGIN
  -- Get the user's email from auth.users
  SELECT email INTO user_email FROM auth.users WHERE id = NEW.id;

  -- Find a matching verified subscriber
  SELECT id INTO sub_id
  FROM subscribers
  WHERE email = user_email AND verified = true
  LIMIT 1;

  IF sub_id IS NOT NULL THEN
    UPDATE profiles SET subscriber_id = sub_id WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created_link_subscriber
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION link_subscriber_on_signup();

-- ---------------------------------------------------------------------------
-- 4. Saved Schedules
-- ---------------------------------------------------------------------------

CREATE TABLE saved_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(2) NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Schedule',
  form_data JSONB NOT NULL,
  sections JSONB NOT NULL,
  score INTEGER,
  score_breakdown JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_schedules_user ON saved_schedules(user_id);
CREATE INDEX idx_saved_schedules_user_state ON saved_schedules(user_id, state);

ALTER TABLE saved_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own schedules"
  ON saved_schedules FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 5. Saved Courses (bookmarks)
-- ---------------------------------------------------------------------------

CREATE TABLE saved_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(2) NOT NULL,
  course_prefix VARCHAR(10) NOT NULL,
  course_number VARCHAR(10) NOT NULL,
  course_title TEXT NOT NULL,
  college_code VARCHAR(50),
  crn TEXT,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, state, course_prefix, course_number, college_code, crn)
);

CREATE INDEX idx_saved_courses_user ON saved_courses(user_id);
CREATE INDEX idx_saved_courses_user_state ON saved_courses(user_id, state);

ALTER TABLE saved_courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own courses"
  ON saved_courses FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 6. Saved Transfer Comparisons
-- ---------------------------------------------------------------------------

CREATE TABLE saved_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state VARCHAR(2) NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Comparison',
  selected_courses TEXT[] NOT NULL,
  selected_universities TEXT[] NOT NULL,
  filters JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_saved_transfers_user ON saved_transfers(user_id);

ALTER TABLE saved_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own transfers"
  ON saved_transfers FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
