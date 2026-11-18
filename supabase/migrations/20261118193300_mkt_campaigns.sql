-- =============================================================================
-- /mkt/campaigns — tables, RLS, and a private storage bucket
-- =============================================================================
-- NOT YET APPLIED. Written for review. Will be applied via the Supabase MCP
-- `apply_migration` after a human has read it. `supabase db push` is never run
-- in this repo — see supabase/migrations/README.md. Every statement is
-- idempotent.
--
-- -----------------------------------------------------------------------------
-- WHAT THIS DOES
-- -----------------------------------------------------------------------------
--
--   * creates logistics.campaigns + logistics.campaign_assets. Money in paise
--     (bigint) to match the money convention the rest of the schema uses; a
--     CHECK pins it non-negative so a stray negative number cannot be filed.
--   * `is_template` + `cloned_from_id` carry the Save-as-template / Run-again
--     pattern: a template is a normal row with is_template=true and no dates,
--     and `/mkt/campaigns/[id]/clone` writes a fresh row copying the template's
--     fields with a new date window (see the API route in src/app/api/mkt/).
--   * two SECURITY DEFINER helpers for the RLS predicates on
--     campaign_assets — `my_campaign_ids()` (every campaign the caller can
--     see) and `my_led_campaign_ids()` (every campaign the caller can
--     write). They're the same shape as logistics.my_team_ids /
--     my_led_team_ids from 20261118165900 (the team/tasks migration):
--     SECURITY DEFINER + `set search_path to ''`, revoke PUBLIC, grant
--     authenticated + service_role.
--   * a private storage bucket `campaign-assets` with the same mime +
--     size caps as `product-images` plus application/pdf for proof docs.
--     bucket.public = false — the only read path is signed URLs minted by
--     the server for a caller the campaign-level RLS admits.
--   * storage.objects RLS for that bucket: an authenticated active
--     profile may INSERT; SELECT is intentionally LEFT OUT so the only
--     way to read is a signed URL (which bypasses RLS via the token).
--     That is what "private" means here — the discovery gate is the
--     campaign row, not the storage object.
--
-- -----------------------------------------------------------------------------
-- WHAT IS NOT HERE
-- -----------------------------------------------------------------------------
--   * no changes to logistics.is_admin() — reused, not replaced.
--   * no changes to logistics.my_team_ids / my_led_team_ids — reused.
--   * no FKs from campaign_assets.uploaded_by to auth.users; same
--     shape as logistics.tasks.assignee_id (points at logistics.profiles).
--   * no storage.buckets.allowed_mime_types for video types in this
--     bucket, deliberately — campaign content is text/image/PDF, and
--     allowing video here would be a second place to patch at upload
--     time when the egress problem recurs.
-- =============================================================================


-- 1 ------------------------------------------- logistics.campaigns
create table if not exists logistics.campaigns (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(trim(name)) > 0),
  objective         text,
  status            text not null default 'planned'
                       check (status in ('planned','active','paused','done','cancelled')),
  starts_on         date,
  ends_on           date,
  budget_paise      bigint  not null default 0 check (budget_paise      >= 0),
  props_cost_paise  bigint  not null default 0 check (props_cost_paise  >= 0),
  headcount_needed  integer not null default 0 check (headcount_needed  >= 0),
  detail            text,
  owner_id          uuid references logistics.profiles(id) on delete set null,
  team_id           uuid references logistics.teams(id)   on delete set null,
  is_template       boolean not null default false,
  cloned_from_id    uuid references logistics.campaigns(id) on delete set null,
  created_by        uuid references logistics.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint campaigns_date_order check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  )
);

create index if not exists campaigns_owner_idx    on logistics.campaigns (owner_id);
create index if not exists campaigns_team_idx     on logistics.campaigns (team_id);
create index if not exists campaigns_status_idx   on logistics.campaigns (status);
create index if not exists campaigns_template_idx on logistics.campaigns (is_template) where is_template = true;
create index if not exists campaigns_starts_idx   on logistics.campaigns (starts_on) where starts_on is not null;

alter table logistics.campaigns enable row level security;


