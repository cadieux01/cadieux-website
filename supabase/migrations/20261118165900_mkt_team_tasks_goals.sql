-- =============================================================================
-- /mkt team + tasks + goals — tables, RLS, and the on-assignment notification
-- =============================================================================
-- NOT YET APPLIED. This file has been WRITTEN for review. It will be run by
-- hand via the Supabase MCP `apply_migration` once the human has read it and
-- said so — never by `supabase db push`, per supabase/migrations/README.md.
-- Every statement below is idempotent so the eventual apply + any re-run are
-- harmless no-ops.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
-- -----------------------------------------------------------------------------
--
--   * extends logistics.user_role_enum with exactly ONE new value
--     ('marketing'). Justification in §1 — ALTER TYPE ADD VALUE is not
--     reversible, so every value has to pay its rent.
--
--   * creates logistics.teams and logistics.team_members. A person may be a
--     member of many teams, and the `is_leader` flag is per-row, so one
--     person can lead more than one team (brief requirement).
--
--   * creates logistics.goals and logistics.tasks. goals.horizon is
--     short|long; tasks.cadence is one-off|daily|weekly|monthly;
--     tasks.status is todo|in_progress|done|blocked. Every enumerated
--     column is a CHECK constraint on text rather than a second enum type,
--     because these values are much more likely to grow in review
--     (add 'planning'? rename 'done' to 'shipped'?) than user_role_enum is,
--     and a check constraint can be altered reversibly.
--
--   * two SECURITY DEFINER helpers for RLS keying — one that returns the
--     caller's team ids (logistics.my_team_ids) and one that returns the
--     team ids the caller leads (logistics.my_led_team_ids). The RLS
--     policies below invoke these helpers rather than inlining a correlated
--     subquery per policy, because when the policy body touches the same
--     table it guards, Postgres plans them as self-references that cannot
--     be used safely from auth.uid(). The helper breaks the cycle via
--     SECURITY DEFINER + a frozen search_path.
--
--   * NO policies on logistics.profiles. That table's policies are owned by
--     the existing logistics hardening migration; nothing here touches
--     them. /mkt's admin screens read profiles through the service role or
--     through an existing SELECT policy that already permits an authed
--     user to read rows — the migration does not widen its own authorship.
--
--   * one AFTER INSERT trigger on logistics.tasks that writes into the
--     EXISTING logistics.notifications table (NOT a new table) with
--     type='task_new'. The type name sits in the same shape as the existing
--     'assignment_new' type (noun_adjective) rather than renaming either —
--     renaming 'assignment_new' would alias 2200 rows of historic data.
--
-- -----------------------------------------------------------------------------
-- WHAT IS NOT HERE
-- -----------------------------------------------------------------------------
--
--   * No schema change on auth.users — Supabase Auth owns that namespace,
--     and sign-in in /mkt uses the existing passwords on the 14 confirmed
--     rows.
--
--   * No change to logistics.is_admin() — brief says reuse, not replace.
--
--   * No GRANT changes. Default ACL for a new logistics table is
--     `authenticated=arwd` (see 20261107132439_logistics_rls_hardening), so
--     the three new tables inherit SELECT/INSERT/UPDATE/DELETE for the
--     `authenticated` role at CREATE time. RLS is what actually enforces
--     who sees what — this file enables RLS before anything else, so no
--     row is ever visible to `authenticated` before the policies are in
--     place.
--
--   * No DROP for anything. If a review changes course, the only
--     irreversible step is the ALTER TYPE in §1 — everything else can be
--     dropped cleanly.
-- =============================================================================


