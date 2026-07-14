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

-- Addresses (multi-address per customer — SHARED between website + mobile app)
-- The mobile app (/api/mobile/addresses) and the website
-- (/api/customer-addresses) both read/write these same rows keyed on
-- customer_id. Label is free text (1-40 chars), unique per customer.
-- First insert for a customer auto-defaults; MAX 20 rows/customer.
CREATE TABLE addresses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,          -- free text, e.g. "Home", "Work", "Mom's place"
  full_name         TEXT NOT NULL,
  phone             TEXT,                   -- 10-digit local; nullable
  line1             TEXT NOT NULL,          -- flat / house no, street
  area              TEXT NOT NULL,          -- neighbourhood / locality
  city              TEXT NOT NULL,
  pincode           TEXT NOT NULL,          -- 6 digits
  is_default        BOOLEAN NOT NULL DEFAULT false,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- One default per customer.
CREATE UNIQUE INDEX addresses_one_default_per_customer_idx
  ON addresses(customer_id) WHERE is_default = true;
-- Case-insensitive unique label per customer (duplicate-label guard).
CREATE UNIQUE INDEX addresses_unique_label_per_customer_idx
  ON addresses(customer_id, lower(label));
CREATE INDEX addresses_customer_id_idx
  ON addresses(customer_id);

-- Orders
-- Cancellation columns (cancelled_at, cancellation_reason, refund_status)
-- support the 1-hour customer-cancel window. See
-- src/lib/order-cancellation.ts and /api/mobile/orders/[id]/cancel.
-- delivery_address stores the full "[Label] line1, area, city - pincode"
-- string as a point-in-time snapshot — orders never dereference the
-- shared address book, so editing/deleting an address after an order
-- ships is safe.
CREATE TABLE orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID REFERENCES customers(id),
  total_amount          DECIMAL(10, 2),   -- inclusive of delivery_fee
  delivery_fee          DECIMAL(10, 2) NOT NULL DEFAULT 50,
  status                TEXT DEFAULT 'pending',
  delivery_address      TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  cancelled_at          TIMESTAMPTZ,
  cancellation_reason   TEXT,
  refund_status         TEXT CHECK (refund_status IN ('pending', 'processed', 'failed'))
);

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
