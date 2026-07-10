import { createClient } from '@supabase/supabase-js'

// TODO: swap these placeholders with the values from
//   Supabase Dashboard → Settings → API
// Both fields are safe to hardcode — the anon key is public by design.
const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co'
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY'

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
