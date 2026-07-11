-- ============================================================
-- PRICE COMPETITOR APP — Phase 1 schema
-- ============================================================
-- Run this ONCE on a fresh Supabase project (SQL Editor).
--
-- After running:
--   1. Auth → Providers → Email → "Confirm email" OFF
--   2. Create your admin user: Auth → Users → Add User
--      Then: UPDATE profiles SET role='admin' WHERE email='you@yourco.com';
--   3. Paste Supabase URL + anon key into src/supabaseClient.js
-- ============================================================


-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── Helper: bump updated_at on every UPDATE ──────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;


-- ═══════════════════════════════════════════════════════════
-- 1. PROFILES + AUTH GLUE
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT        DEFAULT '',
  full_name   TEXT        DEFAULT '',
  role        TEXT        NOT NULL DEFAULT 'viewer'
                          CHECK (role IN ('admin', 'manager', 'viewer')),
  avatar_url  TEXT,
  locale      TEXT        DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-create profile row when a new auth user is created.
CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1))
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- Auto-confirm email so users can log in immediately after creation
-- (belt-and-braces alongside the Dashboard "Confirm Email OFF" toggle).
CREATE OR REPLACE FUNCTION auto_confirm_auth_user()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.email_confirmed_at IS NULL THEN
    NEW.email_confirmed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS auto_confirm_auth_user_trigger ON auth.users;
CREATE TRIGGER auto_confirm_auth_user_trigger
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION auto_confirm_auth_user();


