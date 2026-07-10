# Price Competitor App

A Prisync/Price2Spy-style tool for tracking competitor prices + stock, matching products, running rule-based repricing, and pushing changes into Microsoft Dynamics 365.

**Status**: Phase 0 — scaffold. `npm run dev` boots the shell.

## Quick start

```bash
npm install
npm run dev
# opens on http://localhost:5173
```

## What's in this scaffold

- React 18 + Vite + Tailwind CSS
- react-router-dom for routing
- Supabase client wired (URL/key are placeholders — see `src/supabaseClient.js`)
- Auth context stub (`src/lib/auth.js`) with the sign-in / sign-out API
- Sidebar layout + placeholder pages for every planned feature so the roadmap is visible in the UI

Nothing on any page is real data yet.

## Roadmap

| Phase | Scope | Rough estimate |
|---|---|---|
| **0** — done | Scaffold + first push | this session |
| **1** | Supabase schema (products, competitors, price_history, RBAC) + manual entry + basic dashboard | ~2 wks |
| **2** | Playwright scraper worker for 1–2 pilot sites; Redis + BullMQ queue; anti-bot; Arabic RTL | ~2–3 wks |
| **3** | Product matching (manual + auto) + Resend email alerts + digest logic | ~2 wks |
| **4** | Configurable dashboard widgets + custom report builder + exports | ~3 wks |
| **5** | Repricing rule engine + approval queue + **Dynamics 365** + Shopify/WooCommerce/BigCommerce/Magento + Google Analytics | ~3–4 wks |

Total: 3–6 months of build time to a full-fat Prisync equivalent for a small team.

## Recommended production stack

| Layer | Phase 0–1 (now) | Phase 2+ (once scraping / API needed) |
|---|---|---|
| Frontend | **GitHub Pages** (this repo, auto-deploys on push to `main`) | Same, or move to Vercel |
| DB + Auth | Supabase (Postgres + RLS) | Same |
| Scraper worker | — | Playwright on Railway or Render |
| Queue | — | BullMQ + Upstash Redis |
| Proxy | — | ScraperAPI or Bright Data |
| Email | — | Resend |
| API layer | — | Vercel serverless functions or a Fastify app on Railway |

GitHub Pages hosts the static React app fine for Phases 0–1 (auth, product entry, dashboards read from Supabase). Once we start scraping in Phase 2, we'll add a separate worker service (GitHub Pages can't run cron jobs). Not a one-way door.

## Deploy

Pushes to `main` auto-deploy via GitHub Actions → `gh-pages` branch → Pages.

Live URL (once GitHub Pages is enabled): <https://utcebs.github.io/Pricing-competitor-app/>

**First-time GitHub Pages setup**: after the first push, go to the repo's **Settings → Pages** → Source: **Deploy from a branch**, Branch: **`gh-pages`**, folder: **`/ (root)`** → Save. The workflow creates the `gh-pages` branch on its first successful run.

## Next steps for you

1. Create the Supabase project. Copy `URL` + `anon key` from Dashboard → Settings → API.
2. Paste into `src/supabaseClient.js` (lines 5–6).
3. Turn OFF email confirmations: Dashboard → Auth → Providers → Email → Confirm email OFF.
4. Enable GitHub Pages (see Deploy section above).
5. Ready for Phase 1 — tell me and I'll ship the schema + auth + first CRUD pages.

## Repo

<https://github.com/utcebs/Pricing-competitor-app>
