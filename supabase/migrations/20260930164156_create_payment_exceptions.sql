-- APPLIED BY HAND to prod (uejagupcwevadfhfuadv). Ledger version 20260930164156.
-- The minted version is NOT the prefix originally written on this file; the file
-- was renamed to match the ledger, because the ledger is the record of what ran.
--
-- Payments that Razorpay captured and that this system deliberately did NOT
-- act on automatically, because acting would have required a guess about
-- money. Every row is a question for a person.
--
-- MEMBERSHIP IS DEFINED BY THAT SENTENCE, NOT BY THE `reason` LIST. Two cases
-- qualify today and both are recorded by /api/razorpay-webhook:
--
--   'unattributed'    the payment matches no orders.razorpay_order_id and no
--                     subscriptions.razorpay_order_id. Money arrived for
--                     something we cannot identify.
--   'amount_mismatch' the order was found, but the captured amount is not the
--                     amount owed. Marking it paid would understate the debt;
--                     ignoring it would lose a real payment.
--
-- Both used to end in a bare {ok:true} — a silent success ack on money that had
-- already left a customer's account. A third case will arrive; when it does,
-- extend the CHECK rather than building a second table. `reason` is a CHECK and
-- not an enum for the same reason order_notes.kind is: adding a value should be
-- one visible line in a migration.
--
-- This table is the durable surface. It outlives the alert email and the log,
-- so the money stays discoverable tomorrow morning even if Resend had a bad day.
--
-- DELIBERATELY NO FOREIGN KEY. The 'unattributed' case exists precisely because
-- no parent could be found; a FK would make the table impossible to write in
-- exactly the case it was built for. 'amount_mismatch' rows DO know their order
-- and reach it through razorpay_order_id.
--
-- Every statement is idempotent: migrations in this repo are applied BY HAND,
-- so a filename here is documentation, not proof it ran.
create table if not exists public.payment_exceptions (
  id uuid primary key default gen_random_uuid(),
  reason text not null check (reason in ('unattributed','amount_mismatch')),
  razorpay_payment_id text unique,
  razorpay_order_id text,
  -- What Razorpay actually captured.
  amount_paise integer not null,
  -- What was owed at the moment the exception was raised, when we knew it
  -- (null for 'unattributed' — there is no parent to owe anything). Stored
  -- rather than joined because orders.total_amount is editable: a resolver
  -- opening this row next week must see the figure the mismatch was judged
  -- against, not whatever the order says by then.
  expected_amount_paise integer,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text,
  -- Every row must carry at least one id, because the two dedupe mechanisms
  -- below are both keyed on one. A row holding NEITHER id would have no dedupe
  -- at all — Postgres treats every NULL as distinct under a unique index — so a
  -- retry storm would insert without limit. That is probably unreachable (the
  -- webhook matched on razorpay_order_id in order to miss), and "probably
  -- unreachable" is exactly the reasoning this whole table exists to stop
  -- trusting.
  constraint payment_exceptions_has_an_id check (
    razorpay_payment_id is not null or razorpay_order_id is not null
  )
);

-- The worklist reads unresolved rows oldest-first, so the customer who has been
-- waiting longest is never the one truncated away. Partial, so resolved rows
-- cost nothing to skip.
create index if not exists payment_exceptions_unresolved_idx
  on public.payment_exceptions(received_at)
  where resolved_at is null;

-- Dedupe fallback for an event that carries no payment id (see the table
-- comment). Postgres allows many NULLs under a plain UNIQUE, so without this a
-- retry of such an event would insert a fresh row every time.
create unique index if not exists payment_exceptions_order_fallback_idx
  on public.payment_exceptions(razorpay_order_id)
  where razorpay_payment_id is null;

-- RLS on with zero policies + grants revoked: reachable only by service_role
-- (BYPASSRLS), i.e. the webhook and server-side admin routes. Same posture as
-- order_notes, and load-bearing here — `payload` is Razorpay's raw event and
-- carries customer contact details and card metadata.
alter table public.payment_exceptions enable row level security;
revoke all on public.payment_exceptions from anon, authenticated;

comment on table public.payment_exceptions is
  'Captured payments this system refused to act on automatically because acting would '
  'have required a guess about money. Written by /api/razorpay-webhook. Membership is '
  'that sentence; the reason CHECK (unattributed, amount_mismatch) lists today''s '
  'members, not the definition — extend it rather than adding a sibling table. No '
  'foreign key by design: an unattributed row exists because no parent was found. '
  'razorpay_payment_id is UNIQUE so retries are idempotent — the route inserts ON '
  'CONFLICT DO NOTHING and emails only when a row was actually created, so a retry '
  'storm cannot become an email storm. KNOWN COST: razorpay_payment_id is nullable so '
  'that an event carrying no payment id can still be recorded, deduped instead by a '
  'partial unique index on razorpay_order_id. If the same payment arrives once without '
  'an id and again with one, it lands as TWO rows — a duplicate in a worklist, never a '
  'lost record. Resolve either one and close the other with a note. Nothing '
  'auto-resolves: money that does not match what is owed is a human decision.';
