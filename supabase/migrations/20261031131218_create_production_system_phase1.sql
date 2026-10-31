-- Production system, phase 1: vendors, raw materials, an append-only stock
-- ledger, production batches with two-person verification, and yield baselines.
--
-- APPLIED BY HAND to prod (uejagupcwevadfhfuadv) on 2026-10-31. Ledger version
-- 20261031131218, which took the ledger from 138 rows to 139. The minted
-- version is NOT the prefix originally written on this file — it was drafted as
-- 20261031120118 — and the file was renamed to match the ledger, because the
-- ledger is the record of what ran. Same treatment as
-- 20260930164156_create_payment_exceptions.
--
-- Migrations in this repo are applied BY HAND (see ./README.md), so a filename
-- here is documentation, not proof anything ran. Applied with the begin/commit
-- wrapper intact, then re-run once to confirm idempotency: zero errors, and no
-- second ledger row.
--
-- Verified on prod after applying, read-only: all six tables plus the
-- raw_material_stock view present; `current_qty` exists on the VIEW ONLY and on
-- no base table; production_batches.shift defaults to 'morning' with exactly
-- one CHECK, `shift = 'morning'`; RLS enabled on all six tables with one
-- deny-all policy each; zero grants to anon/authenticated on all seven
-- relations; security_invoker=true on the view; all three append-only triggers
-- STATEMENT-level. All six tables empty at apply time.
--
-- Every statement is idempotent (`if not exists` / `create or replace` /
-- `drop ... if exists`), so re-running the file is a harmless no-op rather than
-- a failure. That is the house requirement, not a nicety: hand-applied
-- migrations get re-run when someone loses their place.
--
-- ---------------------------------------------------------------------------
-- THE ONE IDEA THIS SCHEMA IS BUILT AROUND
-- ---------------------------------------------------------------------------
-- There is no `current_qty` column anywhere, and there must never be one.
-- Stock is a SUM over an append-only ledger, exposed as a VIEW. A stored
-- balance has to be kept in step with the movements that produced it by
-- application code; the first time a write path forgets, the number on the
-- screen stops being derivable from anything and nobody can say which of the
-- two is wrong. A view cannot drift from its own inputs.
--
-- The cost is real and accepted: every read of current stock aggregates the
-- material's whole history. At a few thousand movements a year that is
-- nothing. When it stops being nothing the answer is a materialised view
-- refreshed from the ledger — still derived, still not a hand-maintained
-- column.
--
-- ---------------------------------------------------------------------------
-- RLS POSTURE — admin-only, matching every other sensitive table here
-- ---------------------------------------------------------------------------
-- There is no Postgres-level "admin" role in this project. Admins are a
-- server-side session holding an HMAC bearer (src/lib/admin-session.ts) and
-- every admin query runs through the service-role client, which has BYPASSRLS.
-- So "admin-only" is expressed the way payment_exceptions, order_notes and
-- whatsapp_conversations already express it:
--
--   RLS enabled + an explicit deny-all policy for anon/authenticated +
--   grants revoked from anon/authenticated  =>  reachable only by service_role.
--
-- The deny policy is belt and braces over the revoke: a future `grant select`
-- typed in a hurry re-opens the grant but still hits a policy that returns
-- false. Both precedents exist in this directory; this file uses both.

begin;

-- ===========================================================================
-- vendors
-- ===========================================================================
create table if not exists public.vendors (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 1 and 160),
  contact_person text check (contact_person is null or length(btrim(contact_person)) between 1 and 120),
  -- Phone/WhatsApp are deliberately NOT normalised or format-checked here.
  -- Elsewhere in this codebase phone shape is enforced at the API boundary,
  -- and a CHECK that rejects a landline or a +91-prefixed number is a CHECK
  -- that gets dropped in a hurry at 7am. Stored as typed.
  phone          text check (phone is null or length(btrim(phone)) between 1 and 20),
  whatsapp       text check (whatsapp is null or length(btrim(whatsapp)) between 1 and 20),
  address        text,
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.vendors is
  'Suppliers of raw materials. is_active is a soft delete: a vendor who stops '
  'supplying must stay readable, because raw_materials rows and every purchase '
  'in the stock ledger still point at them. Never DELETE a vendor — the FK from '
  'raw_materials is ON DELETE RESTRICT and will refuse. Set is_active=false.';

