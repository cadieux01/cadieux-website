-- raw_material_stock: add `unit_locked` so the admin GET stops asking a
-- second question it cannot ask safely.
--
-- WHY THIS EXISTS
-- `unit` cannot change once a material has been consumed: the composite FK
-- production_batch_materials(material_id, unit) -> raw_materials(id, unit) is
-- ON UPDATE RESTRICT. The admin board needs that answer per row so the form
-- can disable the field instead of letting the save fail.
--
-- Today /api/admin/raw-materials answers it with a second query --
--   select material_id from production_batch_materials where material_id in (...)
-- -- and folds the result into a Set. That read is capped by PostgREST's
-- `Max rows` (1000 on a default Supabase project). production_batch_materials
-- grows by one row per material per batch, so the cap is reached in ordinary
-- use, and a truncated page UNDER-REPORTS locks: a genuinely consumed material
-- comes back `unit_locked: false`, the form renders an editable unit, and the
-- edit is refused by Postgres at save time. The failure is silent, it gets
-- worse with age, and it is the fail-OPEN direction.
--
-- Computed inside the view the question is answered per row, so there is no
-- second result set to truncate. EXISTS also stops at the first matching row,
-- unlike the count the route cannot afford to run per material.
--
-- WHAT CHANGES
-- One column, appended LAST. Every existing column keeps its name, type and
-- position, which is what CREATE OR REPLACE VIEW requires -- it can add at the
-- end and nothing else. The body below is pg_get_viewdef(oid, true) of the
-- live view with that one line added; current_qty, movement_count and
-- needs_reorder are reproduced verbatim, including needs_reorder comparing the
-- UNCAST sum while current_qty is cast to numeric(14,3).
--
-- movement_count is deliberately NOT the source. It counts every
-- stock_movements row, purchases included, so a material that had only ever
-- been BOUGHT would read as locked and its unit would be frozen for no reason.
-- Consumption lives in production_batch_materials and nowhere else.
--
-- security_invoker = true is preserved, and it has a consequence worth naming:
-- the view now reads production_batch_materials as the CALLER. Under RLS a
-- caller with no select policy on that table sees no rows, so EXISTS returns
-- false rather than erroring -- unlocked, not locked. The admin route reads
-- with the service-role key, which bypasses RLS, so it is unaffected; any
-- future anon/authenticated reader of this view must not treat `unit_locked`
-- as authoritative. The composite FK remains the actual guard either way.
--
-- NOT APPLIED. Migrations in this repo are applied by hand; see ./README.md.
-- Nothing here is destructive: it replaces a view definition and adds no
-- column to any table.

begin;

create or replace view public.raw_material_stock
with (security_invoker = true) as
  select
    m.id as material_id,
    m.code,
    m.name,
    m.unit,
    m.category,
    m.reorder_level,
    m.lead_time_days,
    m.vendor_id,
    m.is_active,
    coalesce(
      sum(
        sm.qty * case sm.direction when 'out'::text then '-1'::integer else 1 end::numeric
      ),
      0::numeric
    )::numeric(14, 3) as current_qty,
    count(sm.id) as movement_count,
    max(sm.entered_at) as last_movement_at,
    case
      when m.reorder_level is null then null::boolean
      else coalesce(
        sum(
          sm.qty * case sm.direction when 'out'::text then '-1'::integer else 1 end::numeric
        ),
        0::numeric
      ) <= m.reorder_level
    end as needs_reorder,
    -- Appended last. Correlated on m.id, which is the primary key and is in
    -- the GROUP BY, so it is legal in this grouped select and is evaluated
    -- once per material.
    exists (
      select 1
      from public.production_batch_materials pbm
      where pbm.material_id = m.id
    ) as unit_locked
  from public.raw_materials m
    left join public.stock_movements sm on sm.material_id = m.id
  group by
    m.id,
    m.code,
    m.name,
    m.unit,
    m.category,
    m.reorder_level,
    m.lead_time_days,
    m.vendor_id,
    m.is_active;

commit;
