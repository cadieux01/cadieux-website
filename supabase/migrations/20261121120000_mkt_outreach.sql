-- =============================================================================
-- /mkt outreach — customer-parented worklist audit, with RLS keyed to teams
-- =============================================================================
-- NOT YET APPLIED. This file has been WRITTEN for review. It will be run by
-- hand via the Supabase MCP `apply_migration` once the human has read it and
-- said so — never by `supabase db push`, per supabase/migrations/README.md.
-- Every statement below is idempotent so the eventual apply + any re-run are
-- harmless no-ops.
--
-- -----------------------------------------------------------------------------
-- WHY THIS IS A NEW TABLE AND NOT A COLUMN
-- -----------------------------------------------------------------------------
--
-- The /mkt Money screen surfaces three segment counts (never_received_bread,
-- tried_cancelled, lapsed_over_21d) that each imply a call list the team
-- works. Logging what happened on each call needs a place to land. The
-- obvious candidate is public.order_notes, but it CARRIES A CHECK CONSTRAINT
-- (
--   order_id IS NOT NULL AND subscription_id IS NULL
--   OR
--   order_id IS NULL AND subscription_id IS NOT NULL
-- )
-- which excludes customer-level notes by design. So this is a NEW table,
-- customer-parented, and the shape mirrors order_notes' fields (kind,
-- body, author) but adds the outreach-specific columns (channel, outcome)
-- the brief named.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- -----------------------------------------------------------------------------
--
--   * creates logistics.outreach, one row per attempt to contact a customer
--     from a /mkt worklist. Six columns match the brief: segment, channel
--     (whatsapp|call|visit|other), outcome (contacted|no_answer|
--     not_interested|ordered|wrong_number|callback), note text, plus
--     assigned_to and created_by for who-did-what.
--
--   * adds ONE new SECURITY DEFINER helper, logistics.my_led_team_member_ids,
--     that returns every profile id in every team the caller leads. The
--     RLS policy below needs this question answered — a leader must see
--     outreach rows that any of THEIR teammates wrote. The two existing
--     helpers (my_team_ids, my_led_team_ids, from the mkt team migration)
--     answer "which teams am I on / do I lead"; this one chains them to
--     "which profiles are on those teams I lead".
--
--   * enables RLS and creates four policies (select / insert / update /
--     delete). Shape is parallel to logistics.tasks' policies so an
--     auditor reading both tables sees one pattern, not two.
--
--   * two indexes: (customer_id, created_at desc) for the per-customer
--     "previous outreach" lookup, and (outcome, created_at desc) for the
--     segment summary that groups by outcome.
--
--   * reuses logistics.set_updated_at() (created by the mkt team migration
--     — a shared trigger function, never duplicated) via a drop-if-exists
--     then create-trigger pair so the apply + any re-apply is idempotent.
--
-- -----------------------------------------------------------------------------
-- WHAT IS NOT HERE
-- -----------------------------------------------------------------------------
--
--   * No change to public.order_notes — it is designed for order/sub-level
--     notes, and widening its CHECK to allow customer-level rows would
--     invalidate every existing consumer that reads one ID xor the other.
--
--   * No change to logistics.profiles or to logistics.is_admin() — brief
--     said reuse the admin predicate, and the role enum already carries
--     'marketing' from the team migration. No new role is needed.
--
--   * No stored procedure for "write an outreach row and move to next
--     person" — that is application-layer flow, and putting it in SQL
--     would make the next person choice invisible to the Next.js code
--     doing optimistic UI.
--
--   * No ON DELETE CASCADE on the customer_id FK. A customer row should
--     never be deleted from under a non-null outreach history; if the
--     need arises we add it then, with eyes open.
-- =============================================================================