-- ===========================================================================
-- raw_materials
-- ===========================================================================
create table if not exists public.raw_materials (
  id   uuid primary key default gen_random_uuid(),
  -- Raja's existing material code. Required, unique, and stored exactly as he
  -- writes it apart from a no-surrounding-whitespace rule: ' FLOUR01' and
  -- 'FLOUR01' as two distinct rows would split one material's stock balance
  -- across two ledgers, and the view would honestly report both halves.
  code text not null unique
       check (length(btrim(code)) between 1 and 40 and code = btrim(code)),
  name text not null check (length(btrim(name)) between 1 and 160),
  -- The unit this material is COUNTED in, everywhere, forever. Every
  -- stock_movements.qty for this material is in this unit — the ledger has no
  -- unit column of its own precisely so that the view can sum without
  -- converting. See the unit note on production_batch_materials.
  unit text not null check (unit in ('kg','g','l','ml','pcs','packet')),
  category text check (category is null or length(btrim(category)) between 1 and 60),
  -- Both nullable: "we have not decided yet" is a real and common state, and a
  -- 0 default would mean "never reorder", which reads as a decision.
  reorder_level  numeric(14,3) check (reorder_level is null or reorder_level >= 0),
  lead_time_days integer       check (lead_time_days is null or lead_time_days >= 0),
  vendor_id uuid references public.vendors(id) on delete restrict,
  is_active boolean not null default true,
  notes     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Not redundant, despite `id` already being the primary key: a composite
  -- foreign key can only target a unique constraint covering exactly its
  -- columns. production_batch_materials points (material_id, unit) here so a
  -- batch cannot record a unit the material is not measured in. Dropping this
  -- constraint drops that guarantee.
  constraint raw_materials_id_unit_key unique (id, unit)
);

-- Case-insensitive duplicate guard, over and above the plain UNIQUE on `code`.
-- 'MAIDA-01' and 'maida-01' are the same sack of flour to a person and two
-- separate stock balances to Postgres. ADDITION BEYOND THE SPEC — drop it if
-- Raja's coding scheme uses case meaningfully.
create unique index if not exists raw_materials_code_ci_key
  on public.raw_materials (upper(code));

create index if not exists raw_materials_vendor_idx
  on public.raw_materials (vendor_id)
  where vendor_id is not null;

create index if not exists raw_materials_active_idx
  on public.raw_materials (is_active, category);

comment on table public.raw_materials is
  'Every input that gets consumed to make product. `code` is Raja''s existing '
  'material code and is the human key — UNIQUE, and additionally unique '
  'case-insensitively, because a duplicate code silently splits one material''s '
  'stock into two balances that both look correct. `unit` is the unit this '
  'material is counted in EVERYWHERE: stock_movements deliberately has no unit '
  'column, so changing this value after movements exist would silently '
  'reinterpret every historical quantity. Do not change it — retire the '
  'material (is_active=false) and create a new code. The (id, unit) unique '
  'constraint exists so production_batch_materials can point a composite FK at '
  'it; it is load-bearing, not leftover.';

-- ===========================================================================
-- stock_movements  —  APPEND-ONLY LEDGER
-- ===========================================================================
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.raw_materials(id) on delete restrict,
  direction text not null check (direction in ('in','out','adjust')),
  -- Magnitude for 'in'/'out'; SIGNED delta for 'adjust'. Enforced below,
  -- because the sign convention is what makes the stock view correct.
  qty numeric(14,3) not null,
  reason text not null
    check (reason in ('purchase','production','wastage','correction','opening')),
  -- Generic provenance pointer, intentionally without a foreign key: it has to
  -- be able to name rows in tables that do not exist yet (purchase orders) and
  -- rows that have since been deleted. Same reasoning as
  -- payment_exceptions having no FK.
  ref_table text check (ref_table is null or length(btrim(ref_table)) between 1 and 63),
  ref_id    uuid,
  note      text,
  -- Who says this happened. Text, 1..60 chars — the same actor convention as
  -- delivery_zone_rules.created_by. Admins are not rows in auth.users, so
  -- there is nothing to foreign-key to.
  entered_by text not null check (length(btrim(entered_by)) between 1 and 60),
  -- entered_at is WHEN THE MOVEMENT HAPPENED and may be backdated by whoever
  -- is catching up on yesterday's stock. created_at is when the row landed in
  -- Postgres and is never backdated. They differ, that is the point: the first
  -- is a claim about the world, the second is a fact about the database.
  entered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint stock_movements_qty_sign check (
    case when direction in ('in','out') then qty > 0 else qty <> 0 end
  ),
  -- A pointer that names a table but no row (or a row but no table) cannot be
  -- followed by anyone and is indistinguishable from a bug.
  constraint stock_movements_ref_both_or_neither check (
    (ref_table is null) = (ref_id is null)
  )
);

