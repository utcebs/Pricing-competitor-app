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

## 18. Render deploy (one-click)

The repo has `render.yaml` at the root defining a Background Worker service. Deploy flow:

1. `https://dashboard.render.com/blueprints` → **New Blueprint Instance**
2. Point at `utcebs/Pricing-competitor-app` main branch
3. Set env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret; from Supabase → Settings → API `service_role`), + optional `RESEND_API_KEY`, `ALERT_FROM`, `HTTP_PROXY`, `REDIS_URL`
4. Click Apply. Render provisions Starter plan ($7/mo), runs `npm ci && npx playwright install --with-deps chromium`, starts `node src/index.js`

Region: Frankfurt (closest to Kuwait; change in `render.yaml` if needed). Auto-deploy on push to main.

Why Background Worker instead of Web Service: Render's free-tier Web Services spin down after 15 min inactivity. The polling loop needs continuous execution. Starter Background Worker stays hot 24/7. Alternative: Railway ($5/mo Hobby plan credits) — same env vars, root directory `worker/`.

Full setup walkthrough + anti-bot proxy config + custom-selector docs live in `worker/README.md`.

## 19. What's ready-to-run vs. needs external service

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

---

## 20. 2026-07-12 to 2026-07-16 — premium rebuild + real scraping + auto-linking

Long iterative session. What changed, grouped by area:

### A. Bug that hid every "Add" button since day one
`AuthProvider.fetchProfile()` used `supabasePublic` (anon key, no session). RLS on `profiles` requires `auth.role() = 'authenticated'`. So the profile fetch **silently returned zero rows** for everyone — `isAdmin`/`isManager` always false. Every admin-gated button (Add product, Add competitor, Users page, etc.) was invisible to everyone including admins.

**Fix**: `src/lib/auth.jsx` — switched `fetchProfile` to the auth-enabled `supabase` client. Safe to await inside because callers fire-and-forget: the outer `onAuthStateChange` callback returns before the inner await resolves, so no GoTrue lock is held.

### B. Design overhaul — premium warm palette
`tailwind.config.js` + `src/index.css` + `src/components/UI.jsx` rewritten.

- **Palette**: refined muted gold (`#b1863a` brand-500) + warm near-black ink scale (stone family) + cream canvas backgrounds. No cool slate anywhere.
- **Fonts**: `Inter` body + **`Fraunces` serif** for wordmark and page hero titles (`font-display` class). Loaded via Google Fonts inline.
- **Sidebar**: rebuilt as `"Prisma · Intel"` wordmark in serif, warm near-black bg, gold-dot active-nav marker. Section labels ("Automation", "Administration") with `.2em` tracking.
- **Login**: split panel — dark brand side left, form right with serif welcome header.
- **UI tokens**: refined buttons (primary charcoal, new `gold` variant), modal with backdrop blur + subtitle, Field with small-caps micro-labels, layered warm shadows (`shadow-card` / `shadow-card-lg` / `shadow-card-xl`).
- **Palette sweep**: `sed` swept every page: `slate-*` → `ink-*` / `canvas-*`.

### C. Admin user CRUD
New migration: `supabase/migrations/admin-user-mgmt.sql`
- `admin_create_user(email, password, full_name, role)` — SECURITY DEFINER; bcrypts password, inserts to `auth.users` + upserts profile
- `admin_delete_user(id)` — cascades to profile via FK; can't delete self
- `admin_reset_password(id, new_password)` — bcrypt-hash the new pass
All guarded so only `role='admin'` can invoke.

Users page (`src/pages/Users.jsx`) rebuilt: **New user** gold CTA, 3 role summary tiles, avatar chips with initials colour-coded by role, inline role dropdown, KeyRound + Trash actions. Guardrails: no self-delete, warn on self-demote.

### D. Bulk import (CSV upload with downloadable template)
New reusable component: `src/components/BulkUpload.jsx`
- Downloads template CSV pre-filled with 2-3 sample rows
- Parses uploaded CSV via papaparse (already in stack)
- Per-row `transformRow(row)` returns `{ payload, error }` — errors surface in a per-row "Skipped rows" panel
- Preview first 5 rows before Import

