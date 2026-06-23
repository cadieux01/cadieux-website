-- Cadieux Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → paste → Run

-- Customers
-- push_token is the Expo push token (ExponentPushToken[xxx]) the mobile
-- app registers on each launch. One token per customer — re-registration
-- overwrites any previous value. Cleared by the server when Expo reports
-- the token is invalid/expired (DeviceNotRegistered).
CREATE TABLE customers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             TEXT UNIQUE,
  full_name         TEXT,
  phone             TEXT,
  city              TEXT,
  age_verified_at   TIMESTAMPTZ,
  push_token        TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Migration for existing deployments (run once):
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Customer Addresses (multi-address per customer)
-- Replaces the single address model where delivery_address was stored in orders.
-- Each customer can have multiple labeled addresses (Home/Work/Other) with one marked default.
CREATE TABLE customer_addresses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label             TEXT NOT NULL CHECK (label IN ('home', 'work', 'other')),
  address_line      TEXT NOT NULL,
  city              TEXT NOT NULL,
  state             TEXT,
  pincode           TEXT,
  is_default        BOOLEAN DEFAULT false NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),

  -- Ensure only one default per customer
  CONSTRAINT one_default_per_customer UNIQUE (customer_id, is_default) WHERE is_default = true
);

CREATE INDEX customer_addresses_customer_id_idx
  ON customer_addresses(customer_id);
CREATE INDEX customer_addresses_default_idx
  ON customer_addresses(customer_id, is_default);

-- Orders
-- Cancellation columns (cancelled_at, cancellation_reason, refund_status)
-- support the 1-hour customer-cancel window. See
-- src/lib/order-cancellation.ts and /api/mobile/orders/[id]/cancel.
-- delivery_address is kept for backwards-compatibility (stores full address string).
-- customer_address_id references customer_addresses for multi-address model (nullable during transition).
CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID REFERENCES customers(id),
  customer_address_id   UUID REFERENCES customer_addresses(id) ON DELETE SET NULL,
  total_amount          DECIMAL(10, 2),   -- inclusive of delivery_fee
  delivery_fee          DECIMAL(10, 2) NOT NULL DEFAULT 50,
  status                TEXT DEFAULT 'pending',
  delivery_address      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  refund_status         TEXT CHECK (refund_status IN ('pending', 'processed', 'failed'))
);

CREATE INDEX orders_customer_address_id_idx
  ON orders(customer_address_id);

-- Blog Posts
CREATE TABLE blog_posts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  content     TEXT,
  slug        TEXT UNIQUE,
  published   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Store Locations
CREATE TABLE store_locations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT,
  address    TEXT,
  city       TEXT,
  latitude   DECIMAL(9, 6),
  longitude  DECIMAL(9, 6),
  phone      TEXT,
  active     BOOLEAN DEFAULT true
);

-- Subscriptions (recurring bread deliveries)
CREATE TABLE subscriptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bread_slug        TEXT,
  bread_name        TEXT,
  bread_price       DECIMAL(10, 2),
  weeks             INT,
  days              TEXT[],          -- e.g. {'mon','wed','fri'}
  slot_mode         TEXT,            -- 'same' | 'custom'
  slot              TEXT,            -- set when slot_mode = 'same'
  slots_by_day      JSONB,           -- set when slot_mode = 'custom', e.g. {"mon":"6:00 – 8:00 AM"}
  total             DECIMAL(10, 2),
  customer_name     TEXT,
  customer_phone    TEXT,
  customer_address  TEXT,
  customer_city     TEXT,
  customer_pincode  TEXT,
  status            TEXT DEFAULT 'pending',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Per-delivery rows for a subscription. Generated on subscription creation,
-- one row per (week × day). Status moves Pending → Confirmed → Dispatched → Delivered.
CREATE TABLE subscription_deliveries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id   UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  sequence          INT NOT NULL,        -- 1..N across the whole plan
  week_number       INT NOT NULL,        -- 1..weeks
  day_key           TEXT NOT NULL,       -- 'mon'|'tue'|...
  slot              TEXT,                -- '6:00 – 8:00 AM'
  delivery_date     DATE NOT NULL,       -- concrete calendar date computed at creation
  status            TEXT NOT NULL DEFAULT 'pending',
  status_updated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX subscription_deliveries_sub_id_idx
  ON subscription_deliveries(subscription_id, sequence);
ALTER TABLE subscription_deliveries ENABLE ROW LEVEL SECURITY;

-- Reviews (per-product or general feedback)
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug  TEXT,                       -- 'multigrain' | 'plain' | NULL (general feedback)
  author_name   TEXT NOT NULL,
  rating        SMALLINT,                   -- 1..5; NULL allowed for general feedback
  body          TEXT NOT NULL,
  likes_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  edited_at     TIMESTAMPTZ
);
CREATE INDEX reviews_product_slug_idx ON reviews(product_slug);
CREATE INDEX reviews_created_at_idx   ON reviews(created_at DESC);

-- Replies under each review (one level deep, anyone can post)
CREATE TABLE review_replies (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id    UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  author_name  TEXT NOT NULL,
  is_admin     BOOLEAN NOT NULL DEFAULT false,
  body         TEXT NOT NULL,
  likes_count  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  edited_at    TIMESTAMPTZ
);
CREATE INDEX review_replies_review_id_idx ON review_replies(review_id);

-- Enable Row Level Security
ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_replies  ENABLE ROW LEVEL SECURITY;

-- Public read access for reviews + replies; all writes go via service-role API routes
CREATE POLICY "reviews public read" ON reviews        FOR SELECT USING (true);
CREATE POLICY "replies public read" ON review_replies FOR SELECT USING (true);
