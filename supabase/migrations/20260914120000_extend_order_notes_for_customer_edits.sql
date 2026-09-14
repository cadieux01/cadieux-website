-- Extend public.order_notes to carry customer-visible edit entries.
--
-- APPLIED DIRECTLY TO PROD 2026-09-14. This file is the repo mirror so
-- a fresh clone can reproduce the same shape via `supabase db reset`,
-- and so a future audit can grep the migrations tree without having to
-- pull DDL out of the live schema. Running it against an environment
-- where the change is already present is a no-op — every statement is
-- guarded.
--
-- Adds:
--   * order_notes.customer_visible boolean not null default false
--   * order_notes.meta             jsonb
--   * kind CHECK widened to include 'edit'
--
-- Rationale:
--   - customer_visible gates which rows render on /orders/[id]. Prior
--     rows ('note' + 'call') stay hidden by default so nothing existing
--     turns customer-facing retroactively; kind='edit' rows are always
--     written with customer_visible=true.
--   - meta carries { before, after } snapshots of just the changed
--     fields for edit rows — human-readable context, not the forensic
--     trail. The full-row before/after audit already exists via
--     trg_audit_orders -> logistics.capture_public_audit, and that
--     stays authoritative.
--
-- RLS remains enabled with 0 policies. Every reader and writer of
-- order_notes still goes through supabaseAdmin (service role).

alter table public.order_notes
  add column if not exists customer_visible boolean not null default false;

alter table public.order_notes
  add column if not exists meta jsonb;

-- The kind CHECK is dropped + re-added because ALTER cannot widen an
-- existing check in place. The constraint name is the Postgres default
-- (<table>_<column>_check) — verified live 2026-09-14.
alter table public.order_notes
  drop constraint if exists order_notes_kind_check;

alter table public.order_notes
  add constraint order_notes_kind_check
  check (kind in ('note', 'call', 'edit'));

comment on column public.order_notes.customer_visible is
  'True -> visible on the customer''s /orders/[id] page. Notes and call updates stay false; kind=''edit'' rows are always true.';

comment on column public.order_notes.meta is
  'Optional jsonb. For kind=''edit'' rows, holds { before, after } of just the changed fields — human-readable context, not the forensic trail. The full-row audit lives in logistics.capture_public_audit.';