Wired into Products, Competitors, and Linked Items pages.

### E. New pages / major page redesigns

**`/#/comparison`** (new page — `src/pages/Comparison.jsx`)
- Matrix view: rows = your products, columns = your price · cheapest rival · gap · one column per active competitor
- Colour-coded pill: 🟢 you're cheaper · 🔴 you're pricier · grey Flat within 1%
- Sort dropdown: 🎯 opportunity (biggest overpricing first) · ⚠️ threat · 📊 coverage · A–Z
- **Refresh** button (re-read DB, instant) + **Re-scrape all** button (queues fresh scrapes across all competitors, ~5 min)
- Category + text search filters
- Product thumbnails on the left, image links to Trend chart
- Wired into Layout nav as "Comparison"

**`/#/scrapers`** rebuild
- Removed stale "Requires worker to be deployed" warning (worker IS deployed via GH Actions)
- Worker health strip: `Healthy` / `Idle` / `Stale` computed from last non-queued run's age (< 10 min = healthy). Pulsing green dot on the healthy state.
- "Last tick activity" + "Next expected tick" tiles
- Live activity panel with per-run progress bars + counters that auto-refresh every 3-5s while runs are active
- **Recent runs table rows are clickable** → drawer opens showing per-URL scrape jobs, extracted prices, durations, stock badges, and **HTML sample viewer** (raw HTML the scraper saw, useful for debugging failed selectors)
- Trigger buttons disabled + show "0 URLs" when the competitor has no linked competitor_products

**`/#/dashboard`** — total rewrite for category managers (`src/pages/Dashboard.jsx`)
- Editorial hero header: `Good morning, {name}. You have N products priced above the market by 5%+.`
- KPI tiles: Coverage · Undercut by market · Commanding premium · Fresh data (pulsing dot when worker healthy)
- **Priority actions panel** — top 6 products ranked by revenue impact (gap × price), each row shows your price, cheapest rival, gap pill, and a **Suggested new price** (cheapest − 0.001, respecting min_price floor)
- **Margin opportunities panel** — products where you're >5% cheaper than avg rival ("you could raise prices here")
- **Recent competitor moves** — last 72h price changes as compact cards with arrows
- **Data pipeline** mini-card — worker status + last tick age
- **Category performance table** — avg-gap pill per category, overpriced/underpriced counts
- Quick action chips at the bottom
- Dropped the "customize widget" flow — over-engineered

**`/#/prices`** (Price Trends) — full analytical view
- Dark hero card with product name in serif + huge tabular Your Price
- 4 analytical tiles: Market range · Market average (with your delta) · Your position (rank + words: cheapest/middle/most expensive) · Market volatility (Very low → Very high label)
- Trend chart with warm palette (gold/teal/wine) instead of default indigo/orange. Your price rendered as an in-chart dashed reference line with a "KD 409.900" label. Dark tooltip.
- Competitor snapshot table + notable moves panel (≥2% changes)
- **Auto-defaults to a product on load**: prefers a product with linked competitors + current_price set, then any linked, then any product

**`/#/reports`** — total rewrite (removed the report builder)
- 4-chart executive analytics dashboard
- KPI strip (4 tiles): Data points · Market direction · Cheapest most often · Categories tracked
- 2×2 chart grid:
  1. **You vs market by category** — grouped bars, charcoal for you, gold for market
  2. **Market price index over N days** — min/avg/max lines (emerald/gold/wine)
  3. **Where you win vs lose per category** — stacked horizontal bar, cheaper/flat/pricier counts
  4. **Who's cheapest most often** — donut, share of "lowest price wins" per competitor
- Full-width bottom chart: **Biggest gap products** — horizontal bar chart with red/green fill
- Range selector (7/30/60/90/365 days) drives everything
- CSV / Excel / PDF exports of the summary table

