# Worker — scraper + alerts + repricing + integrations sync

Node.js background service. Runs Playwright to scrape competitor sites,
evaluates alert + repricing rules, and pushes approved price changes
to Dynamics 365 / Shopify / WooCommerce / BigCommerce / Magento.

---

## Deploy to Render (recommended — done in 5 minutes)

### 1. Get your Supabase service role key

<https://supabase.com/dashboard/project/hllxetdbnwmunztyfcxa/settings/api>

Scroll to **Project API keys → `service_role`** (SECRET section, NOT anon).
Click "Reveal" and copy. This bypasses RLS so the worker can insert into
any table. **Never expose to the browser.**

### 2. Create a Render Blueprint deploy

The repo already has a `render.yaml` at the root that defines the whole
service. Deploy it in one click:

1. Go to <https://dashboard.render.com/blueprints>
2. Click **New Blueprint Instance**
3. Connect the GitHub repo `utcebs/Pricing-competitor-app` and select the `main` branch
4. Render reads `render.yaml` and shows: `1 worker service to be created`
5. Fill in the env vars it prompts for:

| Env var | Value |
|---|---|
| `SUPABASE_URL` | `https://hllxetdbnwmunztyfcxa.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | (paste from step 1) |
| `RESEND_API_KEY` | Skip for now — alerts will just get marked `skipped`. Add later when you sign up at resend.com |
| `ALERT_FROM` | `alerts@yourdomain.com` (only used when Resend is wired) |
| `HTTP_PROXY` | Skip — used when you sign up for ScraperAPI or similar to bypass bot detection |
| `REDIS_URL` | Skip — optional BullMQ path. Worker falls back to polling |

6. Click **Apply**. Render will:
   - Provision a Background Worker instance (Starter plan, $7/mo)
   - Run `npm ci && npx playwright install --with-deps chromium` (~3 min first time)
   - Start `node src/index.js`
7. Watch the logs. First line you should see: `[worker] started · REDIS_URL: no`

### 3. Test it

Go to the app's **Scrapers** page (`/#/scrapers`), click **Play** next to any
competitor. Within 60 seconds the worker's log will show the run being
picked up. Refresh the Scrapers page — the row status flips from
`queued` → `running` → `completed`.

---

## Alternative: Deploy to Railway

Railway also works. Same env vars. Different setup:

1. <https://railway.app/new> → **Deploy from GitHub repo**
2. Point at `utcebs/Pricing-competitor-app`
3. Settings → **Root directory** → `worker`
4. Settings → **Build command** → `npm ci && npx playwright install --with-deps chromium`
5. Settings → **Start command** → `node src/index.js`
6. Variables tab: add the same vars as the Render list above

Railway pricing: Free trial for 30 days, then ~$5/mo of usage credits included on the Hobby plan. Comparable to Render Starter for this workload.

---

## Local development

```bash
cd worker
cp .env.example .env         # then fill in the values
npm install
npx playwright install --with-deps chromium   # first time only
npm start
```

You'll see `[worker] started` and it'll poll Supabase every 60 seconds.
Trigger a scrape from the app's Scrapers page and watch the logs.

---

## What the worker does

Every 60 seconds:

1. **Consume queued scrape_runs** — pulls up to 5 rows from
   `scrape_runs WHERE status = 'queued'`. For each: launches Playwright,
   pulls each `competitor_products` URL, extracts price + stock via the
   competitor's `scrape_config` selectors, writes to `price_history` +
   `stock_history`.
2. **Alert rule evaluation** (`src/alerts.js`) — checks recent history
   against every active `alert_rules` row. All 6 triggers implemented:
   `price_dropped`, `price_increased`, `went_out_of_stock`,
   `came_back_in_stock`, `gap_pct_over`, `gap_pct_under`. Instant delivery
   → send email via Resend. Digest → queue for 9 AM.
3. **Repricing rule evaluation** (`src/repricing.js`) — computes
   suggested prices from `pricing_rules` strategies (match_lowest,
   beat_lowest_by_pct, etc.) with guardrails (min_price, target_margin,
   only-if-competitor-in-stock). Creates `pricing_proposals` for
   approval (or applies directly if `auto_apply`).
4. **Integration sync** (`src/sync.js`) — polls `pricing_proposals
   WHERE status = 'approved'` and pushes each to the configured active
   integration. Handlers written for Dynamics 365 (OAuth 2.0 + REST v9.2),
   Shopify, WooCommerce, BigCommerce, Magento. Every call logged to
   `integration_sync_log`.

Cron schedules:

- `0 */6 * * *` — enqueue a scheduled scrape run for every active competitor
- `0 9 * * *`  — send digest emails for pending digest deliveries
- `0 3 * * *`  — pull yesterday's Google Analytics metrics for active GA integrations

---

## Anti-bot handling

For sites that block bots:

1. Sign up at <https://www.scraperapi.com> or <https://brightdata.com>
2. Get their proxy URL (looks like `http://username:password@proxy.host:port`)
3. Add `HTTP_PROXY=<that url>` to your Render env vars
4. Restart. Playwright will route all requests through the proxy pool.

ScraperAPI starter is $49/mo for 250K requests. Enough for 15 sites × 1500 SKUs × 4 scrapes/day ~= 6K requests/day.

---

## Custom per-site selectors

Default selectors in `src/scraper.js` (`.price`, `[itemprop="price"]`, etc.)
will fail on most real sites. To customize:

1. Open the app's Competitors page → edit a competitor
2. Fill in the **Scrape config (JSON)** textarea:

```json
{
  "priceSelector": ".product-price .current",
  "stockSelector": ".stock-status",
  "waitFor": ".product-detail-loaded"
}
```

3. Save. Next scrape run for that competitor uses your selectors.

The worker's `runScrapeJob` reads `competitors.scrape_config` and passes
those selectors to Playwright. `waitFor` is optional — use when the site
loads price via JavaScript after initial page render.

---

## Scaling past ~100 competitors

The polling loop handles a few hundred competitors fine. If you're doing
thousands and need proper queue-with-retries:

1. Sign up for Upstash Redis (free tier: 10K commands/day)
2. Grab the `REDIS_URL` connection string
3. Add `REDIS_URL=<that url>` to Render env vars
4. Restart. `src/queue.js` detects `REDIS_URL` and boots BullMQ:
   producer, Worker with concurrency 2, retries with exponential backoff.

Same worker code — just backed by a real queue.
