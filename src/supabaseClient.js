import { createClient } from '@supabase/supabase-js'

// Both values are from Supabase Dashboard → Settings → API. Safe to
// hardcode — the anon key is public by design and gated by RLS.
const SUPABASE_URL = 'https://hllxetdbnwmunztyfcxa.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsbHhldGRibndtdW56dHlmY3hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3NzI3OTksImV4cCI6MjA5OTM0ODc5OX0.1m-kHvRSJ1px2voOEzxZXOX7_vsSOPzEegpzJzMIwxI'

// Auth-enabled client — use for login, session, and admin writes.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Read-only client with no session persistence. Use for public reads
// so we don't accidentally hold a GoTrue lock while a signed-in
// session is present. Same pattern as the EBS repo (see memory.md §7).
export const supabasePublic = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: 'sb-public-readonly',
  },
})
