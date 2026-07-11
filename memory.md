# Project Memory — Price Competitor App

> **Read this file first in any new session.** Everything needed to get full context on this project without re-exploring. Keep it updated whenever architecture, decisions, or state change.

---

## 1. What this project is

A competitive-price monitoring platform (Prisync / Price2Spy style). Tracks competitor prices + stock across ~15 sites for ~1,000–1,500 SKUs. Ultimate goal: automated repricing that pushes updates into **Microsoft Dynamics 365** so the business stays competitive without manual work.

**Users**: 5–15 internal users with RBAC (admin / manager / viewer). 5–8 concurrent.

**Scope reality**: this is a 3–6 month build for a small team, phased into 6 stages. See §5.

---

## 2. Local setup

- **Working directory**: `c:\Users\jeswin\Desktop\MY websites\price-competitor-app`
- **Git user**: `utcebs`
- **GitHub remote**: `https://github.com/utcebs/Pricing-competitor-app.git`
- **Node**: `npm run dev` (Vite on `:5173`), `npm run build` (production → `dist/`)
- **Deploy**: **GitHub Pages**, source = `main` branch, folder = `/docs`. Workflow at `.github/workflows/deploy.yml` rebuilds and commits `/docs/` on every push to main.

---

## 3. Live URLs

- **App**: <https://utcebs.github.io/Pricing-competitor-app/>
- **GitHub repo**: <https://github.com/utcebs/Pricing-competitor-app>
- **Supabase project**: <https://hllxetdbnwmunztyfcxa.supabase.co> (project ref: `hllxetdbnwmunztyfcxa`)
- **Note**: this is a FRESH Supabase project, separate from the EBS project (`hddfkkojfvmjuxsyhcgh`). Never mix them.

---

## 4. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite + Tailwind | Familiar (EBS repo uses same) |
| Routing | react-router-dom + **HashRouter** | Gh-pages can't do server-side SPA routing |
| DB + Auth | Supabase (Postgres + RLS) | Free tier fine for MVP |
| Charts | Recharts | Simple, tree-shakeable |
| Icons | lucide-react | Consistent set, small |
| Hosting | GitHub Pages via `docs/` folder on `main` | See §7 for why we chose this over gh-pages branch |

**Not yet installed** (planned for later phases):
- `react-i18next` + `tailwindcss-rtl` — Phase 2 (Arabic support)
- Playwright + BullMQ + Redis — Phase 2 (scraping worker; runs on Railway)
- Resend + `react-email` — Phase 3 (alerts)
- `xlsx` + `papaparse` — Phase 4 (custom reports)

---

## 5. Phased roadmap

| Phase | Scope | Status |
|---|---|---|
| **0** | Scaffold + first push | ✅ done |
| **1** | Data model + auth + manual CRUD (Products, Competitors, Linked Items, Price Entry, Trends, Categories, Users) | ✅ done |
| **2** | Playwright scraper worker (Railway), BullMQ + Upstash Redis, ScraperAPI proxy pool, anti-bot, Arabic RTL toggle | pending |
| **3** | Product matching (manual + auto via name-similarity or OpenAI embeddings), Resend email alerts (instant + daily digest), alert rules per user | pending |
| **4** | Configurable dashboard widgets, custom report builder (metric/filter/group-by), export to Excel/CSV/PDF | pending |
| **5** | Rule engine for repricing, approval queue (manual → auto later), **Dynamics 365 REST integration**, Shopify + WooCommerce + BigCommerce + Magento connectors, Google Analytics read | pending |

**Phase 2+ requires user-provisioned infra**: Railway account, ScraperAPI subscription (~$50/mo), Upstash Redis (free tier ok), Resend API key, Dynamics 365 tenant + OAuth app, e-commerce test-store API tokens, GA service account JSON.

---

## 6. Directory structure