-- 1 -------------------------------------- user_role_enum: add 'marketing'
--
-- Current values: admin | sales | partner.  (From the brief.)
--
-- WHY ONLY ONE NEW VALUE:
--   * admin already covers "full access across /mkt and the admin surface".
--   * sales is NOT right for a marketing teammate — sales has its own role
--     for the delivery dashboard. Reusing it here would conflate a job in
--     one subsystem with a job in another, and any future policy keyed on
--     `role='sales'` (there is one already, for the dashboard) would apply
--     to the wrong people.
--   * partner is for delivery partners and is not a marketing role.
--   * A separate "team_leader" role would be redundant with the
--     `team_members.is_leader` boolean below — leadership is per-team, and
--     a person can lead multiple teams, which a role flag cannot express.
--
-- ALTER TYPE ... ADD VALUE IS NOT REVERSIBLE, SO READ THIS BEFORE ADDING
-- MORE: Postgres has no ALTER TYPE DROP VALUE. Removing an enum value
-- requires re-creating the type and re-pointing every column that
-- references it, which in prod would need a maintenance window. Every
-- value here has to earn its slot, and 'marketing' earns it as the role
-- for an active, non-admin marketing teammate.
alter type logistics.user_role_enum add value if not exists 'marketing';


-- 2 ---------------------------------------------- logistics.teams
create table if not exists logistics.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  description text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table logistics.teams enable row level security;


-- 3 ----------------------------------------------- logistics.team_members
create table if not exists logistics.team_members (
  team_id    uuid not null references logistics.teams(id)    on delete cascade,
  profile_id uuid not null references logistics.profiles(id) on delete cascade,
  is_leader  boolean not null default false,
  added_at   timestamptz not null default now(),
  primary key (team_id, profile_id)
);

create index if not exists team_members_profile_idx
  on logistics.team_members (profile_id);
create index if not exists team_members_leader_idx
  on logistics.team_members (team_id) where is_leader = true;

alter table logistics.team_members enable row level security;


-- 4 ---------------------------------------------------- logistics.goals
create table if not exists logistics.goals (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  detail      text,
  horizon     text not null check (horizon in ('short','long')),
  target_date date,
  owner_id    uuid references logistics.profiles(id) on delete set null,
  team_id     uuid references logistics.teams(id)   on delete set null,
  created_by  uuid references logistics.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists goals_owner_idx   on logistics.goals (owner_id);
create index if not exists goals_team_idx    on logistics.goals (team_id);
create index if not exists goals_horizon_idx on logistics.goals (horizon);

alter table logistics.goals enable row level security;


-- 5 ---------------------------------------------------- logistics.tasks
create table if not exists logistics.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(trim(title)) > 0),
  detail      text,
  assignee_id uuid references logistics.profiles(id) on delete set null,
  created_by  uuid references logistics.profiles(id) on delete set null,
  team_id     uuid references logistics.teams(id)   on delete set null,
  goal_id     uuid references logistics.goals(id)   on delete set null,
  due_date    date,
  cadence     text not null default 'one-off'
                check (cadence in ('one-off','daily','weekly','monthly')),
  status      text not null default 'todo'
                check (status in ('todo','in_progress','done','blocked')),
  progress    integer not null default 0
                check (progress between 0 and 100),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists tasks_assignee_idx    on logistics.tasks (assignee_id);
create index if not exists tasks_team_idx        on logistics.tasks (team_id);
create index if not exists tasks_goal_idx        on logistics.tasks (goal_id);
create index if not exists tasks_due_date_idx    on logistics.tasks (due_date);
create index if not exists tasks_status_idx      on logistics.tasks (status);

alter table logistics.tasks enable row level security;


-- 6 ---------------------------- updated_at auto-touch (one trigger function)
--
-- Shared, not inlined per table: three triggers point at it. Keeping it
-- SECURITY INVOKER (the default) is correct — it only writes NEW.updated_at,
-- which the triggering caller is already writing.
create or replace function logistics.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists teams_set_updated_at on logistics.teams;
create trigger teams_set_updated_at
  before update on logistics.teams
  for each row execute function logistics.set_updated_at();

drop trigger if exists goals_set_updated_at on logistics.goals;
create trigger goals_set_updated_at
  before update on logistics.goals
  for each row execute function logistics.set_updated_at();

drop trigger if exists tasks_set_updated_at on logistics.tasks;
create trigger tasks_set_updated_at
  before update on logistics.tasks
  for each row execute function logistics.set_updated_at();


