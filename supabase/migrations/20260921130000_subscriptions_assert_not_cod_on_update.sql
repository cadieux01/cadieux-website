-- Widen the prepaid guard on public.subscriptions: also fire on UPDATE, and
-- stop being fooled by casing and whitespace.
--
-- NOT APPLIED. Sunny approves migrations; this file is a proposal.
--
-- WHAT EXISTS TODAY (read from prod, not from the repo — the object was
-- created by hand and no migration file declares it):
--
--   CREATE TRIGGER tg_subscriptions_assert_not_cod
--     BEFORE INSERT ON public.subscriptions
--     FOR EACH ROW EXECUTE FUNCTION tg_subscriptions_assert_not_cod();
--
--   begin
--     if new.payment_method = 'cod' then
--       raise exception 'Subscriptions are prepaid; payment_method must not be cod'
--         using errcode = 'check_violation';
--     end if;
--     return new;
--   end;
--
-- It is a TRIGGER, not a CHECK constraint, so `pg_constraint` comes back
-- empty for it and the table shows only subscriptions_pkey and
-- subscriptions_customer_id_fkey. Four comments in the codebase used to
-- call it "the subscriptions_no_cod CHECK" — a name that exists nowhere —
-- and anyone who grepped for it concluded the database was unguarded.
-- Those comments now name this object; do not reintroduce the old name.
--
-- TWO HOLES THIS CLOSES
--
--   1. INSERT ONLY. A row could be written clean and then UPDATEd to 'cod'
--      afterwards and the trigger would never see it. No code path does
--      this — the four UPDATEs that touch payment_method all write
--      'razorpay' (subscription-payment.ts ×3, sweep-abandoned-
--      subscriptions.ts ×1) and the admin PATCH allow-list refuses the
--      column entirely — so this is a guard against the path nobody has
--      written yet, which is the only kind worth adding cheaply.
--
--   2. EXACT MATCH. 'COD', 'Cod' and ' cod ' all sail past `= 'cod'`, land
--      in the column, and then read as cash-on-delivery to every human and
--      to `paymentLabel()`. Normalising the comparison — not the stored
--      value — closes that without rewriting anything already on disk.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--
--   • It does not touch the 14 legacy COD rows (OLS1, 2, 3, 5, 6-15).
--     OLS10 is a live customer mid-plan. Those are Sunny's decision and a
--     BEFORE trigger only ever sees rows being written.
--
--   • On UPDATE it raises only when the value is genuinely CHANGING into
--     cod. `UPDATE OF payment_method` fires whenever the column appears in
--     the SET list even if the value is identical, so a bare check would
--     make the 14 legacy rows impossible to hand-edit — touching
--     payment_method on OLS10 for any reason would abort. A row that is
--     already cod is not being made cod by being saved again; the
--     transition is what is forbidden, not the history.
--
--   • It matches 'cod' only, not 'cash on delivery' or 'cash_on_delivery'.
--     Every code path that has ever written this column uses the three
--     letters; widening the net to phrases risks rejecting a future
--     legitimate value on a spelling coincidence. If a new spelling ever
--     appears in the data, add it here deliberately.
--
-- Function body is replaced in place, so the existing INSERT trigger keeps
-- working through the change and there is no window where the table is
-- unguarded.

create or replace function public.tg_subscriptions_assert_not_cod()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  -- Trimmed + lowercased for COMPARISON ONLY. new.payment_method is left
  -- exactly as the caller wrote it; this trigger rejects rows, it does not
  -- quietly rewrite them.
  v_new text := lower(btrim(coalesce(new.payment_method, '')));
  v_old text;
begin
  if v_new <> 'cod' then
    return new;
  end if;

  -- Already cod before this statement → not a transition, let it through.
  -- This is what keeps the 14 legacy rows editable. See the header.
  if tg_op = 'UPDATE' then
    v_old := lower(btrim(coalesce(old.payment_method, '')));
    if v_old = 'cod' then
      return new;
    end if;
  end if;

  raise exception 'Subscriptions are prepaid; payment_method must not be cod'
    using errcode = 'check_violation';
end;
$function$;

-- Recreate the trigger with the widened event list. DROP + CREATE rather
-- than CREATE OR REPLACE TRIGGER: the latter is Postgres 14+, and dropping
-- inside the same transaction as the create leaves no uncovered window.
drop trigger if exists tg_subscriptions_assert_not_cod on public.subscriptions;

create trigger tg_subscriptions_assert_not_cod
  before insert or update of payment_method on public.subscriptions
  for each row
  execute function public.tg_subscriptions_assert_not_cod();

comment on function public.tg_subscriptions_assert_not_cod() is
  'Subscriptions are prepaid: rejects payment_method = cod (case-insensitive, '
  'trimmed) on INSERT, and on UPDATE only when the value is changing into cod '
  'so that pre-existing COD rows stay editable. Raises check_violation. This '
  'is a TRIGGER, not a CHECK constraint — pg_constraint will not show it.';
