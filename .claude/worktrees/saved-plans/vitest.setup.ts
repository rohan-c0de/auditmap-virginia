// Provide dummy Supabase env vars before any module imports lib/supabase.ts —
// otherwise createClient() throws at module-load time and tests can't even
// import their subjects. Tests must not actually call Supabase.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-key";
