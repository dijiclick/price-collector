CREATE TABLE IF NOT EXISTS products (
  id                  SERIAL PRIMARY KEY,
  brand               TEXT NOT NULL,
  external_id         TEXT NOT NULL,
  name                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  image_url           TEXT,
  category            TEXT,
  product_type        TEXT,
  variants            JSONB,
  group_key           TEXT,
  color_name          TEXT,
  current_price       INTEGER NOT NULL,
  current_list_price  INTEGER,
  currency            TEXT NOT NULL DEFAULT 'TRY',
  in_stock            BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, external_id)
);

-- Fingerprint of the last-written mutable payload. The collector compares it
-- before writing: a run that finds a product unchanged (the common case — Beymen
-- reports ~43.5k products and 2 real changes) only needs its last_seen bumped,
-- not a 16-column rewrite. Nullable so existing rows simply look "changed" once.
ALTER TABLE products ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Second taxonomy level under the big types (Pantolon/Etek/Jean under "alt").
-- Classified from the name like product_type, because the brands' own category
-- field cannot carry a taxonomy — see PRODUCT_SUBTYPES in lib/productTypes.ts.
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_subtype TEXT;
CREATE INDEX IF NOT EXISTS products_subtype_idx ON products(product_subtype);

-- Barcodes printed on the physical tags (EAN-13/UPC). An ARRAY because brands
-- issue one per size — a shopper scans the tag of the size in their hand, not a
-- product-level code. Null where the brand publishes none; those resolve by
-- article number instead. GIN so `$1 = ANY(barcodes)` stays indexed.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcodes TEXT[];
CREATE INDEX IF NOT EXISTS products_barcodes_idx ON products USING GIN (barcodes);

CREATE TABLE IF NOT EXISTS snapshots (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price       INTEGER NOT NULL,
  list_price  INTEGER,
  in_stock    BOOLEAN NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_product_ts ON snapshots(product_id, ts DESC);

CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  old_price   INTEGER,
  new_price   INTEGER NOT NULL,
  pct         INTEGER,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);

CREATE TABLE IF NOT EXISTS subscribers (
  email       TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS watchlist (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (email, product_id)
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS notified_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_type TEXT;
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type);
ALTER TABLE products ADD COLUMN IF NOT EXISTS variants JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS group_key TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_name TEXT;
CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_key);

-- Push notifications (device tokens + per-device watchlist; v1.1)
CREATE TABLE IF NOT EXISTS push_devices (
  token       TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Which language to write this device's notifications in. Nullable: devices
-- that synced before this shipped keep arriving without it, and null means
-- Turkish, which is what they were already being sent.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS lang TEXT;
-- The language a person reads, for the copy WE write: pushes and alert emails.
-- On subscribers rather than watchlist because it belongs to the person, not to
-- each product they watch. NULL is "never told us" and means Turkish, which is
-- what every existing row was already receiving.
ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS lang TEXT;

CREATE TABLE IF NOT EXISTS push_watch (
  token       TEXT NOT NULL REFERENCES push_devices(token) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target      INTEGER,
  PRIMARY KEY (token, product_id)
);

-- Size the user cares about (colour is already the product row). Nullable; used
-- to annotate drop alerts and drive back-in-stock notifications.
ALTER TABLE push_watch ADD COLUMN IF NOT EXISTS size TEXT;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS size TEXT;
-- Target price (minor units): when set, only alert once the price is at/below it.
-- push_watch already has `target`; mirror it on the email watchlist.
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS target INTEGER;
-- On a back_in_stock event, which size returned (null = the whole product).
ALTER TABLE events ADD COLUMN IF NOT EXISTS size TEXT;

ALTER TABLE events ADD COLUMN IF NOT EXISTS push_notified_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_push_watch_product ON push_watch (product_id);

-- Gender segment, stamped by adapters at crawl time ('kadin'|'erkek'|'cocuk';
-- NULL = unknown/unisex — cosmetics brands mostly). The stored category text
-- can't recover this (it holds product types / collection names), so only the
-- adapter, which knows which section tree it walked, can set it.
ALTER TABLE products ADD COLUMN IF NOT EXISTS gender TEXT;
CREATE INDEX IF NOT EXISTS idx_products_gender ON products (gender) WHERE gender IS NOT NULL;

-- Optional accounts. Everything in the app works without one; signing in only
-- unties the tracked list from a single phone, so nothing here is on the read
-- path for products, prices or charts.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT,
  provider      TEXT NOT NULL,
  -- The provider's stable subject id, and the real join key: a person can change
  -- the email on their Google account, and Apple hands out a relay address that
  -- changes if they unlink and re-link. Matching on email would strand them.
  provider_sub  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_sub)
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- The tracked list, once it belongs to an account rather than a device.
CREATE TABLE IF NOT EXISTS user_watch (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  target      INTEGER,
  size        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- One-time email sign-in codes.
--
-- Only the HASH is stored, exactly as for sessions: a leaked table must not be
-- a set of working codes. `attempts` is what makes a 6-digit secret safe — a
-- million guesses is nothing over HTTP, so the row dies after a handful of
-- wrong tries rather than relying on the code's length.
CREATE TABLE IF NOT EXISTS email_codes (
  email       TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  -- Send throttling lives here rather than in a separate table: one row per
  -- address already exists, and re-sending overwrites it.
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sends       INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS email_codes_expiry_idx ON email_codes(expires_at);
