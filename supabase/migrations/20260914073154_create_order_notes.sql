-- APPLIED TO PROD 2026-09-14, recorded as version 20260914073154.
--
-- Internal admin notes / call logs attached to exactly one parent:
-- either an order or a subscription, never both, never neither
-- (enforced by order_notes_one_parent).
--
-- Every statement is idempotent: migrations in this repo are applied BY HAND,
-- so a filename here is documentation, not proof it ran.
create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note','call')),
  body text not null check (length(btrim(body)) between 1 and 1000),
  author text,
  created_at timestamptz not null default now(),
  constraint order_notes_one_parent check (
    (order_id is not null)::int + (subscription_id is not null)::int = 1
  )
);

create index if not exists order_notes_order_idx
  on public.order_notes(order_id, created_at desc);
create index if not exists order_notes_sub_idx
  on public.order_notes(subscription_id, created_at desc);

-- RLS on with zero policies + grants revoked: reachable only by service_role
-- (BYPASSRLS), i.e. server-side admin routes. Notes are internal, never
-- customer-visible.
alter table public.order_notes enable row level security;
revoke all on public.order_notes from anon, authenticated;

comment on table public.order_notes is
  'Internal admin notes / call logs. Exactly one parent (order_id XOR subscription_id). '
  'ON DELETE CASCADE is deliberate: orders DO get deleted in this system — 34 fake orders '
  'were purged in Sep 2026 and the renumber dropped rows (orders 168->164, subscriptions '
  '36->29). When a junk order is purged we want its notes purged with it, not left behind. '
  'RESTRICT would have blocked those cleanups and would block the next one. Do NOT switch to '
  'SET NULL: nulling the parent leaves both parent columns null, which fails the '
  'order_notes_one_parent CHECK and breaks the very delete it was meant to permit.';
