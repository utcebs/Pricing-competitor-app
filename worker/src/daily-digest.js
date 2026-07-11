/**
 * Daily digest — sends pending digest alert emails.
 * Called from .github/workflows/worker-daily.yml at 09:00 UTC.
 */
import 'dotenv/config'
import { sendDigestEmails } from './alerts.js'

sendDigestEmails()
  .then(() => process.exit(0))
  .catch(err => { console.error('[digest] FAILED', err); process.exit(1) })
