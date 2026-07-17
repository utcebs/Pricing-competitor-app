/**
 * Daily digest — sends pending digest alert emails + prunes old data.
 * Called from .github/workflows/worker-daily.yml at 09:00 UTC.
 */
import 'dotenv/config'
import { sendDigestEmails } from './alerts.js'
import { supabase } from './supabase.js'

async function main() {
  // 1. Send pending digest alerts
  await sendDigestEmails().catch(err => {
    console.error('[digest] sendDigestEmails failed', err)
    // Continue with cleanup even if digest fails
  })

  // 2. Prune old data (harmless if the migration hasn't been applied)
  const { data, error } = await supabase.rpc('prune_old_data')
  if (error) {
    console.warn('[prune] skipped — prune_old_data() not found. Run supabase/migrations/data-cleanup.sql.', error.message)
  } else {
    console.log('[prune] done:', data)
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('[daily-digest] FAILED', err); process.exit(1) })
