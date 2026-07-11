/**
 * Daily Google Analytics pull for active GA integrations.
 * Called from .github/workflows/worker-daily.yml at 03:00 UTC.
 */
import 'dotenv/config'
import { pullGoogleAnalytics } from './google-analytics.js'

pullGoogleAnalytics()
  .then(() => process.exit(0))
  .catch(err => { console.error('[ga] FAILED', err); process.exit(1) })
