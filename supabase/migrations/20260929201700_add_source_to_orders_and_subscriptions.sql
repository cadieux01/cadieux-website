-- Record WHERE an order / subscription came from: 'web' | 'app' | 'offline'.
--
-- APPLIED to prod (uejagupcwevadfhfuadv) 2026-09-30 via the Management API,
-- with Raja's approval. The API minted ledger version 20260929201700 — EARLIER
-- than the 20260930090000 prefix this file was written under, which is why it
-- was renamed. Filename now matches the ledger, so `supabase db push` treats it
-- as applied rather than trying to re-run it.
--
-- WHY NULLABLE, WITH NO DEFAULT
--
-- orders.delivery_fee carried a DEFAULT of 50 and quietly priced rows at a
-- figure that is charged nowhere. A default here would do the same thing to
-- provenance: every row written by a path that has not been taught to stamp
-- the column would come back reading 'web' (or whatever the default said)
-- and look like a verified fact. NULL is the honest answer for "we do not
-- know", and it is the answer we want the rows that predate this column to keep
-- giving (400 orders / 60 subscriptions, measured immediately after apply).
-- Backfilling them by guesswork would be worse than the gap.
--
-- Consequence to hold on to: every reader must treat NULL as UNKNOWN, not as
-- 'web'. In particular the offline badge must key on `source = 'offline'`
-- and never on `source <> 'web'`.
--
-- NO CHECK CONSTRAINT, DELIBERATELY. A CHECK would have to be dropped and
-- recreated to add a fourth channel later, and the value is written by
-- application code on a handful of insert sites, not by users. If the
-- vocabulary ever needs enforcing, add it then — as a CHECK on a column that
-- already holds only clean values, which is a cheap migration. Adding it now
-- buys nothing and makes 'whatsapp' or 'phone' expensive.
--
-- `if not exists` on both: applied out of band via the Management API, so a
-- later `supabase db push` re-running it must be a harmless no-op.

alter table public.orders
  add column if not exists source text;

alter table public.subscriptions
  add column if not exists source text;

comment on column public.orders.source is
  'Where this order was placed from: ''web'' (cadieux.in checkout), ''app'' '
  '(mobile app, /api/mobile/*) or ''offline'' (entered by an operator in the '
  'admin Register New Order form). NULL means unknown — every row written '
  'before 2026-09-30, and any future insert path that forgets to stamp it. '
  'NULL is NOT ''web''; read it as unknown or the admin boards will label '
  'history they cannot actually vouch for.';

comment on column public.subscriptions.source is
  'Where this subscription was created from: ''web'' (cadieux.in checkout), '
  '''app'' (mobile app, /api/mobile/subscriptions) or ''offline'' (entered by '
  'an operator in the admin Register New Order form / admin create endpoint). '
  'NULL means unknown — see public.orders.source. Independent of '
  'payment_status: an offline subscription can be paid and a web one can be '
  'unpaid, so never infer one column from the other.';
