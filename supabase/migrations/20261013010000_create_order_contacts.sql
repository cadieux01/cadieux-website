-- ░░ APPLIED TO PRODUCTION 2026-10-13. ░░
--
-- Applied by DIRECT EXECUTION in the Supabase SQL editor, NOT through the
-- migration runner, so there is almost certainly no row for this version in
-- supabase_migrations.schema_migrations. The table is real; the ledger does
-- not know about it. That drift is recorded here rather than left for
-- someone to discover from a failing `db push` (see README.md in this
-- directory, which documents the same class of problem).
--
-- THIS HEADER IS LOAD-BEARING AND WAS EDITED THE DAY IT RAN. It previously
-- said NOT APPLIED, which was true when written and false twenty minutes
-- later. This repo has already been bitten once by exactly that: a header
-- claiming "NOT YET APPLIED to production. Review-only." on a table that
-- was live with real customer data, which is the only text anyone opening
-- the file would have read. If you apply something here, say so in the same
-- sitting.
--
-- Migrations in this repo are applied BY HAND, so a filename here is
-- documentation rather than proof it ran. Every statement below is
-- idempotent — `create table if not exists`, and `enable row level
-- security` / `revoke` are both no-ops when already in force — so
-- re-running this is harmless rather than an error.
--
-- VERIFIED AFTER APPLYING, by two different means because they prove two
-- different layers:
--   • catalog — order_contacts reads rls=true, policies=0, matching
--     order_notes, order_reactions and order_notifications_sent exactly.
--   • live keys — the ANON key gets 42501 "permission denied for table
--     order_contacts" on both a read AND an attempted insert; the service
--     role reads it fine (0 rows). Note that 42501 is the GRANT refusing,
--     which fires before RLS is consulted: that probe proves the revoke,
--     the catalog proves the RLS. If the revoke were ever undone, RLS
--     would return an empty result rather than an error.
--
-- It lives in supabase/migrations/ rather than sql/ for one reason: this
-- creates a TABLE the application will read on every orders-board load. A
-- fresh environment that does not get it does not get a degraded board, it
-- gets a broken one. Column tweaks can live in sql/; the existence of a
-- table the code depends on cannot.
--
-- ─────────────────────────────────────────────────────────────────────
--
-- WHAT THIS IS FOR. The orders board is getting three contact buttons per
-- row — Call, WhatsApp, Message — which are RED until someone on the team
-- has used that channel for that order, and GREEN afterwards. Green is not
-- a per-browser preference and not a per-admin one: the whole point is that
-- the next person to open the board can see at a glance who has already
-- been contacted and not call a customer for the second time in ten
-- minutes. Shared state means a row in a table.
--
-- WHAT THIS IS NOT. It is not an audit log and must not grow into one.
-- There is exactly one row per (order, channel) and pressing again UPDATES
-- it. If a historical record of every individual press is ever wanted, that
-- is a second table; do not relax the uniqueness here to get it, because
-- the uniqueness is the entire reason a read can answer "is this button
-- green" with a membership test instead of a query that has to reason about
-- which of N rows is the latest.
--
-- ░░ IT IS ALSO NOT order_notes, DELIBERATELY. ░░
--
-- The obvious-looking alternative is to record a call as a row in
-- order_notes with kind='call'. That would be wrong, and expensively so:
-- hasNewUpdate() in src/lib/order-new-update.ts flags an order when a note
-- was written strictly after the status was last set, so every press of the
-- Call button would light the row up as NEW UPDATE — a flag that means
-- "somebody wrote something you have not read" — on the strength of the
-- reader's own click. The flag would be noise within a day and the operator
-- would learn to ignore it, which costs us the real notes too.
--
-- A press is not a note. It records that a channel was OPENED, not that
-- anything was said. Separate table, separate meaning, and order_notes is
-- untouched by this feature.
--
-- ─────────────────────────────────────────────────────────────────────
--
-- A WORD ON public.order_reactions, WHICH LOOKS LIKE THIS TABLE.
--
-- It exists in production, it has almost this shape, and src/ does not
-- reference it anywhere. It is NOT abandoned and NOT free to reuse: the
-- unmerged branch feat/admin-row-reactions implements long-press emoji
-- reactions against it. The table shipped ahead of its own feature branch.
-- Dropping it breaks that branch; writing contact presses into it collides
-- with it. This migration adds a sibling and leaves it alone.

begin;