-- Drives the stock view and the per-material history screen.
create index if not exists stock_movements_material_idx
  on public.stock_movements (material_id, entered_at desc);

create index if not exists stock_movements_entered_at_idx
  on public.stock_movements (entered_at desc);

-- "Which movements did this batch produce?" Partial, so the common
-- pointer-less purchase rows cost nothing.
create index if not exists stock_movements_ref_idx
  on public.stock_movements (ref_table, ref_id)
  where ref_id is not null;

-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- Same intent as public.prevent_audit_log_mutation() on audit_log, with two
-- deliberate differences:
--
--  1. FOR EACH STATEMENT, not FOR EACH ROW. A row-level BEFORE DELETE never
--     fires when the DELETE matches nothing, so `delete from stock_movements
--     where <typo>` succeeds silently and teaches the operator that deleting
--     from this table is allowed. Statement-level always fires and always
--     refuses.
--  2. A TRUNCATE trigger. UPDATE/DELETE triggers do not fire on TRUNCATE, so
--     without this the entire ledger can be emptied by the table owner in one
--     statement. audit_log has this hole today; this table should not.
--
-- The error text names the remedy, because the person hitting this is mid-task
-- and the honest fix is not obvious: you do not edit a ledger, you append a
-- correcting entry.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_stock_movement_mutation()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  raise exception
    'stock_movements is append-only: no UPDATE, DELETE or TRUNCATE. To fix a '
    'wrong entry, INSERT a compensating movement with reason=''correction'' '
    '(direction=''adjust'' and a signed qty), so the mistake and its repair are '
    'both on the record.';
end;
$function$;

drop trigger if exists stock_movements_no_update on public.stock_movements;
create trigger stock_movements_no_update
  before update on public.stock_movements
  for each statement execute function public.prevent_stock_movement_mutation();

drop trigger if exists stock_movements_no_delete on public.stock_movements;
create trigger stock_movements_no_delete
  before delete on public.stock_movements
  for each statement execute function public.prevent_stock_movement_mutation();

drop trigger if exists stock_movements_no_truncate on public.stock_movements;
create trigger stock_movements_no_truncate
  before truncate on public.stock_movements
  for each statement execute function public.prevent_stock_movement_mutation();

comment on table public.stock_movements is
  'APPEND-ONLY ledger of raw material movement. Triggers refuse UPDATE, DELETE '
  'and TRUNCATE, including from service_role. Current stock is NOT stored '
  'anywhere — read public.raw_material_stock, which sums this table. qty is a '
  'positive magnitude for direction in/out and a SIGNED delta for adjust; the '
  'CHECK enforces that, because the view''s sign convention depends on it. '
  'entered_at may be backdated (what the operator claims happened), created_at '
  'never is (when the row landed). Deleting a production_batches row does NOT '
  'unwind the movements it caused: they stay, and the unwind is a correction '
  'entry. That is the ledger behaving correctly, not a bug.';

-- ===========================================================================
-- The stock view — current stock as a VIEW, never a column
-- ===========================================================================
-- security_invoker = true matters. By default a view runs with the privileges
-- of its OWNER, which means a view over RLS-protected tables hands its rows to
-- anyone who can select the view, bypassing the tables' RLS entirely. That
-- would quietly undo the posture every table in this file sets up. With
-- security_invoker the caller's own permissions and policies apply, so the
-- view is exactly as admin-only as stock_movements is. The revoke below is the
-- belt to that braces, and is also the part that works if this ever runs on a
-- Postgres older than 15, where security_invoker does not exist.
create or replace view public.raw_material_stock
  with (security_invoker = true)
