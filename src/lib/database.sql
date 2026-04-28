-- Cadieux Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → paste → Run

-- Customers
CREATE TABLE customers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE,
  full_name     TEXT,
  phone         TEXT,
  city          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Orders
CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id      UUID REFERENCES customers(id),
  total_amount     DECIMAL(10, 2),
  status           TEXT DEFAULT 'pending',
  delivery_address TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
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

-- Reviews (per-product or general feedback)
CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_slug  TEXT,                       -- 'multigrain' | 'plain' | NULL (general feedback)
  author_name   TEXT NOT NULL,
  rating        SMALLINT,                   -- 1..5; NULL allowed for general feedback
  body          TEXT NOT NULL,
  likes_count   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
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
  created_at   TIMESTAMPTZ DEFAULT now()
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