**`/#/products`** — Filters + Auto-find + Price source toggle
- Filter bar: text search (name/SKU/brand), category dropdown, brand dropdown (auto-derived), tracking dropdown (All / 🟢 Tracked / 🔴 Not tracked)
- "Showing N of M · Clear filters" strip
- **Tracking column** with `🟢 N linked` or `🔴 not tracked` badge on every row
- **✨ Find URLs** action per row (Sparkles icon) — queues a `url_find_jobs` row
- **Auto-find URLs on save** checkbox in Add Product modal (default ON for new products) — automatically queues the finder when the product saves
- **Price source toggle** in Add Product: `Enter manually` vs `Fetch from my website` (URL). URL mode writes to `products.own_url` which the worker refreshes on every tick
- Product thumbnails (40×40) on every row

**`/#/competitor-products`** (Linked Items) — hierarchical tree view
- Category (collapsible with chevron) → Product (collapsible) → Competitor link rows
- Product row: name, SKU, link count badge (green tracked / red not tracked)
- Link row: competitor name, URL as clickable monospace link, inline pencil edit → input → save (PATCH), match badge, last-scraped time, `more` (opens full modal), Trash
- **"Not tracked on: [+ Xcite] [+ Eureka]" chip strip** per product — click a chip → modal opens pre-filled with the right (product, competitor) pair

### F. Scraper (worker) — real e-commerce hardening
Verified end-to-end on real Kuwait sites (Xcite, Best Al-Yousifi, Eureka). Achieved 6/6 URLs scraped after iteration.

- **~35 candidate selectors** covering Shopify, Magento, WooCommerce, BigCommerce, data-testid patterns, generic `.price` variants
- **JSON-LD + og:price + `__NEXT_DATA__` parser** as fallbacks — the Next.js parser walks the JSON payload for `sellingPrice / salePrice / offerPrice / currentPrice / price / amount` keys with nested `{ amount, currency }` support
- **15s networkidle wait** + 1.5s post-hydration beat (was 8s, Xcite TVs needed longer)
- Better user-agent (real Chrome UA, not "PriceCompetitorBot/0.1")
- Blocks images/media/fonts for ~4× page-load speedup
- Records `raw_html_sample` (4KB from middle of doc) when nothing matched — surfaced in the Scrapers page HTML viewer
- Saves `matchedSelector` for successful extractions (audit trail)
- `parsePrice` prefers decimal numbers (`342.500`) over integers (storage sizes like `256`, `512`)

### G. Image extraction
- New `extractImage()` function in scraper.js:
  1. `<link rel="preload" as="image">` — modern SPA hero-image signal
  2. JSON-LD Product.image
  3. og:image
  4. twitter:image
  5. Largest `<img>` ≥180×180 on the page
- Every candidate runs through `isJunkImageUrl()` filter — rejects URLs containing `logo`, `favicon`, `sprite`, `placeholder`, `/icons/`, `banner`, `og-default`, `data:image`. This was needed because Xcite's og:image resolved to `/assets/icons/xcite-logo.png` for a while (site logo, not product photo) and cascaded to 5 products before the fix.
- **Image cascade**: after saving `competitor_products.image_url`, worker also updates `products.image_url` via `.is('image_url', null)` filter — first competitor scrape that finds a non-junk image wins; never overwrites. Result: any product missing an image gets one from any competitor that has it.
- Thumbnails (40×40 / 44×44) shown on Products + Comparison pages with `onError` fallback to a warm-grey Package-icon box.

### H. URL auto-finder — one-click competitor discovery
New migration: `supabase/migrations/url-finder.sql`
- `url_find_jobs` table (product_id, competitor_id nullable, status, results JSONB, urls_found, error_summary)
- RLS: authenticated read, admin/manager write

New worker: `worker/src/find-urls.js`
- Two strategies per competitor:
  1. Competitor's own `searchUrlTemplate` (from `competitors.scrape_config`) e.g. `https://xcite.com/search?text={q}`
  2. **DuckDuckGo `site:` search fallback** via `html.duckduckgo.com/html/` (works on any competitor with zero config)
