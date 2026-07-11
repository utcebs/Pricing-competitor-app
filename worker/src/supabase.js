import { createClient } from '@supabase/supabase-js'

// Use the service_role key (NOT the anon key) so the worker can bypass RLS.
// Service role key is a secret — set as an env var, never commit.
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('[worker] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars')
  process.exit(1)
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})