-- 2 ---------------------------------------- logistics.campaign_assets
create table if not exists logistics.campaign_assets (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references logistics.campaigns(id) on delete cascade,
  kind          text not null check (kind in ('content','proof','photo')),
  storage_path  text not null check (length(trim(storage_path)) > 0),
  caption       text,
  uploaded_by   uuid references logistics.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists campaign_assets_campaign_idx on logistics.campaign_assets (campaign_id);
create index if not exists campaign_assets_kind_idx     on logistics.campaign_assets (kind);

alter table logistics.campaign_assets enable row level security;


-- 3 --------------- updated_at auto-touch (reuse the shared trigger function)
--
-- logistics.set_updated_at() already exists from 20261118165900 (team/tasks
-- migration). Not recreated here — just register a trigger for campaigns.
-- campaign_assets rows are append-only, no updated_at column.
drop trigger if exists campaigns_set_updated_at on logistics.campaigns;
create trigger campaigns_set_updated_at
  before update on logistics.campaigns
  for each row execute function logistics.set_updated_at();


-- 4 ------------------ RLS helpers (SECURITY DEFINER, frozen search_path)
--
-- Shape mirrors logistics.my_team_ids / my_led_team_ids from the team/tasks
-- migration — SECURITY DEFINER lets the helper read campaigns/team_members
-- without recursing through the policies that are about to use it.
--
-- my_campaign_ids(): every campaign the caller can SEE — admin, owner, or
--   a member of the campaign's team.
-- my_led_campaign_ids(): every campaign the caller may WRITE to — admin,
--   owner, or a leader of the campaign's team.
create or replace function logistics.my_campaign_ids()
returns setof uuid
language sql stable security definer set search_path to ''
as $$
  select c.id
    from logistics.campaigns c
   where logistics.is_admin()
      or c.owner_id = auth.uid()
      or (c.team_id is not null
          and c.team_id = any (select logistics.my_team_ids()));
$$;

create or replace function logistics.my_led_campaign_ids()
returns setof uuid
language sql stable security definer set search_path to ''
as $$
  select c.id
    from logistics.campaigns c
   where logistics.is_admin()
      or c.owner_id = auth.uid()
      or (c.team_id is not null
          and c.team_id = any (select logistics.my_led_team_ids()));
$$;

revoke all on function logistics.my_campaign_ids()     from public;
revoke all on function logistics.my_led_campaign_ids() from public;
grant execute on function logistics.my_campaign_ids()     to authenticated, service_role;
grant execute on function logistics.my_led_campaign_ids() to authenticated, service_role;


-- 5 ---------------------------------------- RLS policies: campaigns
--
-- SELECT: admin OR owner OR team-member. Templates are a special case: any
-- authenticated active user can SELECT templates (they are catalogue items,
-- not per-team work) — otherwise a non-admin user cannot Run Again on a
-- template they did not personally file.
--
-- INSERT: admin OR self-filing (created_by = caller AND
-- (owner_id = caller OR owner_id IS NULL) AND
-- (team_id IS NULL OR team_id IN my_led_team_ids())). No one may file a
-- campaign naming someone else as owner from the UI; admins can of course
-- UPDATE ownership after the fact.
--
-- UPDATE: admin OR owner OR team-leader of the campaign's team.
-- DELETE: admin only (campaign rows are historical — keep the audit trail).

drop policy if exists campaigns_select on logistics.campaigns;
create policy campaigns_select on logistics.campaigns for select to authenticated
  using (
       logistics.is_admin()
    or owner_id = auth.uid()
    or (team_id is not null and team_id = any (select logistics.my_team_ids()))
    or is_template = true
  );

drop policy if exists campaigns_insert on logistics.campaigns;
create policy campaigns_insert on logistics.campaigns for insert to authenticated
  with check (
       logistics.is_admin()
    or (
          created_by = auth.uid()
      and (owner_id is null or owner_id = auth.uid())
      and (team_id  is null or team_id  = any (select logistics.my_led_team_ids()))
    )
  );

drop policy if exists campaigns_update on logistics.campaigns;
create policy campaigns_update on logistics.campaigns for update to authenticated
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

drop policy if exists campaigns_delete on logistics.campaigns;
create policy campaigns_delete on logistics.campaigns for delete to authenticated
  using ( logistics.is_admin() );


-- 6 ---------------------------------------- RLS policies: campaign_assets
--
-- Visibility follows the parent campaign — my_campaign_ids() IS the rule.
-- Write access follows my_led_campaign_ids(), i.e. owner, team leader, or
-- admin. Uploads via a signed URL bypass this (the token admits them), so
-- the real write check is campaign_id ∈ my_led_campaign_ids() at the API
-- layer AND the storage-objects policy in §8.

drop policy if exists campaign_assets_select on logistics.campaign_assets;
create policy campaign_assets_select on logistics.campaign_assets for select to authenticated
  using (
    campaign_id = any (select logistics.my_campaign_ids())
  );

drop policy if exists campaign_assets_insert on logistics.campaign_assets;
create policy campaign_assets_insert on logistics.campaign_assets for insert to authenticated
  with check (
    campaign_id = any (select logistics.my_led_campaign_ids())
  );

drop policy if exists campaign_assets_update on logistics.campaign_assets;
create policy campaign_assets_update on logistics.campaign_assets for update to authenticated
  using (
    campaign_id = any (select logistics.my_led_campaign_ids())
  )
  with check (
    campaign_id = any (select logistics.my_led_campaign_ids())
  );

drop policy if exists campaign_assets_delete on logistics.campaign_assets;
create policy campaign_assets_delete on logistics.campaign_assets for delete to authenticated
  using (
       logistics.is_admin()
    or campaign_id = any (select logistics.my_led_campaign_ids())
  );


-- 7 --------------------------------- storage bucket: campaign-assets
--
-- PRIVATE bucket. file_size_limit matches product-images (50 MiB binary,
-- 52,428,800 B — see src/lib/upload-limits.ts for why not 50 MB decimal).
-- allowed_mime_types includes PDF because proof assets arrive as both
-- photos and scanned/exported PDFs. No video types: campaign assets are
-- images + PDFs by design; adding video here would duplicate the
-- product-images video hole the website's upload resize doesn't cover.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-assets',
  'campaign-assets',
  false,
  52428800,
  array[
    'image/jpeg','image/png','image/webp',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;


-- 8 ---------------- storage.objects RLS for the campaign-assets bucket
--
-- storage.objects already has RLS enabled by Supabase defaults; what we
-- add here are policies scoped to `bucket_id = 'campaign-assets'`.
--
-- INSERT: authenticated users. The bucket row's file_size_limit and
-- allowed_mime_types are the enforceable gates. The caller's campaign_id
-- is checked at the API layer (/api/mkt/uploads/signed-url) because the
-- storage object path has no campaign-id semantics the RLS could inspect
-- without a trigger — keeping that check in one place.
--
-- SELECT: intentionally OMITTED for `authenticated`. The only way to
-- read a campaign asset is a signed URL minted server-side; the token
-- bypasses RLS. That's what "private" means here: discovery is via the
-- campaign row's own RLS (my_campaign_ids), not the storage layer.
--
-- UPDATE/DELETE: admin only. Content rewrites are not a thing on this
-- surface; a campaign asset either exists or is deleted (admin-only).

drop policy if exists "campaign_assets_storage_insert" on storage.objects;
create policy "campaign_assets_storage_insert"
  on storage.objects for insert to authenticated
  with check ( bucket_id = 'campaign-assets' );

drop policy if exists "campaign_assets_storage_delete" on storage.objects;
create policy "campaign_assets_storage_delete"
  on storage.objects for delete to authenticated
  using ( bucket_id = 'campaign-assets' and logistics.is_admin() );

drop policy if exists "campaign_assets_storage_update" on storage.objects;
create policy "campaign_assets_storage_update"
  on storage.objects for update to authenticated
  using ( bucket_id = 'campaign-assets' and logistics.is_admin() )
  with check ( bucket_id = 'campaign-assets' and logistics.is_admin() );
