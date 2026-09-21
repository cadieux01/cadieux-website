-- HELD — NOT APPLIED. Sunny to review before running.
--
-- The sandwich kitchen catalogue. Two tables, deliberately separate:
--
--   public.sandwiches         — one row per item on the menu.
--   public.sandwich_variants  — one row per (sandwich, bread) price, so a
--                               sandwich offered on Plain but not Multigrain
--                               is exactly two rows minus one — no NULL price,
--                               no "not offered" sentinel that a reader must
--                               translate.
--
-- Every statement idempotent. RLS on with zero policies + grants revoked
-- (mirrors delivery_zone_rules pattern) — reachable only via service_role, so
-- the admin surface reads through /api/admin/sandwiches and no anon key can
-- see the catalogue until a customer surface is built and a policy is added.
-- That is deliberate: this branch is backend-only.

create table if not exists public.sandwiches (
  id uuid primary key default gen_random_uuid(),

  -- slug is the URL-safe id (a future /sandwiches/<slug> route would key on
  -- it). Unique + short — btrimmed length between 2 and 60.
  slug text not null unique
    check (length(btrim(slug)) between 2 and 60
           and slug ~ '^[a-z0-9][a-z0-9\-]*[a-z0-9]$'),

  name text not null check (length(btrim(name)) between 1 and 120),

  -- Small stable set — CHECK not an ENUM so the migration is reversible
  -- without ALTER TYPE dance. Matches products.category convention.
  category text not null check (category in ('veg','nonveg')),

  description text,
  image_url text,

  -- Extra photos, ordered. Empty array is the safe default. NEVER NULL —
  -- a NULL forces every reader to defend against '.map on null'.
  gallery_urls text[] not null default '{}',

  -- Availability flag. Separate from the kitchen switch: this hides ONE item
  -- (out of tomato today), the kitchen switch closes the whole store.
  is_available boolean not null default true,

  -- Display order. Small ints, hand-set by admin drag-reorder. Not unique —
  -- a tie is sorted by name to stay deterministic.
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sandwiches_sort_idx
  on public.sandwiches (sort_order asc, name asc);

alter table public.sandwiches enable row level security;
revoke all on public.sandwiches from anon, authenticated;

comment on table public.sandwiches is
  'Sandwich catalogue. Backend-only until a customer surface ships — RLS on '
  'with zero policies + grants revoked, reachable only via service_role. '
  'Category is ''veg''|''nonveg''. sort_order + name breaks ties.';


create table if not exists public.sandwich_variants (
  id uuid primary key default gen_random_uuid(),

  sandwich_id uuid not null references public.sandwiches(id) on delete cascade,

  -- The bread slug this variant is offered on. Free-text and NOT a FK so a
  -- future rename of a product does not orphan the entire menu — the catalogue
  -- is small and hand-edited. Seeded values today are 'plain' and 'multigrain'.
  bread_slug text not null
    check (length(btrim(bread_slug)) between 1 and 60),

  -- Rupees (integer). Every price on the seed menu is a round rupee amount;
  -- store it as such and let the display code paint '₹' — same pattern as
  -- products.price. Positive: a zero-priced sandwich is a bug, not a promo.
  price_inr integer not null check (price_inr > 0 and price_inr < 100000),

  is_available boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (sandwich_id, bread_slug)
);

-- No single-column indexes on sandwich_id — the UNIQUE above is a two-column
-- btree with sandwich_id leftmost, which covers every "variants for this
-- sandwich" scan.

alter table public.sandwich_variants enable row level security;
revoke all on public.sandwich_variants from anon, authenticated;

comment on table public.sandwich_variants is
  'Per-bread price row for a sandwich. Absence of a row = "not offered on that '
  'bread" (no NULL-price sentinel). UNIQUE(sandwich_id, bread_slug) doubles as '
  'the fetch index. RLS on, grants revoked, service_role only.';


-- updated_at bump on both tables. Same pattern as products.
create or replace function public.tg_touch_updated_at()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
  begin
    new.updated_at := now();
    return new;
  end;
$function$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname='sandwiches_touch_updated_at'
  ) then
    create trigger sandwiches_touch_updated_at
      before update on public.sandwiches
      for each row execute function public.tg_touch_updated_at();
  end if;

  if not exists (
    select 1 from pg_trigger where tgname='sandwich_variants_touch_updated_at'
  ) then
    create trigger sandwich_variants_touch_updated_at
      before update on public.sandwich_variants
      for each row execute function public.tg_touch_updated_at();
  end if;
end $$;