-- ═══════════════════════════════════════════════════════════
-- 2. REFERENCE DATA — currencies + categories
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS currencies (
  code          TEXT       PRIMARY KEY,           -- 'USD', 'KWD'
  name          TEXT       NOT NULL,
  symbol        TEXT,
  rate_to_base  NUMERIC(14,6) DEFAULT 1,          -- filled by Phase 2 FX job
  base          BOOLEAN    DEFAULT FALSE,         -- exactly one row = TRUE
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO currencies (code, name, symbol, base) VALUES
  ('KWD', 'Kuwaiti Dinar', 'د.ك', TRUE),
  ('USD', 'US Dollar',     '$',   FALSE),
  ('EUR', 'Euro',          '€',   FALSE),
  ('GBP', 'British Pound', '£',   FALSE),
  ('SAR', 'Saudi Riyal',   'ر.س', FALSE),
  ('AED', 'UAE Dirham',    'د.إ', FALSE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS categories (
  id          BIGSERIAL   PRIMARY KEY,
  parent_id   BIGINT      REFERENCES categories(id) ON DELETE SET NULL,
  name        TEXT        NOT NULL,
  slug        TEXT        UNIQUE,
  sort_order  INTEGER     DEFAULT 0,
  is_active   BOOLEAN     DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
DROP TRIGGER IF EXISTS categories_updated_at ON categories;
CREATE TRIGGER categories_updated_at BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);


-- ═══════════════════════════════════════════════════════════
-- 3. PRODUCTS (your own catalogue)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id             BIGSERIAL   PRIMARY KEY,
  sku            TEXT        UNIQUE NOT NULL,
  name           TEXT        NOT NULL,
  brand          TEXT,
  category_id    BIGINT      REFERENCES categories(id) ON DELETE SET NULL,
  description    TEXT,
  image_url      TEXT,
  cost_price     NUMERIC(14,4),                  -- what you paid for it
  min_price      NUMERIC(14,4),                  -- absolute floor (repricing rule guard)
  target_margin  NUMERIC(5,2),                   -- e.g. 25.00 for 25% margin
  current_price  NUMERIC(14,4),                  -- your live selling price
  currency_code  TEXT        DEFAULT 'KWD' REFERENCES currencies(code),
  attributes     JSONB       DEFAULT '{}'::jsonb, -- {"size":"1.5L","color":"red"}
  is_active      BOOLEAN     DEFAULT TRUE,
  is_own_brand   BOOLEAN     DEFAULT FALSE,      -- true → category-wise comparison
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active) WHERE is_active;

DROP TRIGGER IF EXISTS products_updated_at ON products;
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════
-- 4. COMPETITORS (the sites you monitor)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS competitors (
  id             BIGSERIAL   PRIMARY KEY,
  name           TEXT        NOT NULL,
  domain         TEXT        UNIQUE NOT NULL,    -- 'competitor.com'
  country        TEXT,                           -- 'KW', 'SA', 'AE'
  logo_url       TEXT,
  scrape_config  JSONB       DEFAULT '{}'::jsonb, -- Phase 2: selectors, headers
  notes          TEXT,
  is_active      BOOLEAN     DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitors_active ON competitors(is_active) WHERE is_active;

DROP TRIGGER IF EXISTS competitors_updated_at ON competitors;
CREATE TRIGGER competitors_updated_at BEFORE UPDATE ON competitors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════
-- 5. COMPETITOR_PRODUCTS (their SKUs, linked to yours)
-- ═══════════════════════════════════════════════════════════
-- product_id is nullable: unlinked competitor items still get scraped
-- and can be manually or auto-matched later.
CREATE TABLE IF NOT EXISTS competitor_products (
  id                 BIGSERIAL   PRIMARY KEY,
  competitor_id      BIGINT      NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  product_id         BIGINT      REFERENCES products(id) ON DELETE SET NULL,
  competitor_sku     TEXT,
  name               TEXT        NOT NULL,
  url                TEXT        NOT NULL,
  image_url          TEXT,
  category_id        BIGINT      REFERENCES categories(id) ON DELETE SET NULL,
  variant_group_id   BIGINT,                      -- Phase 2: groups size/colour variants
  match_method       TEXT        DEFAULT 'manual'
                                CHECK (match_method IN ('manual','auto','category','none')),
  match_confidence   NUMERIC(3,2),                -- 0.00-1.00 for auto matches
  attributes         JSONB       DEFAULT '{}'::jsonb,
  is_active          BOOLEAN     DEFAULT TRUE,
  last_seen_at       TIMESTAMPTZ,                 -- last successful scrape
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cp_competitor_url ON competitor_products(competitor_id, url);
CREATE INDEX IF NOT EXISTS idx_cp_product     ON competitor_products(product_id);
CREATE INDEX IF NOT EXISTS idx_cp_category    ON competitor_products(category_id);
CREATE INDEX IF NOT EXISTS idx_cp_active      ON competitor_products(is_active) WHERE is_active;

DROP TRIGGER IF EXISTS competitor_products_updated_at ON competitor_products;
CREATE TRIGGER competitor_products_updated_at BEFORE UPDATE ON competitor_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ═══════════════════════════════════════════════════════════
-- 6. PRICE_HISTORY (time-series)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS price_history (
  id                     BIGSERIAL   PRIMARY KEY,
  competitor_product_id  BIGINT      NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
  price                  NUMERIC(14,4) NOT NULL,
  currency_code          TEXT        REFERENCES currencies(code),
  price_type             TEXT        DEFAULT 'regular'
                                     CHECK (price_type IN ('regular','sale','clearance')),
  original_price         NUMERIC(14,4),           -- crossed-out price when on sale
  source                 TEXT        DEFAULT 'manual'
                                     CHECK (source IN ('manual','scrape','import')),
  scrape_run_id          UUID,                    -- Phase 2: links to scrape_runs
  captured_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ph_cp_captured ON price_history(competitor_product_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_ph_captured    ON price_history(captured_at DESC);


-- ═══════════════════════════════════════════════════════════
-- 7. STOCK_HISTORY (time-series)
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS stock_history (
  id                     BIGSERIAL   PRIMARY KEY,
  competitor_product_id  BIGINT      NOT NULL REFERENCES competitor_products(id) ON DELETE CASCADE,
  in_stock               BOOLEAN     NOT NULL,
  stock_note             TEXT,                    -- "Only 3 left" / "Ships in 5 days"
  source                 TEXT        DEFAULT 'manual'
                                     CHECK (source IN ('manual','scrape')),
  scrape_run_id          UUID,
  captured_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sh_cp_captured ON stock_history(competitor_product_id, captured_at DESC);


-- ═══════════════════════════════════════════════════════════
-- 8. ROW LEVEL SECURITY (RBAC)
-- ═══════════════════════════════════════════════════════════
-- Model: any authenticated user READS all data. Only 'admin' or
-- 'manager' roles can WRITE. 'viewer' is read-only.
-- profiles: everyone reads all rows; users update their own row;
-- admins update anyone's role.

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE currencies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_history       ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user admin or manager?
CREATE OR REPLACE FUNCTION is_admin_or_manager()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role IN ('admin','manager')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles: all authenticated read; self-update; admin-update-anyone
CREATE POLICY p_profiles_read ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_profiles_self_update ON profiles FOR UPDATE
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY p_profiles_admin_update ON profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

-- Read for every authenticated user on all data tables
CREATE POLICY p_currencies_read ON currencies FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_categories_read ON categories FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_products_read ON products FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_competitors_read ON competitors FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_cp_read ON competitor_products FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_ph_read ON price_history FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY p_sh_read ON stock_history FOR SELECT
  USING (auth.role() = 'authenticated');

-- Write policies (admin + manager only) — INSERT/UPDATE/DELETE via FOR ALL
CREATE POLICY p_categories_write         ON categories         FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_products_write           ON products           FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_competitors_write        ON competitors        FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_cp_write                 ON competitor_products FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_ph_write                 ON price_history       FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_sh_write                 ON stock_history       FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
CREATE POLICY p_currencies_write         ON currencies          FOR ALL
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());


-- ════════════════════════════════════════════════════════════
-- DONE ✅
--
-- Tables created:
--   profiles, currencies, categories,
--   products, competitors, competitor_products,
--   price_history, stock_history
--
-- Triggers installed:
--   on_auth_user_created            — auto-create profiles row
--   auto_confirm_auth_user_trigger  — auto-confirm email
--   *_updated_at                    — bump updated_at on every UPDATE
--
-- Next steps in Supabase Dashboard:
--   1. Auth → Providers → Email → "Confirm Email" OFF
--   2. Auth → Users → Add user (your admin email + password)
--      Then: UPDATE profiles SET role='admin' WHERE email='you@yourco.com';
--   3. Paste URL + anon key into src/supabaseClient.js (lines 5-6)
--
-- Future migrations (Phase 2+) will add:
--   scrape_runs, scrape_jobs, alerts, alert_rules,
--   repricing_rules, dynamics365_sync_log, integrations, etc.
-- ════════════════════════════════════════════════════════════