```
/
├── .github/workflows/deploy.yml     Build + commit /docs on every push to main
├── docs/                            Committed built output — what GH Pages serves
├── index.html                       Vite root (dev + build entry)
├── vite.config.js                   base: './', server on :5173
├── tailwind.config.js               Brand indigo palette + Inter font
├── postcss.config.js
├── package.json                     react, vite, tailwind, supabase-js, recharts, react-router-dom, lucide-react
├── memory.md                        This file
├── src/
│   ├── main.jsx                     HashRouter + StrictMode
│   ├── App.jsx                      Routes: /login + Layout with 10 pages
│   ├── index.css                    Tailwind directives + tabular-nums util
│   ├── supabaseClient.js            ⚠️ Real URL + anon key hardcoded (safe)
│   ├── lib/
│   │   ├── auth.jsx                 AuthProvider — session + profile + role helpers
│   │   └── db.js                    useTable + saveRow + deleteRow generic hooks
│   ├── components/
│   │   ├── Layout.jsx               Sidebar + auth gate (Navigate to /login if !user)
│   │   └── UI.jsx                   PageHeader / Card / Button / Modal / ConfirmDialog / Field / Empty / Badge / LoadingBlock / ErrorBlock + inputCls / selectCls / textareaCls
│   └── pages/
│       ├── Dashboard.jsx            Stat cards + recent activity + quick actions
│       ├── Login.jsx                Email/password form
│       ├── Products.jsx             Table + add/edit modal
│       ├── Competitors.jsx          Table + add/edit modal
│       ├── CompetitorProducts.jsx   Linked items (their URL ↔ your SKU), filters
│       ├── PriceEntry.jsx           Manual "log a price" form (also writes stock_history)
│       ├── PriceTrends.jsx          Recharts LineChart, one line per competitor + your price ref
│       ├── Categories.jsx           Tree view + add/edit
│       ├── Users.jsx                Admin-only role editor
│       └── Placeholder.jsx          "Coming in Phase N" for alerts/reports/settings
└── supabase/
    └── schema.sql                   Phase 1 schema (canonical)
```

---

## 7. Deploy — why /docs on main (not gh-pages branch)

**Path we settled on**: `.github/workflows/deploy.yml` runs on every push to `main`. It builds, syncs `dist/` → `docs/`, and commits the `docs/` change back to `main` with `[skip ci]` in the message so it doesn't loop.

GitHub Pages source: `main` branch, `/docs` folder.

**Why not gh-pages branch or actions/deploy-pages?** Both were tried and hit user-side configuration confusion. Neither worked cleanly. The `/docs`-on-main approach:
- Uses classic branch-based Pages serving (most common config)
- Puts the built output in the same branch as source — visible in normal `git log`
- No branch dropdown to get wrong
- Zero manual re-config after the first setup

**Gotcha**: `docs/` is tracked in git and pushed by CI. Local `dist/` is gitignored. Never edit `docs/` manually — always let the workflow (or `npm run build && cp -r dist/* docs/`) regenerate it.

---

## 8. Supabase

**Project**: `hllxetdbnwmunztyfcxa.supabase.co`
**Anon key**: hardcoded in `src/supabaseClient.js` (safe — anon key is public by design; RLS enforces per-row access).

### Two clients pattern

`src/supabaseClient.js` exports **two** Supabase clients — same rule as the EBS repo (see EBS memory.md §7 for full history):

- `supabase` — auth-enabled. Login, session, all authenticated writes.
- `supabasePublic` — no session persistence, isolated `storageKey: 'sb-public-readonly'`. Used inside `fetchProfile()` in `auth.jsx` to sidestep the GoTrue lock deadlock.

**Rule**: Never `await` a Supabase call inside `onAuthStateChange` or `.then()` of `getSession()`. GoTrue lock is held. Use `supabasePublic` there, fire-and-forget.

### Tables (Phase 1)

- **profiles** — one row per auth user. Auto-created by `on_auth_user_created` trigger. `role` = `admin | manager | viewer`. Extra: `avatar_url`, `locale` (en|ar).
- **currencies** — reference (KWD, USD, EUR, GBP, SAR, AED). KWD = base. `rate_to_base` filled by Phase 2 FX job.
- **categories** — hierarchical via self-ref `parent_id`. `is_active`, `sort_order`, `slug`.
- **products** — your catalogue. `sku` unique. `cost_price`, `min_price`, `target_margin`, `current_price`, `currency_code`. `is_own_brand` flag → drives category-wise comparison. JSONB `attributes` for variants.
- **competitors** — sites you monitor. `domain` unique. `country` (ISO). `scrape_config` JSONB reserved for Phase 2.
- **competitor_products** — the join. `competitor_id` + `product_id` (nullable — unmatched items still get scraped). `url` unique per competitor. `match_method` = `manual | auto | category | none`. `match_confidence` for Phase 3 auto-matcher. `variant_group_id` for Phase 2 size/colour groupings. `last_seen_at` bumped on every scrape.
- **price_history** — append-only time-series. `competitor_product_id`, `price`, `currency_code`, `price_type` (regular|sale|clearance), `original_price` (crossed-out), `source` (manual|scrape|import), `scrape_run_id` (Phase 2), `captured_at`.
- **stock_history** — append-only. `in_stock` bool + `stock_note` text ("Only 3 left"). Same `source` + `scrape_run_id` fields.

