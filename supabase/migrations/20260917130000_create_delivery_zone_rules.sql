-- APPLIED 2026-09-18 to Cadieux-Website (uejagupcwevadfhfuadv) by hand via MCP.
-- Kept idempotent; re-running is a no-op.
--
-- Learned zone rules for the admin boards.
--
-- Two tables, deliberately separate:
--
--   public.delivery_zone_rules         — teaches the resolver. One rule per
--                                        (key_type, key_value). Reads on every
--                                        board render.
--
--   public.delivery_zone_row_overrides — pins a single order or subscription
--                                        row to a zone when the address has
--                                        neither pincode nor locality. NOT a
--                                        rule, teaches nothing, stored apart
--                                        so the rules panel does not show
--                                        entries the operator cannot
--                                        generalise.
--
-- Every statement is idempotent: migrations here apply BY HAND, so a filename
-- is documentation, not proof it ran.

create table if not exists public.delivery_zone_rules (
  id uuid primary key default gen_random_uuid(),

  -- 'pincode' or 'locality'. Small stable set — a CHECK keeps the migration
  -- reversible without an ALTER TYPE dance.
  key_type text not null check (key_type in ('pincode','locality')),

  -- The NORMALISED key the resolver looks up. Lowercase, trimmed,
  -- whitespace-collapsed for locality; digits-only for pincode. This is the
  -- join column and must match what resolveZone() computes at read time, or
  -- the lookup misses silently.
  key_value text not null check (length(btrim(key_value)) between 1 and 64),

  -- The RAW string the operator clicked or typed, stored verbatim beside
  -- key_value. Kept because the normalisation function is a silent single
  -- point of failure: change it and every locality rule stops matching,
  -- rows revert to the built-in map, and nobody touched anything. With
  -- key_input we can, on any day, re-run normalise() over every row and
  -- flag drift where normalise(key_input) != key_value. Without it, the
  -- drift is invisible — the same failure shape as the subscriptions
  -- filter bug.
  key_input text not null check (length(btrim(key_input)) between 1 and 120),

  zone text not null check (zone in ('zone1','zone2','zone3','zone4')),

  created_by text not null check (length(btrim(created_by)) between 1 and 60),

  -- created_at is first-appearance and NEVER touched on update; the panel
  -- renders it as "learned on". updated_at is bumped on every reassignment
  -- via DO UPDATE and rendered as "last changed". If you set updated_at in
  -- DO UPDATE but forget to set zone or created_by there, you will produce
  -- a row that says "changed today" with yesterday's zone — the exact bug
  -- the split was added to prevent, upside down. Writers must set BOTH.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (key_type, key_value)
);

-- No single-column indexes: the UNIQUE above is a two-column btree and the
-- read path is always (key_type, key_value) — the resolver never scans on
-- key_value alone. Extra indexes would be pure write overhead.

alter table public.delivery_zone_rules enable row level security;
revoke all on public.delivery_zone_rules from anon, authenticated;

comment on table public.delivery_zone_rules is
  'Admin-taught zone assignments. Read by resolveZone() at priority 3 (pincode) '
  'and 4 (locality), OVERRIDING the built-in maps. UPSERT to reassign: DO UPDATE '
  'SET zone, created_by, updated_at, key_input — NEVER created_at. RLS on with '
  'zero policies + grants revoked; reachable only via service_role. key_value '
  'must be the SAME normalised form the resolver produces or the join misses; '
  'key_input is the raw string, kept so a normaliser change can be detected '
  'instead of silently unbinding every rule.';


create table if not exists public.delivery_zone_row_overrides (
  id uuid primary key default gen_random_uuid(),

  order_id uuid references public.orders(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,

  zone text not null check (zone in ('zone1','zone2','zone3','zone4')),

  created_by text not null check (length(btrim(created_by)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Exactly one parent, never both, never neither. Same formulation as
  -- order_notes / order_reactions so the invariant reads identically across
  -- the three admin-only tables in this repo.
  constraint delivery_zone_row_overrides_one_parent check (
    (order_id is not null)::int + (subscription_id is not null)::int = 1
  )
);

-- Partial uniques rather than plain UNIQUEs: NULLS DISTINCT is the default,
-- so UNIQUE (subscription_id) would leave every order-row unconstrained by
-- accident of the null rule. Stating the predicate is explicit and keeps the
-- index off the half of the table it can never serve.
create unique index if not exists delivery_zone_row_overrides_order_key
  on public.delivery_zone_row_overrides(order_id)
  where order_id is not null;

create unique index if not exists delivery_zone_row_overrides_sub_key
  on public.delivery_zone_row_overrides(subscription_id)
  where subscription_id is not null;

alter table public.delivery_zone_row_overrides enable row level security;
revoke all on public.delivery_zone_row_overrides from anon, authenticated;

comment on table public.delivery_zone_row_overrides is
  'Zone pinned to a single order or subscription row when the address has no '
  'pincode and no locality. NOT a rule — teaches the resolver nothing. ON '
  'DELETE CASCADE deliberate — never switch to SET NULL, it would leave both '
  'parents null and fail the XOR check, blocking the delete it was meant to '
  'permit.';