-- 7 ---------------------------- RLS helpers (SECURITY DEFINER, frozen path)
--
-- The pattern mirrors logistics.is_admin() (brief said reuse it, and the
-- shape here is the same so an auditor only has to understand it once).
-- SECURITY DEFINER lets a policy on logistics.tasks query
-- logistics.team_members without recursing through the latter's own
-- policies — the helper runs as the function OWNER with a frozen
-- search_path, so it reads the base rows regardless of the caller's RLS.
--
-- Two helpers, not one:
--   * my_team_ids()      — every team the caller is a member of.
--   * my_led_team_ids()  — every team where the caller is a leader.
-- Keeping them as sets of ids lets policies say `team_id = ANY(...)` or
-- `EXISTS (... WHERE t = my_team_ids())`. One function per question is
-- easier to reason about than a single "my relation to this team" oracle.

create or replace function logistics.my_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select team_id
    from logistics.team_members
   where profile_id = auth.uid();
$$;

create or replace function logistics.my_led_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $$
  select team_id
    from logistics.team_members
   where profile_id = auth.uid()
     and is_leader = true;
$$;

-- EXECUTE is granted to `authenticated` only (never PUBLIC). anon cannot
-- call either helper, because it would otherwise be a free team-membership
-- probe. Service role is granted explicitly so admin API paths can call
-- these in diagnostics.
revoke all on function logistics.my_team_ids()      from public;
revoke all on function logistics.my_led_team_ids()  from public;
grant execute on function logistics.my_team_ids()     to authenticated, service_role;
grant execute on function logistics.my_led_team_ids() to authenticated, service_role;


-- 8 -------------------------------------------------- RLS policies: teams
--
-- Admin sees + manages every team. Leaders can see every team they lead;
-- members can see every team they belong to. INSERT is admin-only (teams
-- are an org concept) and so is DELETE. UPDATE is admin or the team's
-- leader (renaming / editing a team shouldn't need an admin).

drop policy if exists teams_select on logistics.teams;
create policy teams_select
  on logistics.teams
  for select
  to authenticated
  using (
       logistics.is_admin()
    or id = any (select logistics.my_team_ids())
  );

drop policy if exists teams_insert on logistics.teams;
create policy teams_insert
  on logistics.teams
  for insert
  to authenticated
  with check ( logistics.is_admin() );

drop policy if exists teams_update on logistics.teams;
create policy teams_update
  on logistics.teams
  for update
  to authenticated
  using (
       logistics.is_admin()
    or id = any (select logistics.my_led_team_ids())
  )
  with check (
       logistics.is_admin()
    or id = any (select logistics.my_led_team_ids())
  );

drop policy if exists teams_delete on logistics.teams;
create policy teams_delete
  on logistics.teams
  for delete
  to authenticated
  using ( logistics.is_admin() );


-- 9 -------------------------------------------- RLS policies: team_members
--
-- Membership is readable to admin, to the leader(s) of that team, and to
-- the member themselves (so a person can see which teams they're on).
-- Add/remove/leader flip is admin or that team's leader.

drop policy if exists team_members_select on logistics.team_members;
create policy team_members_select
  on logistics.team_members
  for select
  to authenticated
  using (
       logistics.is_admin()
    or team_id   = any (select logistics.my_led_team_ids())
    or profile_id = auth.uid()
  );

drop policy if exists team_members_insert on logistics.team_members;
create policy team_members_insert
  on logistics.team_members
  for insert
  to authenticated
  with check (
       logistics.is_admin()
    or team_id = any (select logistics.my_led_team_ids())
  );

drop policy if exists team_members_update on logistics.team_members;
create policy team_members_update
  on logistics.team_members
  for update
  to authenticated
  using (
       logistics.is_admin()
    or team_id = any (select logistics.my_led_team_ids())
  )
  with check (
       logistics.is_admin()
    or team_id = any (select logistics.my_led_team_ids())
  );

drop policy if exists team_members_delete on logistics.team_members;
create policy team_members_delete
  on logistics.team_members
  for delete
  to authenticated
  using (
       logistics.is_admin()
    or team_id = any (select logistics.my_led_team_ids())
  );


-- 10 ---------------------------------------------- RLS policies: goals
--
-- Visibility: admin sees all; the owner sees their own; a goal scoped to
-- a team is visible to that team's members. INSERT/UPDATE: admin, owner,
-- or the goal's team leader. DELETE: admin or owner.

drop policy if exists goals_select on logistics.goals;
create policy goals_select
  on logistics.goals
  for select
  to authenticated
  using (
       logistics.is_admin()
    or owner_id = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_team_ids()))
  );