-- 1 ------------------------------------------------------- logistics.outreach
--
-- customer_id is a hard FK — every row MUST attach to a real customer. No
-- CHECK on channel or outcome because the lists are intentionally small
-- and we want a cheap ALTER to add a new value (a check constraint is
-- easier to grow than an enum type: see §1 of the team migration for the
-- enum-ratchet trap).
create table if not exists logistics.outreach (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete restrict,
  -- Which /mkt segment the operator was working when they logged this.
  -- Free-form text (matched against src/lib/mkt-crm.ts's SEGMENTS at the
  -- app layer) rather than an enum — the segment list grows in review,
  -- and a frozen enum here would make every segment rename a migration.
  segment      text,
  channel      text not null
                 check (channel in ('whatsapp','call','visit','other')),
  outcome      text not null
                 check (outcome in (
                   'contacted','no_answer','not_interested',
                   'ordered','wrong_number','callback'
                 )),
  note         text,
  -- assigned_to: who is the next person meant to work this (optional).
  -- Nullable because a drive-by log from a named operator may not
  -- re-assign the row.
  assigned_to  uuid references logistics.profiles(id) on delete set null,
  -- created_by MUST be non-null — the whole point of the log is "who
  -- made this attempt". FK on delete SET NULL would silently lose that
  -- signal on a profile offboard, so this stays RESTRICT.
  created_by   uuid not null references logistics.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table logistics.outreach enable row level security;


-- 2 ------------------------------------------------------- indexes
--
-- (customer_id, created_at desc) powers the "previous outreach for this
-- person" lookup the worklist queue shows alongside each card.
--
-- (outcome, created_at desc) powers the per-segment summary at the top
-- of a worklist ("of this list, 22 contacted, 14 no answer, 8 ordered").
create index if not exists outreach_customer_created_idx
  on logistics.outreach (customer_id, created_at desc);

create index if not exists outreach_outcome_created_idx
  on logistics.outreach (outcome, created_at desc);


-- 3 ------------------------------------------------------- updated_at trigger
--
-- Reuses logistics.set_updated_at() from the mkt team migration — a
-- single trigger function for every /mkt table.
drop trigger if exists outreach_set_updated_at on logistics.outreach;
create trigger outreach_set_updated_at
  before update on logistics.outreach
  for each row execute function logistics.set_updated_at();


-- 4 ------------------------------------- helper: profile ids in my led teams
--
-- The leader rule in the brief is "a leader sees their teams' rows". That
-- means every outreach row whose created_by sits on any team the caller
-- leads — a question that chains my_led_team_ids() through team_members.
-- Inlining the chain inside the policy would make the policy body
-- self-reference logistics.team_members (and recurse through its own
-- RLS); SECURITY DEFINER + frozen search_path is the same break-the-cycle
-- trick the existing my_team_ids / my_led_team_ids use.
create or replace function logistics.my_led_team_member_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select distinct tm.profile_id
    from logistics.team_members tm
   where tm.team_id in (select logistics.my_led_team_ids());
$$;

revoke all on function logistics.my_led_team_member_ids() from public;
grant execute on function logistics.my_led_team_member_ids()
  to authenticated, service_role;


-- 5 ------------------------------------------------- RLS policies: outreach
--
-- SELECT: admin sees all; a leader sees every row whose author is a
--         member of a team they lead; everyone else sees their own rows
--         (both ones they created and ones assigned to them).
-- INSERT: any authenticated+active profile can write a row about
--         themselves. The row's created_by must be auth.uid(), so a
--         logged-in user cannot author-forge. Active check is enforced
--         by the matching application gate (/api/mkt/*), BUT we also
--         pin it here via logistics.profiles — the application gate is
--         the primary enforcer, this is defence in depth.
-- UPDATE: admin, or the author, or a leader of the author. The leader
--         branch matters because an operator may mistype an outcome and
--         ask a lead to fix it.
-- DELETE: admin only — an outreach row IS the audit trail; no operator
--         deletes their own call log.

drop policy if exists outreach_select on logistics.outreach;
create policy outreach_select
  on logistics.outreach
  for select
  to authenticated
  using (
       logistics.is_admin()
    or created_by  = auth.uid()
    or assigned_to = auth.uid()
    or created_by in (select logistics.my_led_team_member_ids())
  );

drop policy if exists outreach_insert on logistics.outreach;
create policy outreach_insert
  on logistics.outreach
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from logistics.profiles p
       where p.id = auth.uid()
         and p.status = 'active'
    )
  );

drop policy if exists outreach_update on logistics.outreach;
create policy outreach_update
  on logistics.outreach
  for update
  to authenticated
  using (
       logistics.is_admin()
    or created_by = auth.uid()
    or created_by in (select logistics.my_led_team_member_ids())
  )
  with check (
       logistics.is_admin()
    or created_by = auth.uid()
    or created_by in (select logistics.my_led_team_member_ids())
  );

drop policy if exists outreach_delete on logistics.outreach;
create policy outreach_delete
  on logistics.outreach
  for delete
  to authenticated
  using ( logistics.is_admin() );


-- 6 ------------------------------------------------------- doc comment
comment on table logistics.outreach is
  'Worklist audit: one row per contact attempt from a /mkt segment queue. '
  'Customer-parented (public.order_notes cannot hold customer-level rows '
  'due to its order-xor-subscription CHECK). RLS: admin sees all, leaders '
  'see team-member rows, everyone else sees their own.';
