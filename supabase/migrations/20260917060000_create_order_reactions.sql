-- APPLIED to prod (uejagupcwevadfhfuadv) on 2026-09-17, by hand, approved.
--
-- One emoji reaction per admin per row, on an order or a subscription.
--
-- WHY A NEW TABLE AND NOT public.order_notes
-- ------------------------------------------
-- Three reasons, any one of which is disqualifying:
--
--   1. order_notes.kind is CHECK (kind in ('note','call','edit')). A
--      reaction is none of those, and widening that CHECK is not free:
--      the board's Status column renders last_note, which is "newest
--      order_notes row of ANY kind". A reaction filed there would become
--      the latest note on the row and evict the call outcome the column
--      exists to show. The feature would break the feature next to it.
--
--   2. order_notes is append-only by design — the API has no PATCH and no
--      DELETE, and aggregateNotesFor() counts rows. Reactions toggle off.
--      Expressing "remove" in an append-only log means either tombstone
--      rows (which still inflate note_count) or breaking the append-only
--      guarantee for every other writer.
--
--   3. order_notes has no uniqueness at all — it cannot express
--      one-per-admin-per-row. That invariant belongs in the database, not
--      in a route handler that a second tab can race.
--
-- Every statement is idempotent: migrations in this repo are applied BY
-- HAND, so a filename here is documentation, not proof it ran.

create table if not exists public.order_reactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete cascade,

  -- NOT NULL, unlike order_notes.author, and this is load-bearing rather
  -- than tidiness. Postgres unique indexes default to NULLS DISTINCT, so
  -- a nullable author makes UNIQUE (order_id, author) vacuous: every
  -- anonymous reaction would be unique and one operator could stack
  -- fifty on a single row. The one-per-admin rule only exists while this
  -- column cannot be null. The client guarantees a value — see
  -- adminActor() in src/lib/admin-actor.ts.
  author text not null check (length(btrim(author)) between 1 and 60),

  -- Length, not content. A grapheme can legitimately run to ~11 code
  -- points once ZWJ sequences and skin-tone modifiers are involved
  -- (👨‍👩‍👧‍👦 is 7), so a tight cap would reject real emoji; 32 is
  -- generous enough for any of them and still far too small to smuggle
  -- text into a column the admin UI renders raw.
  emoji text not null check (length(btrim(emoji)) between 1 and 32),

  created_at timestamptz not null default now(),

  -- Exactly one parent, never both, never neither. Same rule and same
  -- formulation as order_notes_one_parent.
  constraint order_reactions_one_parent check (
    (order_id is not null)::int + (subscription_id is not null)::int = 1
  )
);

-- One reaction per admin per row.
--
-- Two PARTIAL unique indexes rather than two plain UNIQUE constraints.
-- A plain UNIQUE (subscription_id, author) would not constrain order
-- rows — subscription_id is null there and NULLS DISTINCT lets every
-- such row through — so it happens to behave correctly, but only by
-- accident of the null rule. Stating the predicate makes the intent
-- explicit and keeps the index off the half of the table it can never
-- serve.
create unique index if not exists order_reactions_order_author_key
  on public.order_reactions(order_id, author)
  where order_id is not null;

create unique index if not exists order_reactions_sub_author_key
  on public.order_reactions(subscription_id, author)
  where subscription_id is not null;

-- No separate single-column indexes on order_id / subscription_id. The two
-- partial uniques above already have them leftmost, so they serve the read
-- path ("every reaction for these N rows" in aggregateReactionsFor) without
-- a second copy of the same column to write on every insert. order_notes
-- carries exactly two indexes and no single-column duplicates; this matches.

-- RLS on with zero policies + grants revoked: reachable only by
-- service_role (BYPASSRLS), i.e. the server-side admin routes. Reactions
-- are an internal triage signal and must never reach a customer surface.
alter table public.order_reactions enable row level security;
revoke all on public.order_reactions from anon, authenticated;

comment on table public.order_reactions is
  'One emoji reaction per admin per order/subscription row. Exactly one parent '
  '(order_id XOR subscription_id), matching order_notes. Deliberately NOT stored in '
  'order_notes: that table CHECKs kind in (note,call,edit), is append-only, and feeds '
  'the board Status column via last_note — a reaction there would evict the latest call '
  'outcome from the column that exists to show it. ON DELETE CASCADE is deliberate and '
  'matches order_notes: orders do get purged in this system, and a reaction on a purged '
  'order should go with it. Do NOT switch to SET NULL — nulling the parent leaves both '
  'parent columns null, which fails order_reactions_one_parent and blocks the delete it '
  'was meant to permit. author is NOT NULL because the unique indexes are NULLS DISTINCT '
  'and would not constrain a null author at all.';