drop policy if exists goals_insert on logistics.goals;
create policy goals_insert
  on logistics.goals
  for insert
  to authenticated
  with check (
       logistics.is_admin()
    or owner_id = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  );

drop policy if exists goals_update on logistics.goals;
create policy goals_update
  on logistics.goals
  for update
  to authenticated
  using (
       logistics.is_admin()
    or owner_id = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  )
  with check (
       logistics.is_admin()
    or owner_id = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  );

drop policy if exists goals_delete on logistics.goals;
create policy goals_delete
  on logistics.goals
  for delete
  to authenticated
  using (
       logistics.is_admin()
    or owner_id = auth.uid()
  );


-- 11 --------------------------------------------- RLS policies: tasks
--
-- Visibility shape: admin sees all; the assignee sees theirs; the author
-- sees what they filed; a task scoped to a team is visible to that team's
-- members. (The brief: "an admin sees all; a leader sees their teams; a
-- member sees their own and their team's".)
-- INSERT: admin, OR the author assigning to themselves, OR a team
-- leader assigning inside their team. UPDATE: admin, assignee, author,
-- or the task's team leader. DELETE: admin only (tasks accumulate the
-- audit trail of who was asked to do what).

drop policy if exists tasks_select on logistics.tasks;
create policy tasks_select
  on logistics.tasks
  for select
  to authenticated
  using (
       logistics.is_admin()
    or assignee_id  = auth.uid()
    or created_by   = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_team_ids()))
  );

drop policy if exists tasks_insert on logistics.tasks;
create policy tasks_insert
  on logistics.tasks
  for insert
  to authenticated
  with check (
       logistics.is_admin()
    or (created_by  = auth.uid() and (assignee_id is null or assignee_id = auth.uid()))
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  );

drop policy if exists tasks_update on logistics.tasks;
create policy tasks_update
  on logistics.tasks
  for update
  to authenticated
  using (
       logistics.is_admin()
    or assignee_id = auth.uid()
    or created_by  = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  )
  with check (
       logistics.is_admin()
    or assignee_id = auth.uid()
    or created_by  = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_led_team_ids()))
  );

drop policy if exists tasks_delete on logistics.tasks;
create policy tasks_delete
  on logistics.tasks
  for delete
  to authenticated
  using ( logistics.is_admin() );


-- 12 ------------------------- notification trigger on task assignment
--
-- WRITES INTO THE EXISTING logistics.notifications TABLE — this migration
-- does NOT create a second notifications table (brief: "USE THIS TABLE").
--
-- Fires on INSERT and on UPDATE where assignee_id changes. type='task_new'
-- mirrors the existing 'assignment_new' type's naming shape. The trigger
-- is SECURITY DEFINER so it can insert into logistics.notifications
-- regardless of the caller's RLS (the insert policy on notifications is
-- outside this migration's scope); search_path is frozen and the owner is
-- postgres, so the usual SECURITY DEFINER caveats apply but nothing new
-- is exposed — all it can do is write a notification row.
--
-- NULL assignee → no notification (a task without an assignee is an
-- unclaimed one, not a notification event).
-- self-assignment (assignee = author) → no notification, same reason as
-- the existing code paths that skip notifying yourself.

create or replace function logistics.task_notify_on_assign()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed boolean := false;
begin
  if tg_op = 'INSERT' then
    changed := new.assignee_id is not null;
  elsif tg_op = 'UPDATE' then
    changed := new.assignee_id is not null
           and (old.assignee_id is distinct from new.assignee_id);
  end if;

  if changed and new.assignee_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
    insert into logistics.notifications
      (recipient_id, recipient_role, type, title, message, related_id)
    values
      ( new.assignee_id,
        null,
        'task_new',
        coalesce(new.title, 'New task'),
        'You have been assigned a task.',
        new.id );
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_notify_on_assign on logistics.tasks;
create trigger tasks_notify_on_assign
  after insert or update of assignee_id on logistics.tasks
  for each row execute function logistics.task_notify_on_assign();