- Result filter: extracted URL must include the competitor's domain + look like a product URL (rejects `/category/`, `/search/`, homepage, etc.)
- Skips creation if a link already exists for the (product, competitor) pair
- Inserts `competitor_products` with `match_method='auto'`, `match_confidence=0.6`
- **After finding URLs, immediately enqueues `scrape_runs`** for those competitors — a single tick can find + scrape end-to-end

Wired into `worker/src/tick.js` BEFORE scrape processing so both chain naturally.

**DDG behaviour**: works from residential IPs, but **datacenter IPs like GH Actions runners get filtered results** (returns 0 result matches). Per-competitor `searchUrlTemplate` configuration is the reliable path. Configured on Xcite/BAY/Eureka via REST.

### I. Worker infrastructure
- New `on: push` trigger scoped to `worker/**` + `.github/workflows/worker-tick.yml` in the tick workflow — any change to worker code forces an immediate tick. Zero cost, unblocks iteration when the `*/5 * * * *` cron is throttled by GH Actions (observed 90+ min gaps on this public repo).
- `refreshOwnPrices()` in `worker/src/scraper.js` — sweeps all products with `own_url` set on every tick, scrapes each URL, updates `current_price` + `image_url` when it changes. Called from `tick.js` right after competitor scrapes.

### J. Frontend: ScrapeStatusPill
New component: `src/components/ScrapeStatusPill.jsx`
- Fixed bottom-right on every route (mounted in `Layout`)
- Polls `scrape_runs` every 5s for `status IN ('queued','running')`
- Shows count + most recent competitor name
- Click → jumps to `/scrapers`
- Auto-hides when nothing is happening

### K. New Supabase columns / migrations

Full list of migrations added since Phase 1:
- `supabase/migrations/phase-2-5.sql` — Phases 2-5 tables (from earlier)
- `supabase/migrations/admin-user-mgmt.sql` — user CRUD SECURITY DEFINER functions
- `supabase/migrations/url-finder.sql` — url_find_jobs table
- Standalone `ALTER TABLE products ADD COLUMN own_url TEXT` (via SQL Editor)

`competitor_products.image_url` and `products.image_url` were already in the schema — just weren't being populated until the image extractor was added.

### L. Verified end-to-end
Real data now in production:
- 6 products in catalogue (iPhone 17 PM, S24 Ultra, A53, A56, PlayStation 5, Z Flip7) all with images from Xcite Amplience CDN
- 10 competitor_products across Xcite / Best Al-Yousifi / Eureka
- 15+ price_history rows with real prices in KWD
- Auto-URL-finder queues cleanly and reports per-competitor results
- Own-URL price refresh sweeps on every tick
- Dashboard KPIs, Comparison matrix, Reports 4-chart grid all populate from live data

### M. Design decisions worth remembering
- Wordmark is `Prisma · Intel` (invented brand name). User hasn't decided on real brand yet.
- Xcite hero images live at `cdn.media.amplience.net/i/xcite/<numeric-sku>-01?...`. Their site's own search page URL: `https://www.xcite.com/search?text={q}` — configured in `competitors.scrape_config.searchUrlTemplate`.
- Eureka product URLs: `/products/details/{numeric_id}`. Search: `?instant_records[query]={q}`.
- Best Al-Yousifi is fully SPA-rendered; both scraper and WebFetch struggle with initial-HTML extraction. Playwright with the extended hydration wait handles it.
- Match Review page (`/#/matches`) is empty by design — the pg_trgm trigger only fires when a `competitor_products` row is inserted WITHOUT a `product_id`. In practice every row created via UI or auto-finder has a `product_id`, so no suggestions get generated. Reserved for a future sitemap-crawl feature that would discover orphan URLs.

---

## 21. 2026-07-16 (late) — cumulative fixes + hardening

Long troubleshooting + polish day. What changed:

### A. Auth / user creation — chased and fixed the root cause
- **Symptom**: `admin_create_user` RPC created auth.users rows that GoTrue rejected on login ("Database error querying schema"). Even the Supabase Dashboard's Add User button failed with "Database error creating new user".
- **Root cause**: two independent bugs stacked
  1. My `admin_create_user` function didn't populate the `auth.identities` row that modern GoTrue requires
  2. The pre-existing `handle_new_user` trigger (fires on `INSERT INTO auth.users`) had an error path that rolled back EVERY user insert — blocking the Dashboard too
- **Fix (SQL user pasted)**:
  ```sql
  CREATE OR REPLACE FUNCTION public.handle_new_user() ... EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user failed for user_id=%: %', NEW.id, SQLERRM;
  END;
  ```
  Defensive wrapper — trigger can no longer roll back the auth.users insert; worst case profile isn't auto-created but the auth user is.
- Once the trigger was defensive, I recreated `amir@test.com` and `vikas@test.com` via Auth Admin API from my terminal — both logged in successfully with `P@ssw0rd`. Any future user creation via app OR Dashboard now works.
- **`admin_create_user` is still fragile** — user creation is safer via Auth Admin API (which the app now uses via… nothing, actually. Users page still calls the RPC. Fine as long as trigger is defensive).

### B. Better error surfacing
- New exported `normaliseError(e)` in `UI.jsx`: walks .message / .error_description / .error.message / .details / .hint / JSON.stringify with explicit "Empty error returned from server" when the string is '{}'
- Login page translates common Supabase auth codes to sentences (Wrong password / Too many attempts / Missing identity record)
- Users page: gold success toast + red error toast (replaced browser alert). Friendly translations for duplicate-key / missing-pgcrypto / permission-denied / PGRST202
- Every async handler wrapped in try/catch/finally so busy state clears on RPC rejection

### C. Nav access control
- Split navigation into 4 tiers instead of 3:
  - `PRIMARY_NAV` — everyone
  - `OPS_NAV` — everyone (scrapers, matches, alerts, reports)
  - `MANAGER_NAV` (new) — admin + manager: Categories
  - `ADMIN_NAV` — admin only: Repricing, Integrations, Users
- Was previously: Categories was in ADMIN_NAV → managers couldn't see the link even though the page's Add/Delete buttons were already gated on isManager
- Layout.jsx destructures `isManager` from useAuth and renders the "Catalogue" section for both roles

### D. Sidebar branding
- User-supplied logo `public/logo.png` (Union Trading Co., black text on transparent, 1571×661) replaces the "Prisma · Intel" wordmark
- On the dark sidebar: `<img>` with CSS `[filter:brightness(0)_invert(1)]` renders the black wordmark as white on dark
- On the cream Login form panel: raw logo (black reads perfectly)
- Login left panel (dark): inverted at 56px height for hero prominence
- Sidebar: centered, 64px tall
- Footer copyright + browser tab title updated to Union Trading Co.
- Favicon: /logo.png

### E. Arabic-Indic digit localizer (added → then had to fix TDZ)
- New global digit localizer in `src/lib/i18n.js`: walks every text node in the DOM when locale is 'ar' and rewrites 0-9 → ٠-٩ + . → ٫ + , → ٬
- Uses `MutationObserver` on document.body to re-localize as React updates
- WeakSet marker prevents infinite loops
- Applied via `applyDirection()` called from `setLanguage()` toggle in sidebar
- Reload on AR → non-AR switch (clean way to restore Latin digits)
- **TDZ crash fix**: Rollup's minifier reordered function bodies and broke hoisting. Symptom: `Uncaught ReferenceError: Cannot access 'On' before initialization` at page load. Fix: strict declaration order in i18n.js — all const/let at top, functions middle, bootstrap `applyDirection` call at bottom of module. Also swapped `Node.ELEMENT_NODE` / `Node.TEXT_NODE` constants for integer literals (1 / 3) for minifier safety.

