# Worker — scraper + alerts + repricing + sync

Node.js background service. Runs Playwright to scrape competitor sites,
evaluates alert rules + repricing rules, and pushes approved price
changes to Dynamics 365 / Shopify / WooCommerce / BigCommerce / Magento.

## Deploy to Railway

1. Sign up at <https://railway.app>. Create a new project → **Deploy from GitHub repo**.
2. Point at `utcebs/Pricing-competitor-app`. Root directory: `worker/`.
3. Add env vars in Railway → Variables:

```
SUPABASE_URL=https://hllxetdbnwmunztyfcxa.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Supabase Dashboard → Settings → API → service_role>
RESEND_API_KEY=<optional; alerts won't send email without this>
HTTP_PROXY=<optional; e.g. ScraperAPI URL for anti-bot>
```

⚠️ `SUPABASE_SERVICE_ROLE_KEY` is a secret. NOT the anon key. It bypasses RLS.

4. Add a `nixpacks.toml` (or Railway auto-detects Node). Set the build command to:

```
npm ci && npm run install-playwright
```

And start command:

```
npm start
```

5. Deploy. Railway logs will show `[worker] started` when running.

## Deploy to Render (alternative)

Same env vars. Build command: `npm ci && npx playwright install chromium --with-deps`. Start command: `node src/index.js`. Instance type: `Standard` or higher (Playwright needs ~1GB RAM).

## Local dev

```bash
cd worker
cp .env.example .env  # then fill in the values
npm install
npm run install-playwright
npm start
```

## What it does

Every minute (`tick()` in `src/index.js`):
1. **Scrapes** — picks up any `scrape_runs` rows with `status='queued'` and processes them via Playwright (`src/scraper.js`). Uses `competitors.scrape_config` for per-site selectors.
2. **Alerts** — evaluates every active `alert_rules` against recent price history; sends emails via Resend for matches (`src/alerts.js`).
3. **Repricing** — evaluates active `pricing_rules` against latest competitor prices; creates `pricing_proposals` for approval (or auto-applies if configured) (`src/repricing.js`).
4. **Sync** — pushes approved proposals to the active integration (Dynamics 365, Shopify, etc.) (`src/sync.js`).

Every 6 hours (cron): enqueue a scheduled scrape for every active competitor.

## Notes

- The `parsePrice` / `parseStock` helpers in `src/scraper.js` are naive defaults. Real-world sites need per-competitor CSS selectors configured in the frontend (Competitors → edit → `scrape_config` JSONB).
- Dynamics 365 push assumes the `products` entity has a `price` field and lookup by `productnumber`. Adjust `pushDynamics365` in `src/sync.js` if your D365 entity model differs.
- All external API calls are logged to `integration_sync_log` with request/response payloads for auditability.