revoke all on function logistics.task_notify_on_assign() from public;
-- Only the trigger system calls this. No GRANT EXECUTE to authenticated
-- or service_role — triggers run as the table owner regardless.


-- 13 ---------------- notifications: let a user read + mark their own rows
--
-- logistics.notifications already exists with 2200 rows. This migration
-- does NOT redefine the table. It adds two policies that let an authed
-- caller SEE and MARK AS READ the rows addressed to them — nothing else.
-- INSERT remains reserved to the service role + the trigger above.
--
-- If policies with the same names already exist (e.g. from a prior
-- partial apply) they are replaced, so the migration stays idempotent.

alter table logistics.notifications enable row level security;

drop policy if exists notifications_select_own on logistics.notifications;
create policy notifications_select_own
  on logistics.notifications
  for select
  to authenticated
  using (
       logistics.is_admin()
    or recipient_id = auth.uid()
  );

drop policy if exists notifications_mark_read on logistics.notifications;
create policy notifications_mark_read
  on logistics.notifications
  for update
  to authenticated
  using ( recipient_id = auth.uid() )
  with check ( recipient_id = auth.uid() );


-- 14 -------------------- notifications: lock the row-owner UPDATE down
--                                        to is_read ONLY
--
-- The policy above lets the recipient update their own row. Without
-- further guards that allows writing ANY column of the row — title,
-- message, related_id, type, created_at. A BEFORE UPDATE trigger that
-- raises on any column change OTHER than is_read is the honest
-- enforcement: policies decide WHO can UPDATE, and this trigger
-- decides WHAT the UPDATE may contain.
--
-- Service-role writes are exempt via logistics.is_service_role() —
-- backfills, rebroadcasts, admin tooling (and the task-assignment
-- trigger that INSERTs, which doesn't come through this UPDATE path
-- anyway). Admins are NOT exempt here: an admin editing their own
-- notification body is the same mistake as a user editing theirs,
-- and if the operator genuinely needs to rewrite history they still
-- have service-role tooling.
--
-- is_read is the ONLY column the row owner may flip. is_read going
-- false→true (unread → read) is the inbox API's single use case; the
-- trigger deliberately allows true→false too, so a "mark unread"
-- feature can land without a migration.
create or replace function logistics.notifications_restrict_update()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  stripped_new jsonb;
  stripped_old jsonb;
begin
  -- Service role is allowed everything. The trigger fires for every
  -- caller, so the exemption is here rather than in a WHEN clause.
  -- NOTE: the existing dashboard calls mark_notifications_read() as a
  -- SECURITY DEFINER RPC that runs under the PostgREST role, NOT
  -- service_role — so this exemption does NOT cover it. We WANT the
  -- trigger to fire on that path (any user-shape UPDATE), because
  -- that RPC only ever flips is_read and so the comparison below
  -- succeeds without a raise.
  if logistics.is_service_role() then
    return new;
  end if;

  -- Compare NEW to OLD after stripping is_read. Done via to_jsonb so
  -- the trigger is FUTURE-PROOF: any column added to
  -- logistics.notifications later is automatically protected without
  -- editing this function. The row owner may change is_read freely
  -- (true <-> false, to allow a "mark unread" feature without a
  -- schema change); everything else must be byte-for-byte equal.
  stripped_new := to_jsonb(new) - 'is_read';
  stripped_old := to_jsonb(old) - 'is_read';
  if stripped_new is distinct from stripped_old then
    raise exception using
      errcode = '42501',  -- insufficient_privilege
      message = 'notifications: row owner may update only is_read';
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_restrict_update on logistics.notifications;
create trigger notifications_restrict_update
  before update on logistics.notifications
  for each row execute function logistics.notifications_restrict_update();

revoke all on function logistics.notifications_restrict_update() from public;
-- No GRANT EXECUTE — triggers run as the table owner regardless, and
-- the function is useful to nobody else.