as
select
  m.id   as material_id,
  m.code,
  m.name,
  m.unit,
  m.category,
  m.reorder_level,
  m.lead_time_days,
  m.vendor_id,
  m.is_active,
  -- The whole point of this file. No conversion is applied or needed: the
  -- ledger has no unit column, so every qty here is already in m.unit.
  coalesce(sum(sm.qty * case sm.direction when 'out' then -1 else 1 end), 0)::numeric(14,3)
    as current_qty,
  -- LEFT JOIN + coalesce: a material with no movements yet reports 0, it does
  -- not vanish from the list. "Not stocked" and "not known" look identical on
  -- a screen and must not look identical here.
  count(sm.id) as movement_count,
  max(sm.entered_at) as last_movement_at,
  -- Computed, not stored, for the same reason current_qty is. NULL when no
  -- reorder_level has been decided — which is NOT the same as "fine", and the
  -- UI must render the three states (below / ok / undecided) distinctly.
  case
    when m.reorder_level is null then null
    else coalesce(sum(sm.qty * case sm.direction when 'out' then -1 else 1 end), 0)
         <= m.reorder_level
  end as needs_reorder
from public.raw_materials m
left join public.stock_movements sm on sm.material_id = m.id
group by m.id, m.code, m.name, m.unit, m.category, m.reorder_level,
         m.lead_time_days, m.vendor_id, m.is_active;

comment on view public.raw_material_stock is
  'Current raw material stock, DERIVED. current_qty = SUM(qty * -1 for out, '
  '+1 otherwise) over the append-only stock_movements ledger. There is no '
  'current_qty column in any table and there must never be one: a stored '
  'balance drifts from its movements the first time a write path forgets to '
  'update it, and then nobody can say which number is wrong. LEFT JOIN so a '
  'material with zero movements reports 0 rather than disappearing. '
  'needs_reorder is NULL when no reorder_level has been set — undecided, not '
  'healthy. security_invoker=true so the view does not launder the underlying '
  'RLS.';

-- ===========================================================================
-- production_batches
-- ===========================================================================
create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  -- THE DATE THE BAKE HAPPENED, not the delivery date it serves. These are
  -- different days: src/lib/email/bake-plan.ts is explicit that "the bake
  -- happens the night before the delivery day". Reconciling a batch against
  -- the bake plan or an order list without honouring that is an off-by-one
  -- day, and it will look like a yield problem rather than a date problem.
  production_date date not null,
  -- CONFIRMED BY RAJA: one production run per day, in the morning. The CHECK
  -- therefore admits exactly one value today, and the DEFAULT means nobody has
  -- to type it.
  --
  -- The column stays rather than being dropped, because it is the growth path:
  -- when an evening run starts, WIDENING THIS CHECK IS THE WHOLE CHANGE — one
  -- visible line in a migration, which is the house pattern (cf.
  -- payment_exceptions.reason, order_notes.kind, both CHECKs rather than enums
  -- for exactly this reason). A dropped column would instead mean a schema
  -- change, a backfill decision about what every historical row's shift was,
  -- and a two-repo vocabulary negotiation.
  --
  -- A single-value CHECK rather than free text, because free text lets 'AM',
  -- 'am' and 'Morning' coexist and silently breaks every group-by over shift —
  -- and dirty data of that kind is not recoverable later, whereas a CHECK that
  -- is too narrow announces itself immediately and loudly.
  --
  -- NOTE for whoever widens it: narrowing is the hard direction, not widening.
  -- The convergence block below re-adds this constraint on every run, so once
  -- rows with another shift exist, running a file that lists only 'morning'
  -- will FAIL on the ADD rather than quietly dropping the rule. That failure is
  -- correct, and it is the reason the block exists.
  shift text not null default 'morning' check (shift in ('morning')),
  -- Free text by design, matching sandwich_variants.bread_slug, which holds
  -- products.slug values without a foreign key. A batch is a historical record
  -- of what was made under the name it was made under; a FK with a cascade, or
  -- a rename reaching through, would rewrite the past. (Note the live slug for
  -- the Plain loaf is 'high-protein'.)
  product_slug text not null check (length(btrim(product_slug)) between 1 and 80),
  variant      text check (variant is null or length(btrim(variant)) between 1 and 80),
  planned_qty numeric(14,3) not null check (planned_qty >= 0),
  -- NULL until the bake is done and counted. 0 is a real, different answer:
  -- "we ran it and got nothing."
  actual_qty  numeric(14,3) check (actual_qty is null or actual_qty >= 0),
  status text not null default 'pending'
    check (status in ('pending','flagged','verified','rejected')),
  flag_reason text,
  entered_by text not null check (length(btrim(entered_by)) between 1 and 60),
  entered_at timestamptz not null default now(),
  verified_by text check (verified_by is null or length(btrim(verified_by)) between 1 and 60),
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Separation of duties: the person who entered a batch cannot verify it.
  --
  -- The spec wrote this as `verified_by <> entered_by`. Implemented on
  -- NORMALISED values instead, because these are free-text names, not ids:
  -- a bare <> is satisfied by 'Raja ' vs 'raja', so the plain form is a
  -- control that anyone defeats by holding shift or hitting space. Comparing
  -- lower(btrim(...)) is the same rule actually enforced.
  constraint production_batches_verifier_is_not_the_enterer check (
    verified_by is null
    or lower(btrim(verified_by)) <> lower(btrim(entered_by))
  ),
  -- ADDITION BEYOND THE SPEC. A row sitting in a terminal reviewed state with
  -- no recorded reviewer is an unaudited decision, which defeats the point of
  -- having verified_by at all. One-directional on purpose: it does not forbid
  -- verified_by on a pending or flagged row, so a verified batch can be
  -- re-opened for a second look without having to erase who looked first.
  constraint production_batches_review_has_a_reviewer check (
    status not in ('verified','rejected')
    or (verified_by is not null and verified_at is not null)
  ),
  -- ADDITION BEYOND THE SPEC. A flag nobody can read is noise that trains
  -- people to clear flags without reading them.
  constraint production_batches_flag_has_a_reason check (
    status <> 'flagged'
    or (flag_reason is not null and length(btrim(flag_reason)) > 0)
  )
);

