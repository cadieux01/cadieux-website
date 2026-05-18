-- Product editor migration. Run once in the Supabase SQL editor.
-- All statements are idempotent so you can re-run safely.

begin;

-- 1) New columns on products.
alter table public.products
  add column if not exists in_stock boolean not null default true,
  add column if not exists is_archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists subscription_per_loaf_inr numeric;

-- Initial backfill: anything without an explicit subscription price
-- inherits the one-time price (the admin can edit it after).
update public.products
   set subscription_per_loaf_inr = price_inr
 where subscription_per_loaf_inr is null;

-- 2) Unique index on slug (no-op if it already exists with another name).
create unique index if not exists products_slug_unique_idx
  on public.products (slug);

-- 3) updated_at trigger.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

-- 4) Audit table.
create table if not exists public.product_changes (
  id            uuid primary key default gen_random_uuid(),
  changed_at    timestamptz not null default now(),
  product_id    uuid not null references public.products(id) on delete cascade,
  product_slug  text not null,
  field_changed text not null,
  old_value     jsonb,
  new_value     jsonb,
  changed_by    text,
  context       text
);

create index if not exists product_changes_product_changed_idx
  on public.product_changes (product_id, changed_at desc);

-- 5) RLS. Service-role bypasses RLS automatically; we still want
--    "no policy = no access" semantics for anon/auth so that only
--    the admin API (which uses service-role) ever reads or writes.
alter table public.product_changes enable row level security;

commit;