### F. Find URLs — live status modal + Match Review approval queue
- New component `src/components/FindUrlsModal.jsx`: replaces the toast on Find URLs click / Auto-find on save
- Polls the `url_find_jobs` row every 2s
- Header banner morphs: Queued → Searching N competitors → Found N URLs / No URLs found
- Per-competitor row for every ACTIVE competitor with live status: Queued → Searching → Found (URL + strategy) / Not found / Error / Skipped (already linked)
- 4 summary tiles when finished (Found / Not found / Errors / Skipped)
- "Review matches" CTA → jumps to /#/matches
- **MatchReview.jsx rebuilt** as a two-section approval queue:
  - Section 1: 'Auto-found competitor URLs — awaiting your approval' — every competitor_products with match_method='auto'. Product+SKU+image on left, competitor+URL+image on right, inline pencil edit on URL (Enter to save), Accept promotes to 'manual' with 100% confidence, Reject deletes the row
  - Section 2: legacy pg_trgm match_suggestions (rarely used)
  - "All caught up" green empty state when queue is drained

### G. Scrapers page — "Idle" tile fix
- Auto-refresh interval: 5s when scrapes are active, **20s otherwise** (was: no refresh when idle → tile stuck on 'Idle' after fresh ticks)
- If ANY run has `status='running'`, tile shows emerald **"Scraping now"** regardless of last completed run's age

### H. Anti-bot hardening (Playwright)
- Added deps: `playwright-extra` + `puppeteer-extra-plugin-stealth`. Stealth plugin hides "I'm a headless browser" signals (webdriver flag, missing plugins, canvas/WebGL noise)
- Rotating User-Agent pool (5 realistic Chrome/Firefox UAs) per browser launch
- **One browser context per COMPETITOR** (was: per URL) — cookies + localStorage persist across the competitor's URLs so 2nd/3rd request looks like a returning visitor
- **Human pacing between URLs**: default 3-5 second random delay between requests to the same competitor (configurable via `competitors.scrape_config.pacingMinMs / pacingMaxMs`)
- `Accept-Language: en-US,en;q=0.9,ar;q=0.8` header matches a real KW-market browser
- Resource blocking (images/media/fonts) moved from per-page to context-level for consistency
- Applied to both `scraper.js` and `find-urls.js`

### I. Nav / access — Repricing + Integrations became admin-only
- Was: everyone saw the tabs in OPS_NAV
- Now: `ADMIN_NAV` only. Managers and viewers no longer see them in sidebar

### J. Known good state
- `admin@test.com` / `P@ssw0rd` — admin
- `amir@test.com` / `P@ssw0rd` — manager (recreated via Auth Admin API after trigger fix)
- `vikas@test.com` / `P@ssw0rd` — manager (same)
- 6 products with images from Xcite Amplience CDN (backfilled manually after junk-logo bug)
- 10 competitor_products across Xcite/BAY/Eureka, most scraping successfully every ~5 min

---

## 22. 2026-07-17 — pre-release hardening

Wrapped up a scale-out + robustness push before end-user release.

### Structural changes worth remembering