-- Deliberately NOT unique on (production_date, shift, product_slug, variant):
-- two runs of the same product in one shift is a normal thing to do, and a
-- unique constraint here would force the second run to be recorded as an edit
-- of the first, destroying the yield signal from both.
create index if not exists production_batches_date_idx
  on public.production_batches (production_date desc, shift);

create index if not exists production_batches_status_idx
  on public.production_batches (status);

-- The review worklist: open batches, oldest first, so the one waiting longest
-- is never the one that falls off the end of the page.
create index if not exists production_batches_open_idx
  on public.production_batches (entered_at)
  where status in ('pending','flagged');

create index if not exists production_batches_product_idx
  on public.production_batches (product_slug, production_date desc);

comment on table public.production_batches is
  'One run of one product in one shift. production_date is WHEN IT WAS BAKED, '
  'not the delivery day it serves — the bake runs the night before delivery, so '
  'these differ by a day and conflating them reads as a yield fault. '
  'actual_qty NULL means not yet counted; 0 means counted and nothing came out. '
  'A batch may not be verified by the person who entered it, enforced on '
  'lower(btrim(...)) rather than raw text so whitespace and capitalisation do '
  'not defeat the control. No UNIQUE on (date, shift, product, variant): two '
  'runs in a shift are legitimate and must stay two rows. product_slug is free '
  'text, like sandwich_variants.bread_slug — a batch records the name the '
  'product had when it was made and must survive a rename. shift is CHECKed to '
  'the single confirmed value ''morning'' (one run per day) and defaults to it; '
  'the column is kept as the growth path, and starting an evening run means '
  'widening that CHECK by one word.';

-- ---------------------------------------------------------------------------
-- Convergence for the shift rule.
--
-- `create table if not exists` above is a NO-OP on a database that already has
-- this table, which means an earlier revision of this same file — one that
-- allowed ('morning','evening','night') and had no default — would keep its
-- looser CHECK forever and the edit above would appear to have done nothing.
-- That is not a hypothetical in this repo: ./README.md documents a table that
-- exists in production while its migration is absent from the ledger, so
-- "which version of this file actually ran" is not a question anyone here can
-- answer from the filename.
--
-- These two statements make the file CONVERGE rather than merely apply: after
-- it runs, the shift rule is the one written above regardless of what was
-- there before. Both are no-ops on a fresh database.
--
-- Deliberately a plain drop-then-add rather than a conditional: the ADD
-- re-validates every existing row, so if rows with some other shift already
-- exist this FAILS LOUDLY instead of quietly narrowing a rule the data does
-- not satisfy. Narrowing a vocabulary that is already in use should hurt.
-- Widening it never will.
-- ---------------------------------------------------------------------------
alter table public.production_batches
  alter column shift set default 'morning';

alter table public.production_batches
  drop constraint if exists production_batches_shift_check;