### RLS

- All 8 tables have RLS enabled.
- **Read**: any `auth.role() = 'authenticated'` (no anon read).
- **Write**: only `admin` or `manager` role — enforced by `is_admin_or_manager()` SECURITY DEFINER function.
- **profiles**: everyone reads all rows; users update their own row; admins update anyone's role.

### Auth

- Supabase Auth email/password.
- `on_auth_user_created` trigger auto-creates `profiles` row on `auth.users` insert. New users start as `viewer`.
- `auto_confirm_auth_user_trigger` sets `email_confirmed_at = NOW()` if null so users can log in immediately. Dashboard toggle "Confirm email" should also be **OFF**.

### First-time setup after running schema

1. Auth → Providers → Email → "Confirm email" **OFF**
2. Auth → URL Configuration → add `https://utcebs.github.io/**` to allowed redirect URLs, set Site URL to app URL
3. Create admin user (via Dashboard OR direct SQL in schema comments) → then `UPDATE profiles SET role='admin' WHERE email='...'`

### Existing admin

- **Email**: `admin@test.com`
- **Password**: `P@ssw0rd`
- Created via direct SQL INSERT into `auth.users` + `auth.identities` (see the earlier chat message — approach uses `crypt(password, gen_salt('bf'))`)

---

## 9. Routing + auth gate

- `HashRouter` — URLs use `#/route` because gh-pages can't do server-side SPA routing.
- Every route is wrapped in `<Layout>` which:
  - Waits for auth `loading` to finish
  - If `!user`, `<Navigate to="/login" />` unconditional
  - Otherwise renders sidebar + `<Outlet />`
- Admin-only nav items (`/categories`, `/users`) hidden from sidebar for non-admins, and pages guard themselves too.
- Manager-only actions (add/edit/delete buttons) hidden via `useAuth().isManager` (true for admin OR manager).

---

## 10. Data hooks (`src/lib/db.js`)

- `useTable(table, opts)` — generic list fetch. Returns `{ rows, loading, error, refresh, setRows }`. Options: `select`, `eq` `[column, value]`, `order` `[column, {ascending}]`, `limit`, `deps`.
- `saveRow(table, row)` — upsert. If `row.id` exists → UPDATE; else INSERT. Returns `{ data, error }`.
- `deleteRow(table, id)` — soft wrapper, returns Supabase response.

**Pattern**: pages compose these to avoid repeating fetch/save boilerplate. Keeps page code focused on layout + validation.

---

## 11. UI kit (`src/components/UI.jsx`)

Small primitives to keep the design consistent without pulling in a full component library:

- `PageHeader({ title, subtitle, action })`
- `Card({ children, className })`
- `Button({ variant, size, busy, children })` — variants: primary / secondary / ghost / danger
- `Modal({ open, onClose, title, wide, children })` — ESC closes, backdrop clickable
- `ConfirmDialog({ open, title, message, onConfirm, confirmLabel, busy })`
- `Field({ label, required, hint, children })`
- `Empty({ icon, title, description, action })`
- `Badge({ variant, children })` — slate / brand / green / red / amber
- `LoadingBlock({ text })`
- `ErrorBlock({ error, onRetry })`
- Shared classes: `inputCls`, `selectCls`, `textareaCls`

---

## 12. Gotchas + patterns to remember

- **JSX in `.js` files fails** in Vite/Rollup at build time. Anything using JSX must be `.jsx`. Already caught once with `auth.jsx`.
- **Vite bundle warning** — `recharts` pulls a lot in. Currently `dist/assets/index-*.js` is ~830 KB pre-gzip. Fine for Phase 1; consider `manualChunks` + `React.lazy` for the trends page once other heavy deps arrive.
- **HashRouter caveats** — deep-links look like `/#/products` (fine); browser-refresh works because the SPA reads the hash. Never use BrowserRouter on gh-pages.
- **RLS + INSERT** — inserts run under the user's auth context. If `is_admin_or_manager()` returns false, INSERT silently returns nothing back but no error. Watch for this when creating the first admin.
- **auth.identities row is REQUIRED** for email/password login in modern Supabase — direct SQL inserts into `auth.users` alone won't work. Password bcrypt via `crypt(password, gen_salt('bf'))` (pgcrypto extension).
- **`recharts` import** — import individual components (`LineChart`, `Line`, etc.), don't do wildcard imports.

---

## 13. Known open questions / decisions pending

