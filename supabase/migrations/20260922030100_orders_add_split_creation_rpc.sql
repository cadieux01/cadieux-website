-- HELD — NOT APPLIED. Sunny to review before running.
--
-- Adds public.admin_create_split_orders(p_bread jsonb, p_sandwich jsonb,
-- p_razorpay_order_id text): the ATOMIC creation path for the OLF/OLW
-- split. One transaction, two orders rows (bread + sandwich), one shared
-- payment_group_id. Either both rows exist or neither does.
--
-- Not wired into any route by this migration. Route wiring is a
-- SEPARATE code change (plan step 5) that ships behind the kitchen
-- switch. This migration only makes the function available so it can
-- be smoke-tested — see supabase/scripts/olf_olw_split_smoketest.sql,
-- which is what the "apply then verify" ritual runs.
--
-- WHY AN RPC, NOT TWO NODE-SIDE INSERTS WITH COMPENSATION:
--
--   Two inserts with compensation opens a window where the customer
--   paid for the group and only the OLF row exists. Compensation has
--   to run inside a webhook budget with no retry framework. One RPC
--   uses the same transaction the DB already gives us — either both
--   rows exist, or neither does, and there is no compensation code.
--
--   The one cost we accept: a rolled-back insert BURNS its sequence
--   number (nextval is not transactional). See plan §1 — gaps are
--   audit-visible, cost nothing, and match how OLF285 already sits.
--   The smoke test burns two numbers every run; that is policy.
--
-- WHY DYNAMIC-COLUMN-LIST + EXECUTE, NOT jsonb_populate_record ALONE:
--
--   FIRST DRAFT USED jsonb_populate_record(null::public.orders, payload)
--   AND WAS BROKEN. jsonb_populate_record returns NULL for every column
--   whose key is ABSENT from the payload — it does NOT fall back to the
--   column's DEFAULT. `INSERT ... SELECT (rec).*` then writes those
--   NULLs explicitly, overriding every column default (id, items,
--   delivery_fee, payment_status, fulfillment_type, is_preorder,
--   order_kind), and the first NOT NULL constraint fails the txn.
--
--   Fix: build the INSERT column list from the payload's own keys,
--   intersected with the real column names on public.orders, so an
--   ABSENT key is never mentioned in the INSERT — the column keeps its
--   default. Unknown keys are still dropped (the intersect handles it).
--   A missing required column still fails loudly (NOT NULL fires on
--   INSERT), which is what we want.
--
--   Preserves the maintenance goal: no column-by-column body to keep in
--   sync with the schema. Adding a new orders column and having a
--   caller send its key is enough — the RPC picks it up on the next
--   payload.
--
-- WHY public_ref / order_number / *_seq ARE STRIPPED:
--
--   These are set by the BEFORE INSERT trigger tg_orders_assign_number
--   (OLF/OLW numbering + unique public_ref loop). A caller that
--   supplied them would bypass the trigger's guard and could pin the
--   customer-facing order number or the public_ref to a value they
--   chose. Strip belt-and-braces so a caller mistake cannot become an
--   authorisation bug. Callers should not send these keys either — the
--   strip is defence in depth.
--
-- WHY THE RPC STAMPS order_kind + payment_group_id + razorpay_order_id LAST:
--
--   The `||` merge lets the RPC's stamped values OVERRIDE anything the
--   caller supplied. A caller cannot forge order_kind='bread' onto a
--   sandwich payload, and cannot pin a payment_group_id at someone
--   else's group. razorpay_order_id is threaded through a single arg
--   so forgetting to set it on one side is syntactically impossible.
--
-- WHY SECURITY INVOKER:
--
--   Callers today are service_role (server-only supabaseAdmin in
--   /api/checkout and /api/create-order); service_role bypasses RLS.
--   Anon/authenticated callers hit the same RLS on public.orders they
--   already do for direct inserts — no elevation. SECURITY DEFINER
--   would let anon callers bypass RLS and forge orders; INVOKER
--   preserves the current gate.
--
--   Belt-and-braces: EXECUTE revoked from public, granted to
--   service_role only. Even a route mistake that calls it from an anon
--   client will now error at the grant layer, not RLS.

create or replace function public.admin_create_split_orders(
  p_bread              jsonb,
  p_sandwich           jsonb,
  p_razorpay_order_id  text default null
)
returns table (
  bread_id             uuid,
  bread_number         text,
  bread_public_ref     text,
  sandwich_id          uuid,
  sandwich_number      text,
  sandwich_public_ref  text,
  payment_group_id     uuid
)
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_group_id        uuid := gen_random_uuid();
  v_bread_payload   jsonb;
  v_sand_payload    jsonb;
  v_bread_cols      text;
  v_sand_cols       text;
  v_bread_row       public.orders;
  v_sand_row        public.orders;