alter table public.production_batches
  add constraint production_batches_shift_check check (shift in ('morning'));

-- ===========================================================================
-- production_batch_materials
-- ===========================================================================
create table if not exists public.production_batch_materials (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id) on delete cascade,
  material_id uuid not null,
  qty_used numeric(14,3) not null check (qty_used > 0),
  unit text not null check (unit in ('kg','g','l','ml','pcs','packet')),
  created_at timestamptz not null default now(),
  -- ADDITION BEYOND THE SPEC, and the one I would argue hardest for.
  --
  -- `unit` appears on both this table and raw_materials. If the two can
  -- disagree, then 2 (kg) of flour and 2 (g) of flour are both storable
  -- against the same material, every SUM over qty_used mixes them, and the
  -- resulting yield figure is wrong by up to 1000x while looking entirely
  -- plausible. That is the same failure mode as a column whose name no longer
  -- matches what it holds — the error is invisible at the point of reading.
  --
  -- A composite FK onto raw_materials(id, unit) makes the disagreement
  -- impossible declaratively, with no trigger and no runtime cost. ON UPDATE
  -- RESTRICT, not CASCADE, is the important half: cascading a unit change from
  -- kg to g would relabel every historical row without converting its
  -- quantity, which is data corruption wearing a referential-integrity hat.
  -- Changing a material's unit after it has been used is therefore refused —
  -- retire the material and mint a new code.
  constraint production_batch_materials_unit_matches_material
    foreign key (material_id, unit)
    references public.raw_materials (id, unit)
    on update restrict on delete restrict
);

create index if not exists production_batch_materials_batch_idx
  on public.production_batch_materials (batch_id);

create index if not exists production_batch_materials_material_idx
  on public.production_batch_materials (material_id);

comment on table public.production_batch_materials is
  'What a batch consumed. (material_id, unit) is a COMPOSITE FOREIGN KEY onto '
  'raw_materials(id, unit), so a row cannot claim a unit the material is not '
  'measured in — without that, one material''s consumption can be recorded in '
  'both kg and g and every yield number silently mixes them. ON UPDATE RESTRICT '
  'means a material''s unit cannot be changed once consumed: cascading would '
  'relabel history without converting quantities. ON DELETE CASCADE from the '
  'batch, because these rows have no meaning apart from their batch — note that '
  'deleting a batch does NOT remove the stock_movements it caused, which are '
  'append-only by design.';

-- ===========================================================================
-- yield_baselines
-- ===========================================================================
create table if not exists public.yield_baselines (
  id uuid primary key default gen_random_uuid(),
  product_slug text not null check (length(btrim(product_slug)) between 1 and 80),
  variant      text check (variant is null or length(btrim(variant)) between 1 and 80),
  -- The spec listed this without an arrow, unlike every other material_id in
  -- the design. Read as an oversight and given the FK, since a baseline for a
  -- material that does not exist cannot be evaluated against anything. Say so
  -- if it was meant to be free-floating.
  material_id uuid not null references public.raw_materials(id) on delete restrict,
  expected_output_per_unit numeric(14,4) not null check (expected_output_per_unit > 0),
  -- NULLABLE AND LEFT EMPTY ON PURPOSE. Populated after roughly four weeks of
  -- real entries.
  --
  -- NO DEFAULT, deliberately. A default band is the one change that would turn
  -- this table from "we do not know yet" into "everything passes", silently,
  -- with no code change anywhere to notice.
  lower_band numeric(14,4),
  upper_band numeric(14,4),
  sample_count integer not null default 0 check (sample_count >= 0),
  updated_at timestamptz not null default now(),
  constraint yield_baselines_band_order check (
    lower_band is null or upper_band is null or lower_band <= upper_band
  ),
  -- A band that excludes the expectation it is a band around means one of the
  -- two numbers is a typo, and the flagging code cannot tell which.
  constraint yield_baselines_bands_bracket_expectation check (
    (lower_band is null or lower_band <= expected_output_per_unit)
    and (upper_band is null or upper_band >= expected_output_per_unit)
  )
);

-- ADDITION BEYOND THE SPEC. Two baselines for the same
-- (product, variant, material) are two different expected yields for one
-- thing; whichever the flagging query happened to pick would decide whether a
-- batch flags, and it would pick differently as rows are added.
-- coalesce(variant,'') because a plain UNIQUE treats every NULL as distinct
-- and so would permit exactly the duplicate it looks like it prevents.
create unique index if not exists yield_baselines_scope_key
  on public.yield_baselines (product_slug, coalesce(variant, ''), material_id);