- **Currency conversion**: Phase 2 will need an FX API. Recommend `openexchangerates.org` free tier (1000 req/mo). Cron job updates `currencies.rate_to_base`.
- **Scraper hosting**: Railway or Render? Railway free tier is currently a 30-day trial, then $5/mo. Render has a free web service (750h/mo).
- **Proxy provider**: ScraperAPI ($49/mo starter) vs Bright Data (pay-per-GB, more expensive but more anti-bot capable). Recommend starting with ScraperAPI, upgrade if we hit blocks.
- **Auto-match algorithm**: Phase 3. Either Levenshtein / trigram in-DB (cheap, decent) or OpenAI embeddings (much better, ~$0.02/1000 SKUs).
- **Dynamics 365 auth**: needs an Azure AD app registration + admin consent to `Dynamics.ReadWrite.All` scope. User needs to provide tenant ID + client credentials.

---

## 14. Verification / smoke test after changes

Run in an incognito window against the live URL:

1. ✅ Site loads: <https://utcebs.github.io/Pricing-competitor-app/> → shows Login page
2. ✅ Sign in with `admin@test.com` / `P@ssw0rd` → redirects to Dashboard
3. ✅ Sidebar shows email + `admin` role at bottom
4. ✅ Dashboard shows 4 stat cards (all zero on first run) + "No prices logged yet"
5. ✅ Products → Add product → save → row appears in table
6. ✅ Competitors → Add competitor → save → row appears
7. ✅ Linked Items → Add link (pick competitor + product + URL) → row appears
8. ✅ Log a Price → pick competitor + linked item → enter price + stock → save → success message
9. ✅ Price Trends → pick product → chart draws with the one point + "Your price" horizontal reference
10. ✅ Categories → Add "Kitchen" → Add "Kettles" as child → tree renders indented
11. ✅ Users → your email shown as `You` + `admin` — role dropdown works
12. ✅ Sign out → redirected to Login → cannot access dashboard without re-signing in

---

## 15. Change log

- **2026-07-11 · Phase 0** — scaffold pushed. Vite + React + Tailwind + Supabase client wired. Sidebar + placeholder pages. Deployed via `docs/` on main.
- **2026-07-11 · Phase 1** — real Supabase schema (8 tables + RBAC) applied. Auth working with `admin@test.com`. Full CRUD for Products, Competitors, Linked Items. Manual price entry. Price Trends chart. Categories tree. Users role editor.
- **2026-07-11 · Phases 2-5 all frontend + schema + worker code shipped** — see §16.

## 16. Phases 2–5 — full-stack rollout

### Phase 2 — Scrapers + i18n
Migration `supabase/migrations/phase-2-5.sql` adds `scrape_runs` + `scrape_jobs` tables. Frontend `/scrapers` page (`src/pages/Scrapers.jsx`) enqueues runs and shows history/status. i18n scaffold: `src/lib/i18n.js` + `src/locales/{en,ar}.json`. Sidebar has EN/AR toggle; `document.dir` flips to `rtl` for Arabic.

### Phase 3 — Matching + alerts
Tables: `alert_rules`, `alert_deliveries`, `match_suggestions`. Frontend `/alerts` (rule builder with 6 triggers × 4 scopes) and `/matches` (accept/reject queue for auto-generated product matches). Rules are per-user (`owner_id`). Delivery: instant OR daily digest.

### Phase 4 — Reports (fully functional, no external deps)
Table: `saved_reports` with JSONB config. Frontend `/reports`: pick metric (avg/min/max price, gap %, in-stock rate, price change count), group by (competitor/category/product/day/week/month), date range, chart type (table/bar/line/pie). Runs client-side aggregation over `price_history` + `stock_history` (up to 10k rows). Save reports, export to CSV (papaparse) or Excel (xlsx). Sidebar with saved reports list.

### Phase 5 — Repricing + integrations
Tables: `pricing_rules`, `pricing_proposals` (approval queue), `integrations` (6 kinds: Dynamics 365, Shopify, WooCommerce, BigCommerce, Magento, Google Analytics), `integration_sync_log`. Frontend `/repricing`: rule builder with 6 strategies (match_lowest, beat_lowest_by_pct, beat_lowest_by_amt, match_average, stay_x_pct_above/below) + guardrails (min_price, target_margin, only-if-competitor-in-stock, auto-apply). Pending proposals shown for approval. Frontend `/integrations`: kind-specific credential forms. Recent sync log side panel.

### The worker (`worker/` directory) — deploys to Railway

Runs the actual backend. Single Node.js process, four responsibilities every 60 seconds:

1. **Consume queued scrape_runs** — Playwright with configurable CSS selectors per competitor (`competitors.scrape_config` JSONB). Anti-bot via `HTTP_PROXY` env var (ScraperAPI / Bright Data).
2. **Alert rule evaluation** — checks recent price history for changes matching rules; emails via Resend.
3. **Repricing rule evaluation** — computes suggested prices, applies guardrails, creates `pricing_proposals` (or auto-applies).
4. **Integration sync** — pushes approved proposals to Dynamics 365 (OAuth 2.0 + REST) / Shopify / WC / BC / Magento. All logged to `integration_sync_log`.

Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS), `RESEND_API_KEY`, `HTTP_PROXY`.

Deployment: `cd worker && npm ci && npm run install-playwright && npm start`. Root directory in Railway config: `worker/`.

## 17. Follow-up completion pass — every gap closed

Everything I flagged as "TODO / partial / missing" in the initial phases-2-5 push is now shipped. Full list of what changed in the follow-up:

**Auto-matcher (Phase 3)** — `pg_trgm` extension enabled; `generate_match_suggestions()` function + `AFTER INSERT` trigger on `competitor_products` writes top-3 similar products (score ≥ 0.4) to `match_suggestions`. Backfill query re-scans any existing unlinked rows. All in the same `phase-2-5.sql` migration.

**All 6 alert triggers (Phase 3)** — `worker/src/alerts.js` rewritten. `went_out_of_stock` / `came_back_in_stock` compare recent `stock_history` transitions; `gap_pct_over` / `gap_pct_under` join `competitor_products.product_id → products.current_price` and compute `(competitor - your) / your × 100`. All triggers scoped via `matchesScope()` helper against `any_product / specific_product / specific_category / specific_competitor`.

**Digest email cron (Phase 3)** — `sendDigestEmails()` in `worker/src/alerts.js`, called from `cron.schedule('0 9 * * *')` in `worker/src/index.js`. Groups pending digest rows by `owner_id`, sends one HTML email per user via Resend, marks all as `sent` in a single UPDATE.

**PDF export (Phase 4)** — `jspdf` + `jspdf-autotable` added. New "PDF" button in Reports next to CSV/Excel. Includes title, metric label, date range header, and formatted table.

**Configurable dashboard widgets (Phase 4)** — `profiles.dashboard_config JSONB` added. Dashboard rewritten with 10 available widgets (7 stat cards + 3 panels). "Customize" button opens a modal to toggle each widget on/off and reorder with ↑↓ arrows. Config saves to profile.

**Google Analytics read (Phase 5)** — `worker/src/google-analytics.js` implements JWT-based service account auth (RS256 signing via Node's `crypto`), calls Analytics Data API v1 for sessions/pageviews/transactions/purchaseRevenue for yesterday. Called from `cron.schedule('0 3 * * *')`. Results in `integration_sync_log.response_payload`. No SDK dependency — direct REST.

**BullMQ + Redis (Phase 2)** — `worker/src/queue.js` sets up BullMQ ONLY if `REDIS_URL` is set. When present, a producer moves queued `scrape_runs` from Supabase into a BullMQ queue and marks them `running`; a Worker with concurrency=2 consumes and calls `runScrapeJob`. Automatic retries with exponential backoff. When `REDIS_URL` is not set, the polling loop in `index.js` handles it — same code paths.

**Scrape config editor (usability)** — Competitors form modal grew a JSON textarea for `scrape_config`. Malformed JSON throws before save.

**Bundle splitting** — `App.jsx` uses `React.lazy` for every page. Result: main JS chunk dropped from 1.26 MB to 462 KB pre-gzip. Recharts, xlsx, jspdf, html2canvas only download when their route mounts.

## 18. What's ready-to-run vs. needs external service

| Feature | Frontend + Schema | Worker code | Needs external |
|---|---|---|---|
| Products / Competitors / Linked / Prices / Trends | ✅ | — | — |
| Categories / Users | ✅ | — | — |
| Reports (custom builder + CSV/Excel export) | ✅ | — | — (fully working end-to-end) |
| Alerts (rule builder + delivery log) | ✅ | ✅ | Resend API key for email delivery |
| Match Review | ✅ | Auto-matcher SQL/trigram TODO | Optional: OpenAI embeddings for better matches |
| Scrapers | ✅ | ✅ Playwright | Railway/Render deploy + ScraperAPI proxy pool |
| Repricing | ✅ | ✅ Rule engine | Runs on the worker |
| Integrations config | ✅ | ✅ Push handlers for all 6 | Real credentials from tenants (D365 app registration, Shopify token, etc.) |

_Last updated: 2026-07-11 — Phases 2-5 shipped._