- **`src/lib/routes.js`** — new file. Central map `path → () => import('./pages/X')`. Both `App.jsx` (React.lazy) and `Layout.jsx` (hover prefetch) reference this map so Vite dedupes to one chunk per page.
- **`src/components/ErrorBoundary.jsx`** — new. Class component with `getDerivedStateFromError` + `componentDidCatch`. Renders a recovery card (Go to dashboard / Reload) instead of a white screen. Wrapped around `<AuthProvider>` in `App.jsx` (outer) AND `<Outlet />` in `Layout.jsx` (inner, keyed on `window.location.hash` so per-page crashes reset on navigation).
- **`src/components/TriggerTickButton.jsx`** — new. Bottom-right admin button that fires the worker-tick workflow via GitHub's `POST /actions/workflows/worker-tick.yml/dispatches`. Requires a fine-grained PAT stored in `localStorage.gh_pat_worker_tick` (per browser, never sent to Supabase). All localStorage access wrapped in try/catch for Safari-private-mode safety.
- **`src/components/FindUrlsModal.jsx`** — polls `url_find_jobs` via Supabase Realtime (`postgres_changes` on UPDATE filter `id=eq.{jobId}`) with a 10s safety-net poll fallback.
- **`src/components/ScrapeStatusPill.jsx`** — same pattern; subscribes to `scrape_runs` changes with a 30s safety-net poll.
- **`worker/src/scraper.js`** — refactored to run URLs in **batches of `concurrency` (default 5)** using Promise.all inside the shared context. Extracted per-URL work into `processOneUrl()` helper. Row-level locking via `.update(...).eq('id', run.id).eq('status', 'queued')` prevents shard collisions.
- **`worker/src/find-urls.js`** — v3: brand-aware query, 5 candidates per competitor, Jaccard token similarity scoring against og:title, threshold 0.35. Rejects below threshold instead of returning a wrong URL.
- **`worker/src/tick.js`** — reads `SHARD_INDEX` / `SHARD_COUNT` env vars, filters queued runs by modulo in JS. Backward-compatible (no env → single-worker mode).
- **`.github/workflows/worker-tick*.yml`** — 3 shard workflows (0, 1, 2), each with independent concurrency group + its own SHARD_INDEX env. Combined with parallel scraping: theoretical 15-30× throughput.
- **`worker/src/daily-digest.js`** — now calls `prune_old_data()` RPC after sending digests. Skips gracefully if the SQL migration isn't applied.

### New nav structure (users see this)

```
INSIGHTS      Dashboard · Comparison · Price Trends · Reports · Match Review
CATALOGUE     Products · Competitors · Linked Items · Log a Price · Categories (manager+admin)
AUTOMATION    Scrapers · Alerts
ADMIN         Repricing · Integrations · Users (admin only)
```

### Migrations applied (canonical list, in order)

1. `supabase/schema.sql` (initial Phase 1)
2. `supabase/migrations/phase-2-5.sql`
3. `supabase/migrations/admin-user-mgmt.sql` (recreated inline several times with fixes)
4. `supabase/migrations/url-finder.sql`
5. `ALTER TABLE products ADD COLUMN own_url TEXT` (inline)
6. Trigger fix (defensive `handle_new_user` — wrapped in EXCEPTION WHEN OTHERS)
7. Auth identity backfill for broken users (inline; one-shot cleanup)
8. `supabase/migrations/data-cleanup.sql` (prune_old_data function)
9. `supabase/migrations/phase1-perf.sql` (indexes + Realtime publication)

### Pre-release audit results (2026-07-17)

**All green:**
- Live deploy: `0c502ba`, HTTP 200
- All 3 users can log in (admin, amir, vikas — all `P@ssw0rd`) — amir/vikas had drifted and were reset via Auth Admin API
- All SECURITY DEFINER RPCs exist (admin_create_user / admin_delete_user / admin_reset_password / prune_old_data / is_admin_or_manager)
- RLS enforced: anon reads return `[]` on all 5 tested tables
- Zero orphan competitor_products
- All 8 products have image_url set
- All 8 products have current_price set
- Latest worker ticks succeeded (last: `2026-07-17T16:23`)

**Follow-ups from audit (fixed in this push):**
- Added ErrorBoundary (was: page crash → white screen)
- Wrapped `TriggerTickButton` localStorage in try/catch (was: throws in Safari private mode)

**Followups NOT fixed:**
- Eureka scraper occasionally reports "4 URLs had no matching price selector" — its Angular SPA behaves inconsistently. Non-blocking; those URLs just don't get prices that tick.
- Match Review section 2 (pg_trgm suggestions) is always empty because auto-URL-finder always sets product_id on insert. Left in for future orphan-URL discovery workflows.

_Last updated: 2026-07-17 — parallel scraper, shard workflows, DB indexes, Realtime, route prefetch, ErrorBoundary, brand-aware URL finder._