create index if not exists yield_baselines_material_idx
  on public.yield_baselines (material_id);

comment on table public.yield_baselines is
  'Expected output per unit of a material for a product, with a tolerance band. '
  'THE BANDS ARE NULL ON PURPOSE and stay null until roughly four weeks of real '
  'entries exist; there is no DEFAULT, because a default band would quietly '
  'become a pass rule. '
  'ABSENCE OF A BASELINE MEANS "EVERYONE GETS REVIEWED", NOT "EVERYONE PASSES". '
  'The flagging code must therefore treat a missing row, and a row with null '
  'bands, as grounds to route a batch to a human — never as grounds to mark it '
  'verified. A batch is only auto-cleared by a band that actually exists and '
  'that the batch actually falls inside. UNIQUE on '
  '(product_slug, coalesce(variant,''''), material_id) so there is exactly one '
  'answer per scope.';

-- ===========================================================================
-- Row Level Security — deny all for anon/authenticated. service_role bypasses.
-- ===========================================================================
alter table public.vendors                    enable row level security;
alter table public.raw_materials              enable row level security;
alter table public.stock_movements            enable row level security;
alter table public.production_batches         enable row level security;
alter table public.production_batch_materials enable row level security;
alter table public.yield_baselines            enable row level security;

drop policy if exists deny_anon_vendors_all on public.vendors;
create policy deny_anon_vendors_all
  on public.vendors for all to anon, authenticated
  using (false) with check (false);

drop policy if exists deny_anon_raw_materials_all on public.raw_materials;
create policy deny_anon_raw_materials_all
  on public.raw_materials for all to anon, authenticated
  using (false) with check (false);

drop policy if exists deny_anon_stock_movements_all on public.stock_movements;
create policy deny_anon_stock_movements_all
  on public.stock_movements for all to anon, authenticated
  using (false) with check (false);

drop policy if exists deny_anon_production_batches_all on public.production_batches;
create policy deny_anon_production_batches_all
  on public.production_batches for all to anon, authenticated
  using (false) with check (false);

drop policy if exists deny_anon_production_batch_materials_all on public.production_batch_materials;
create policy deny_anon_production_batch_materials_all
  on public.production_batch_materials for all to anon, authenticated
  using (false) with check (false);

drop policy if exists deny_anon_yield_baselines_all on public.yield_baselines;
create policy deny_anon_yield_baselines_all
  on public.yield_baselines for all to anon, authenticated
  using (false) with check (false);

revoke all on public.vendors                    from anon, authenticated;
revoke all on public.raw_materials              from anon, authenticated;
revoke all on public.stock_movements            from anon, authenticated;
revoke all on public.production_batches         from anon, authenticated;
revoke all on public.production_batch_materials from anon, authenticated;
revoke all on public.yield_baselines            from anon, authenticated;

-- A view has no RLS of its own; security_invoker above makes it defer to the
-- base tables, and this makes it unreachable in the first place.
revoke all on public.raw_material_stock from anon, authenticated;

-- ===========================================================================
-- updated_at touch triggers — reuses the existing public.tg_touch_updated_at()
-- ===========================================================================
-- Already defined by 20260921174417_create_sandwiches_tables.sql; recreated
-- here so a freshly provisioned database that runs this file in isolation does
-- not end up with triggers pointing at a function that does not exist.
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
  if not exists (select 1 from pg_trigger where tgname='vendors_touch_updated_at') then
    create trigger vendors_touch_updated_at
      before update on public.vendors
      for each row execute function public.tg_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname='raw_materials_touch_updated_at') then
    create trigger raw_materials_touch_updated_at
      before update on public.raw_materials
      for each row execute function public.tg_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname='production_batches_touch_updated_at') then
    create trigger production_batches_touch_updated_at
      before update on public.production_batches
      for each row execute function public.tg_touch_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname='yield_baselines_touch_updated_at') then
    create trigger yield_baselines_touch_updated_at
      before update on public.yield_baselines
      for each row execute function public.tg_touch_updated_at();
  end if;

  -- No trigger on stock_movements or production_batch_materials: neither has an
  -- updated_at, and stock_movements refuses UPDATE outright.
end $$;

commit;