-- ONE ROW PER ORDER PER CHANNEL. The key IS the fact.
--
-- (order_id, channel) is the PRIMARY KEY rather than a surrogate id plus a
-- unique constraint. Both give the uniqueness; the composite key also
-- refuses to let a second identity for the same fact exist. There is no
-- question this table answers that "which uuid" is the right answer to.
--
-- The practical payoff is the write: a press is a single
--
--     insert ... on conflict (order_id, channel) do update ...
--
-- so two admins pressing the same button in the same second cannot collide.
-- Neither press errors and neither loses the green.
--
-- BE PRECISE ABOUT WHAT THAT DOES AND DOES NOT MAKE ATOMIC. PostgREST
-- cannot express `press_count = press_count + 1` in an upsert, so the API
-- route reads the current count and writes count+1. Under exact concurrency
-- both presses read N and both write N+1, and the counter lags by one. The
-- COLOUR is guaranteed by the key; the COUNT is a secondary signal and is
-- approximate. Making it exact needs a SQL function, which is DDL we chose
-- not to add for a counter — but do not read `press_count` as if it were
-- exact, and do not "fix" it with a client-side retry loop.
create table if not exists public.order_contacts (
  order_id uuid not null references public.orders(id) on delete cascade,

  -- The three buttons, and only these three. 'sms' rather than 'message'
  -- because that is what the href scheme and smsHref() already call it;
  -- "Message" is the word on the button, not the word in the schema.
  channel text not null check (channel in ('call', 'whatsapp', 'sms')),

  -- WHEN IT FIRST WENT GREEN, and when it was last pressed. Both, because
  -- one alone is a worse answer than either:
  --
  --   first only — the row is effectively write-once, and "someone called
  --                this customer again four minutes ago" is invisible,
  --                which is the exact collision the colour exists to stop.
  --   last only  — "we have been chasing this order since Tuesday" is lost
  --                the moment anyone touches it again.
  first_contacted_at timestamptz not null default now(),
  last_contacted_at  timestamptz not null default now(),

  -- How many presses. One integer, and it answers a real operational
  -- question the colour cannot: a green button looks identical after one
  -- call and after nine, and nine means something has gone wrong with this
  -- order that nobody has written down.
  press_count integer not null default 1 check (press_count > 0),

  -- WHO PRESSED IT LAST. NULLABLE ON PURPOSE — do not add NOT NULL.
  --
  -- Admin auth in this codebase is isAdmin(req), a BOOLEAN gate: it proves
  -- the caller is staff and carries no identity at all. The name here comes
  -- from getAdminFirstName(), a local value the operator may simply never
  -- have set. The non-prompting getter is used deliberately — see the
  -- comment at the call site. ensureAdminFirstName() would window.prompt()
  -- mid-click, which turns "press and it dials" into "press, answer a
  -- question, then it dials", and a prompt is a modal dialog in front of an
  -- action whose whole specification is that it happens immediately.
  --
  -- NOT NULL here would force that prompt back in. An anonymous green is
  -- worth having; a prompt is not.
  last_author text,

  constraint order_contacts_pkey primary key (order_id, channel)
);

-- No additional index. The read is
--
--     select order_id, channel, ... from order_contacts
--      where order_id in (<the page's ids>)
--
-- and order_id is the LEADING column of the primary key, so the PK index
-- already serves it. order_notes needed explicit indexes because its
-- primary key is a surrogate uuid that no query filters on; this table's
-- does not. Do not add one "to match" — it would be a second copy of the
-- same index.

-- ░░ THE EMPTY POLICY LIST BELOW IS THE SECURITY MODEL, NOT AN OVERSIGHT. ░░
--
-- A new Postgres table ships with RLS OFF, and in Supabase that means the
-- ANON KEY — the one published in the browser bundle — can read and write
-- it. On this table that is not an abstract hole: anyone could read which
-- of our customers have been contacted, and anyone could forge green on any
-- order, which is the precise inverse of what the colour is for. A green
-- button nobody earned is worse than no button, because it actively stops
-- the call from being made.
--
-- RLS ON WITH ZERO POLICIES IS THE MOST RESTRICTIVE POSTURE AVAILABLE.
-- Deny is the default and a policy is the only way to permit anything, so
-- no policies means nothing reaches this table at all — except the service
-- role, which has BYPASSRLS and therefore ignores the lot. The service role
-- key lives only on the server, so "only the admin API can touch this" is
-- enforced by Postgres rather than by every future caller remembering.
--
-- DO NOT ADD A POLICY HERE. An empty policy list looks like unfinished work
-- and the obvious "fix" is an anon read policy; that one line would publish
-- the team's contact history to anyone with the public key. If a customer-
-- facing surface ever genuinely needs this data, it goes through a server
-- route that re-checks who is asking, not through a policy on this table.
--
-- Verified against PROD 2026-10-13 rather than assumed — this is the house
-- pattern for every admin-only order-adjacent table, all three of them:
--
--   order_notes               rls=true  policies=0
--   order_reactions           rls=true  policies=0
--   order_notifications_sent  rls=true  policies=0
--
-- customers, orders and product_reports do carry policies, because they
-- have legitimate anon read paths. This table has none and never will.
alter table public.order_contacts enable row level security;

-- Belt and braces on top of RLS. RLS filters ROWS; grants decide whether
-- the role may address the table at all. Revoking both is what the two
-- `supabase` defaults would otherwise hand out automatically, and it means
-- a future policy added by accident still finds the door locked.
revoke all on public.order_contacts from anon, authenticated;

comment on table public.order_contacts is
  'Which contact channels the team has already used on an order, one row per '
  '(order_id, channel). Drives the red/green state of the Call / WhatsApp / '
  'Message buttons on the admin orders board. Current state, NOT an audit log: '
  'a repeat press updates the row rather than inserting another. Deliberately '
  'NOT order_notes — a note row would trip the New Update flag on the reader''s '
  'own click. ON DELETE CASCADE matches order_notes: junk orders do get purged '
  'in this system and their contact state should go with them.';

-- No backfill. Every existing order starts with no row, which reads as "not
-- contacted" — red. That is the honest answer: we have no record of whether
-- anyone called them, and inventing green would mean an order nobody has
-- touched looks handled.

commit;
