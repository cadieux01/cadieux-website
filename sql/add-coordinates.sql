-- Migration: add GPS coordinates to addresses and orders
-- Columns are nullable so all existing rows remain valid.
-- Apply once via the Supabase SQL editor (Dashboard → SQL Editor → Run).

alter table addresses
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;

alter table orders
  add column if not exists latitude  double precision,
  add column if not exists longitude double precision;