begin
  if jsonb_typeof(p_bread) is distinct from 'object'
     or jsonb_typeof(p_sandwich) is distinct from 'object' then
    raise exception 'admin_create_split_orders: p_bread and p_sandwich must be JSON objects'
      using errcode = '22023';
  end if;

  -- Strip fields the trigger owns. Then layer the RPC's stamped fields
  -- via ||, so they win over any caller value for order_kind /
  -- payment_group_id / razorpay_order_id.
  v_bread_payload := (p_bread
      - 'order_number' - 'order_number_seq'
      - 'public_ref'   - 'sandwich_number_seq')
    || jsonb_build_object(
      'order_kind',        'bread',
      'payment_group_id',  v_group_id,
      'razorpay_order_id', p_razorpay_order_id
    );

  v_sand_payload := (p_sandwich
      - 'order_number' - 'order_number_seq'
      - 'public_ref'   - 'sandwich_number_seq')
    || jsonb_build_object(
      'order_kind',        'sandwich',
      'payment_group_id',  v_group_id,
      'razorpay_order_id', p_razorpay_order_id
    );

  -- Bread INSERT: column list = payload keys ∩ real orders columns.
  select string_agg(quote_ident(k), ', ')
    into v_bread_cols
    from jsonb_object_keys(v_bread_payload) k
    where k in (
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
    );

  if v_bread_cols is null then
    raise exception 'admin_create_split_orders: bread payload has no recognisable orders columns'
      using errcode = '22023';
  end if;

  execute format(
    'insert into public.orders (%s) '
    'select %s from jsonb_populate_record(null::public.orders, $1) '
    'returning *',
    v_bread_cols, v_bread_cols
  ) using v_bread_payload into v_bread_row;

  -- Sandwich INSERT: same shape.
  select string_agg(quote_ident(k), ', ')
    into v_sand_cols
    from jsonb_object_keys(v_sand_payload) k
    where k in (
      select column_name
        from information_schema.columns
       where table_schema = 'public' and table_name = 'orders'
    );

  if v_sand_cols is null then
    raise exception 'admin_create_split_orders: sandwich payload has no recognisable orders columns'
      using errcode = '22023';
  end if;

  execute format(
    'insert into public.orders (%s) '
    'select %s from jsonb_populate_record(null::public.orders, $1) '
    'returning *',
    v_sand_cols, v_sand_cols
  ) using v_sand_payload into v_sand_row;

  -- Postconditions. Cannot fail given the code above; if they ever do,
  -- the txn rolls back before anything is visible. RAISE uses % (single
  -- percent) — the first draft used %% which is a literal percent that
  -- consumes no argument, so a postcondition failure raised a SECOND
  -- error ("too many parameters specified for RAISE") and lost the
  -- underlying reason.
  if v_bread_row.payment_group_id is distinct from v_sand_row.payment_group_id
     or v_bread_row.payment_group_id is null then
    raise exception 'admin_create_split_orders: payment_group_id mismatch (bread=%, sandwich=%)',
      v_bread_row.payment_group_id, v_sand_row.payment_group_id
      using errcode = 'P0001';
  end if;

  if v_bread_row.order_kind is distinct from 'bread'
     or v_sand_row.order_kind is distinct from 'sandwich' then
    raise exception 'admin_create_split_orders: order_kind mismatch (bread=%, sandwich=%)',
      v_bread_row.order_kind, v_sand_row.order_kind
      using errcode = 'P0001';
  end if;

  return query select
    v_bread_row.id, v_bread_row.order_number, v_bread_row.public_ref,
    v_sand_row.id,  v_sand_row.order_number,  v_sand_row.public_ref,
    v_group_id;
end;
$function$;

comment on function public.admin_create_split_orders(jsonb, jsonb, text) is
  'Atomic split-order creation for the OLF/OLW cart split. Inserts one '
  'bread row and one sandwich row inside a single transaction, sharing '
  'a freshly-minted payment_group_id and (optionally) a shared '
  'razorpay_order_id. Route wiring is separate — this function is '
  'test-only until /api/checkout and /api/create-order call it. Smoke '
  'test lives in supabase/scripts/olf_olw_split_smoketest.sql.';

-- EXECUTE grants. Only service_role (server-only supabaseAdmin) may
-- call the RPC; anon and authenticated cannot even via a route mistake.
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text) from public;
grant  execute on function public.admin_create_split_orders(jsonb, jsonb, text) to service_role;
