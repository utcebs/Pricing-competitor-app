import { supabase } from './supabase.js'

/**
 * pullGoogleAnalytics — for each active Google Analytics integration,
 * fetch yesterday's core metrics via the Analytics Data API v1.
 *
 * Uses the service account JSON stored in integrations.config.serviceAccountJson.
 * We call the REST endpoint directly (no npm SDK needed) so the worker
 * stays lean.
 *
 * Metrics fetched:
 *   - sessions
 *   - screenPageViews
 *   - transactions
 *   - purchaseRevenue
 *
 * Results are written to integration_sync_log with operation='pull_analytics'
 * so they can be surfaced on the Integrations page and any custom report.
 */

// Cache access tokens in-process to avoid re-auth on every call
const tokenCache = new Map()

export async function pullGoogleAnalytics() {
  const { data: integrations } = await supabase.from('integrations')
    .select('*').eq('kind', 'google_analytics').eq('is_active', true)
  if (!integrations?.length) return

  for (const integration of integrations) {
    const cfg = integration.config || {}
    const { propertyId, serviceAccountJson } = cfg
    if (!propertyId || !serviceAccountJson) {
      console.log(`[GA] Skipping ${integration.name} — missing config`)
      continue
    }

    const t0 = Date.now()
    const { data: logRow } = await supabase.from('integration_sync_log').insert({
      integration_id: integration.id,
      operation: 'pull_analytics',
      status: 'running',
    }).select().single()

    try {
      const parsed = typeof serviceAccountJson === 'string'
        ? JSON.parse(serviceAccountJson)
        : serviceAccountJson
      const token = await getAccessToken(parsed)
      const result = await fetchYesterdayReport(propertyId, token)

      await supabase.from('integration_sync_log').update({
        status: 'ok',
        response_payload: result,
        duration_ms: Date.now() - t0,
      }).eq('id', logRow.id)

      await supabase.from('integrations')
        .update({ last_sync_at: new Date().toISOString() })
        .eq('id', integration.id)
    } catch (e) {
      await supabase.from('integration_sync_log').update({
        status: 'failed',
        error_message: e.message,
        duration_ms: Date.now() - t0,
      }).eq('id', logRow.id)
    }
  }
}

async function getAccessToken(serviceAccount) {
  const cacheKey = serviceAccount.client_email
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  // Build JWT
  const header = { alg: 'RS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }

  const b64u = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const unsigned = `${b64u(header)}.${b64u(claim)}`

  // Sign with the service account private key
  const crypto = await import('crypto')
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = signer.sign(serviceAccount.private_key).toString('base64url')
  const jwt = `${unsigned}.${signature}`

  // Exchange JWT for access token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) throw new Error(`GA token: ${res.status} ${await res.text()}`)
  const { access_token, expires_in } = await res.json()
  tokenCache.set(cacheKey, {
    token: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  })
  return access_token
}

async function fetchYesterdayReport(propertyId, token) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate: 'yesterday', endDate: 'yesterday' }],
        metrics: [
          { name: 'sessions' },
          { name: 'screenPageViews' },
          { name: 'transactions' },
          { name: 'purchaseRevenue' },
        ],
      }),
    }
  )
  if (!res.ok) throw new Error(`GA report: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const row = data.rows?.[0]
  return {
    date: 'yesterday',
    sessions:        Number(row?.metricValues?.[0]?.value) || 0,
    screenPageViews: Number(row?.metricValues?.[1]?.value) || 0,
    transactions:    Number(row?.metricValues?.[2]?.value) || 0,
    purchaseRevenue: Number(row?.metricValues?.[3]?.value) || 0,
    rawTotals: data.rows,
  }
}
