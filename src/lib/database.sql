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

-- Enable Row Level Security
ALTER TABLE customers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE blog_posts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_locations ENABLE ROW LEVEL SECURITY;
