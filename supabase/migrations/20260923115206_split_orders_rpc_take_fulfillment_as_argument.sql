-- APPLIED TO PROD 2026-09-23 as ledger version 20260923115206.
-- Verified after apply, from pg_proc, not from this file:
--   exactly one row — admin_create_split_orders(jsonb,jsonb,text,uuid,text)
--   prosecdef false
--   proacl     {postgres=X/postgres,service_role=X/postgres}
-- One row is the assertion that both drops took; a second row would mean a
-- stale-arity landmine is still callable. anon/authenticated absent from the
-- ACL is the assertion that the revokes landed on the NEW function.
--
-- The filename prefix is the LEDGER VERSION, and it is NOT when this file was
-- written — it was written at 20260923043000 and minted ~7h later, after two
-- review rounds. Renamed to match, content otherwise unchanged. Do not
-- "restore" the old prefix: a filename that is not in the ledger is one
-- `supabase db push` away from being re-run. See
-- cadieux-migration-ledger-drift.md.
--
-- WHAT THIS CHANGES, IN ONE LINE:
--
--   An ABSENT key in a payload must never be silently interpreted. It is
--   either REQUIRED (raise 22023 naming it) or CONTROLLED BY THE RPC
--   (stamped, caller value ignored). There is no third category.
--
-- ============================================================================
-- THE DEFECT CLASS
-- ============================================================================
--
--   The dynamic-column-list design — correct, and itself the fix for an
--   earlier NULL-over-default bug — means a key ABSENT from the payload is
--   never named in the INSERT, so the column takes its DEFAULT. That is the
--   right behaviour for columns whose default is a genuine "unset" value.
--   It is a silent data-corruption bug for columns whose default is a
--   PLAUSIBLE BUT WRONG value:
--
--     items          default '[]'   → a paid order containing nothing
--     delivery_fee   default 50     → a ₹50 fee the app charges nowhere
--                                     (DELIVERY_FEE_FLAT_INR is 12)
--     fulfillment_type default 'delivery'
--                                   → a pickup order that dispatches a rider
--
--   Each of those is silent. None raises. All three produce a row that looks
--   entirely well-formed. Stamping them one at a time is whack-a-mole: it
--   fixes the three columns someone has already been bitten by and leaves
--   every column nobody has thought of yet.
--
--   So the RPC now REQUIRES the load-bearing keys to be PRESENT on both
--   payloads and raises 22023 naming the missing one. Loud beats silent, and
--   presence-checking covers columns that do not exist yet: the moment a new
--   money column is added to the required list, every caller that forgets it
--   fails at the door instead of writing a wrong number.
--
-- ============================================================================
-- THE TWO CATEGORIES
-- ============================================================================
--
-- REQUIRED-PRESENT (caller must supply; RPC does not second-guess the value):
--
--   items         — default '[]'. THE WORST ONE. An omitted key yields a
--                   paid order whose contents are an empty array: nothing to
--                   bake, nothing to deliver, money taken.
--   delivery_fee  — default 50. Under DELIVERY_FEE_SPLIT_MODE = "per_order"
--                   both rows carry their own fee, and a pickup group carries
--                   0 on both. All three are the CALLER's to decide.
--   total_amount  — NO DEFAULT AND NULLABLE IN DDL. Confirmed against prod
--                   2026-09-23. This is stronger than it first looks: because
--                   the column is nullable, an absent key does NOT trip a NOT
--                   NULL violation. It inserts a NULL total and the row looks
--                   fine. The check below is the ONLY thing standing in the
--                   way — there is no constraint underneath it.
--   customer_id   — same: no default, nullable in DDL, no backstop. Identity.
--
--   Both are populated on 299/299 live rows, so requiring them breaks no
--   existing caller — the app has always sent them. The list encodes what
--   is already true and makes it enforceable.
--
--   Presence is checked with jsonb_exists AND a JSON-null test: a key present
--   with value null is treated as absent, because `{"items": null}` is a
--   caller mistake wearing the costume of a supplied value.
--
--   Checked against the RAW caller payloads, BEFORE stamping, so a stamped
--   key can never mask a missing one.
--
--   NOT IN THE LIST — `customer_phone`, RESOLVED 2026-09-23:
--
--     public.orders.customer_phone DOES NOT EXIST. Confirmed against prod.
--     It was raised as a candidate, and the repo disagreed: every reference
--     to `customer_phone` in src/ is on public.SUBSCRIPTIONS, not orders
--     (subscription-payment.ts, cron/orphaned-payments.ts,
--     cron/stale-deliveries.ts, email/bake-plan.ts, et al), and the orders
--     insert path — orderInsertColumns() in src/lib/order-checkout.ts —
--     writes customer_id and NO phone column at all. The repo was right.
--
--     Recorded rather than deleted because "put customer_phone in the
--     required list" is a natural-looking suggestion that would break every
--     caller on day one: the required-present check fires on payload keys,
--     not on columns, so a required key with no matching column raises 22023
--     forever and inserts nothing. Phone reaches orders through customer_id.
--
--     Lower-stakes, still out — `delivery_address`: identity-ish,
--     but a pickup group legitimately has none (the address is synthesised
--     from pickup_location_id downstream), so requiring it would break pickup.
--     Left out.
--
-- STAMPED (caller MUST NOT control; any supplied value is overwritten):
--
--   order_kind          — 'bread' / 'sandwich', per side.
--   payment_group_id    — freshly minted, shared.
--   razorpay_order_id   — one argument, both rows.
--   fulfillment_type    — one argument, both rows.   [see below]
--   pickup_location_id  — one argument, both rows.   [see below]
--
--   The `||` merge IS the strip for these: a caller key of the same name is
--   overwritten, so no separate `- 'key'` is needed. The explicit `-` list
--   is only for trigger-owned fields, which are stripped WITHOUT restamping.
--
-- ============================================================================
-- FULFILMENT AND PICKUP LOCATION: ONE ARGUMENT EACH, WITH A CONTRACT
-- ============================================================================
--
--   fulfillment_type was previously supplied independently on each payload.
--   Nothing stopped OLF='delivery' with OLW='pickup', and every downstream
--   consumer assumes the pair agrees (DELIVERY_FEE_SPLIT_MODE apportions
--   across the pair; SANDWICH_PACKAGING_INR charges the OLW row only when it
--   reads 'delivery'; bake-plan-lines.ts routes off fulfillment_type in
--   preference to delivery_slot). Taken once and stamped on both, divergence
--   becomes UNREPRESENTABLE rather than merely discouraged: there is no
--   second place to write a different value.
--
--   pickup_location_id is the same class of bug with a sharper edge — on a
--   pickup group it is the counter the customer walks to. It gets the same
--   treatment plus a cross-field contract:
--
--     pickup   → p_pickup_location_id must be NOT NULL   (else 22023)
--     delivery → p_pickup_location_id must be NULL       (else 22023)
--
--   Both directions raise. A delivery order carrying a stale pickup location
--   is how a row ends up on two boards at once.
--
--   NO DEFAULT on either argument. `default null` on p_pickup_location_id
--   would be safe-by-accident (the pickup branch would still raise), but the
--   whole point of this migration is that omission is never a decision. A
--   delivery caller passes an explicit NULL and means it.
--
--   p_pickup_location_id is typed `uuid`. CONFIRMED against prod 2026-09-23:
--   orders.pickup_location_id is uuid, so the argument type matches and no
--   cast is inserted at the call site. This needed confirming rather than
--   assuming because the repo contains no schema for public.pickup_locations
--   (prod-created) and order-notification.ts:287 records that there is NO FK
--   from orders.pickup_location_id to pickup_locations.id — so nothing in
--   the tree pins the type. A text column holding non-UUID ids would have
--   made this signature reject valid ids, and fixing that after apply costs
--   another drop.
--
-- WHY delivery_fee IS NOT FORCED TO 0 ON PICKUP:
--
--   Requiring the key present already kills the ₹50 fossil, which was the
--   actual bug. Hardcoding 0 would move pricing into the database, where the
--   app cannot see it and nobody would think to look. Pricing stays in
--   src/lib/deliveryFee.ts.
--
-- WHY THE OLD FUNCTIONS ARE DROPPED, NOT REPLACED:
--
--   Postgres keys functions by (name, argument types). `create or replace`
--   with a different argument list creates an OVERLOAD and leaves the old
--   one callable — and the old one IS the landmine. A stale-arity call must
--   fail with "function does not exist", loudly, rather than quietly
--   resolving to the unsafe version.
--
--   Both prior shapes are dropped: the live 3-arg version, and the 4-arg
--   interim draft that was reviewed but never applied (no-op if absent).
--   Drop verified safe against prod 2026-09-23: 0 dependents,
--   prosecdef false, proacl {postgres, service_role}.
--
-- WHY VALIDATION HERE AND NOT LEFT TO THE CHECK CONSTRAINT:
--
--   CHECK (fulfillment_type = ANY (ARRAY['delivery','pickup'])) fires
--   mid-INSERT with a generic message after work is done. More importantly
--   it does NOT catch NULL: `NULL = ANY (ARRAY[...])` evaluates to NULL and
--   a CHECK constraint PASSES on NULL. Only the column's NOT NULL catches
--   that, two inserts later. The explicit test below catches it at the door.
--
--   No case-folding. 'Delivery' is REJECTED, not coerced — silent coercion
--   teaches the caller nothing.
--
-- WHY THE COLUMN LIST READS pg_catalog AND NOT information_schema:
--
--   DO NOT "SIMPLIFY" THIS BACK. information_schema.columns is
--   PRIVILEGE-FILTERED by definition: it shows only columns the current role
--   holds some privilege on. This function is SECURITY INVOKER, so the role
--   is whoever called it. Under a role with narrower grants the view returns
--   FEWER rows, the intersection below silently shrinks, the omitted columns
--   are never named in the INSERT — and they take their DEFAULTS. That is
--   precisely the defect class this migration exists to close, re-entering
--   through the back door and invisible in every test run as service_role.
--
--   pg_catalog.pg_attribute is not privilege-filtered. It returns the table's
--   real shape regardless of who is asking, so the column list is a function
--   of the SCHEMA alone and never of the caller's grants.
--
--   attnum > 0 drops system columns (ctid, xmin, …); not attisdropped drops
--   the tombstones a DROP COLUMN leaves behind, which still occupy attnum
--   slots and would otherwise be quoted into the INSERT as `........pg.dropped.N........`.
--
--   'public.orders'::regclass resolves correctly under `set search_path = ''`
--   because it is SCHEMA-QUALIFIED. An unqualified 'orders'::regclass would
--   fail to resolve with an empty search_path — keep the schema on it.

drop function if exists public.admin_create_split_orders(jsonb, jsonb, text);
drop function if exists public.admin_create_split_orders(jsonb, jsonb, text, text);

create or replace function public.admin_create_split_orders(
  p_bread              jsonb,
  p_sandwich           jsonb,
  p_fulfillment_type   text,
  p_pickup_location_id uuid,
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
  -- Load-bearing keys. Absent means BROKEN, never "use the default".
  -- Extending this list is the intended way to close the next instance of
  -- this bug class — add the column name, not another stamp.
  v_required  constant text[] := array[
    'items',          -- default '[]'  → paid order containing nothing
    'delivery_fee',   -- default 50    → fee the app charges nowhere
    'total_amount',   -- nullable, no default → silent NULL total, no backstop
    'customer_id'     -- nullable, no default → silent NULL identity, ditto
  ];

  v_key             text;
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

  -- ---- Required-present check, on the RAW payloads, before stamping ----
  -- A key present with JSON null counts as ABSENT: {"items": null} is a
  -- caller mistake wearing the costume of a supplied value.
  foreach v_key in array v_required loop
    if not jsonb_exists(p_bread, v_key)
       or jsonb_typeof(p_bread -> v_key) = 'null' then
      raise exception 'admin_create_split_orders: bread payload is missing required key % (absent or null). Absent is not a default — supply it explicitly.',
        quote_literal(v_key)
        using errcode = '22023';
    end if;
    if not jsonb_exists(p_sandwich, v_key)
       or jsonb_typeof(p_sandwich -> v_key) = 'null' then
      raise exception 'admin_create_split_orders: sandwich payload is missing required key % (absent or null). Absent is not a default — supply it explicitly.',
        quote_literal(v_key)
        using errcode = '22023';
    end if;
  end loop;

  -- ---- Fulfilment: decided ONCE, for the whole group ----
  -- Rejects NULL (which the CHECK constraint would let through) and any
  -- value outside the two the CHECK allows. No case-folding.
  if p_fulfillment_type is null
     or p_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'admin_create_split_orders: p_fulfillment_type must be exactly ''delivery'' or ''pickup'' (got %)',
      coalesce(quote_literal(p_fulfillment_type), 'NULL')
      using errcode = '22023';
  end if;

  -- ---- Pickup location: cross-field contract, both directions raise ----
  if p_fulfillment_type = 'pickup' and p_pickup_location_id is null then
    raise exception 'admin_create_split_orders: p_pickup_location_id is required when p_fulfillment_type = ''pickup'''
      using errcode = '22023';
  end if;
  if p_fulfillment_type = 'delivery' and p_pickup_location_id is not null then
    raise exception 'admin_create_split_orders: p_pickup_location_id must be NULL when p_fulfillment_type = ''delivery'' (got %)',
      p_pickup_location_id
      using errcode = '22023';
  end if;

  -- Strip fields the trigger owns. Then layer the RPC's stamped fields via
  -- ||, so they win over any caller value.
  v_bread_payload := (p_bread
      - 'order_number' - 'order_number_seq'
      - 'public_ref'   - 'sandwich_number_seq')
    || jsonb_build_object(
      'order_kind',         'bread',
      'payment_group_id',   v_group_id,
      'razorpay_order_id',  p_razorpay_order_id,
      'fulfillment_type',   p_fulfillment_type,
      'pickup_location_id', p_pickup_location_id
    );

  v_sand_payload := (p_sandwich
      - 'order_number' - 'order_number_seq'
      - 'public_ref'   - 'sandwich_number_seq')
    || jsonb_build_object(
      'order_kind',         'sandwich',
      'payment_group_id',   v_group_id,
      'razorpay_order_id',  p_razorpay_order_id,
      'fulfillment_type',   p_fulfillment_type,
      'pickup_location_id', p_pickup_location_id
    );

  -- Bread INSERT: column list = payload keys ∩ real orders columns.
  -- Stamped keys are ALWAYS present (a NULL argument becomes JSON null,
  -- which is still a present key), so those columns are always named in the
  -- INSERT and their defaults can never apply. That is the point: for a
  -- delivery group, pickup_location_id is written as an explicit NULL
  -- rather than left to whatever the column would have done.
  --
  -- pg_catalog, NOT information_schema — the latter is privilege-filtered and
  -- would silently shrink this list under a narrower role, handing the
  -- dropped columns back to their defaults. See the header.
  select string_agg(quote_ident(k), ', ')
    into v_bread_cols
    from jsonb_object_keys(v_bread_payload) k
    where k in (
      select a.attname
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.orders'::regclass
         and a.attnum > 0
         and not a.attisdropped
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

  -- Sandwich INSERT: same shape, same pg_catalog reasoning.
  select string_agg(quote_ident(k), ', ')
    into v_sand_cols
    from jsonb_object_keys(v_sand_payload) k
    where k in (
      select a.attname
        from pg_catalog.pg_attribute a
       where a.attrelid = 'public.orders'::regclass
         and a.attnum > 0
         and not a.attisdropped
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

  -- Postconditions. Cannot fail given the code above; if they ever do, the
  -- txn rolls back before anything is visible. RAISE uses % (single percent)
  -- — the first draft used %% which is a literal percent that consumes no
  -- argument, so a postcondition failure raised a SECOND error ("too many
  -- parameters specified for RAISE") and lost the underlying reason.
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

  -- Both rows agree with EACH OTHER and with the argument. The second half
  -- is the one that matters: rows agreeing on a value neither the caller nor
  -- the operator asked for is the failure this migration exists to prevent.
  if v_bread_row.fulfillment_type is distinct from p_fulfillment_type
     or v_sand_row.fulfillment_type is distinct from p_fulfillment_type then
    raise exception 'admin_create_split_orders: fulfillment_type not stamped (asked=%, bread=%, sandwich=%)',
      p_fulfillment_type, v_bread_row.fulfillment_type, v_sand_row.fulfillment_type
      using errcode = 'P0001';
  end if;

  if v_bread_row.pickup_location_id is distinct from p_pickup_location_id
     or v_sand_row.pickup_location_id is distinct from p_pickup_location_id then
    raise exception 'admin_create_split_orders: pickup_location_id not stamped (asked=%, bread=%, sandwich=%)',
      p_pickup_location_id, v_bread_row.pickup_location_id, v_sand_row.pickup_location_id
      using errcode = 'P0001';
  end if;

  return query select
    v_bread_row.id, v_bread_row.order_number, v_bread_row.public_ref,
    v_sand_row.id,  v_sand_row.order_number,  v_sand_row.public_ref,
    v_group_id;
end;
$function$;

comment on function public.admin_create_split_orders(jsonb, jsonb, text, uuid, text) is
  'Atomic split-order creation for the OLF/OLW cart split. Inserts one bread '
  'row and one sandwich row in a single transaction, sharing a freshly-minted '
  'payment_group_id, one fulfillment_type, one pickup_location_id and '
  '(optionally) one razorpay_order_id. Two rules: load-bearing keys (items, '
  'delivery_fee, total_amount, customer_id) must be PRESENT on both payloads '
  'or the call raises 22023 naming the missing one — an absent key is never '
  'read as "use the column default"; and fulfilment/pickup-location/kind/'
  'group/razorpay are stamped by the RPC, so callers cannot forge or diverge '
  'them across the pair. Route wiring is separate — test-only until '
  '/api/checkout and /api/create-order call it. Smoke test lives in '
  'supabase/scripts/olf_olw_split_smoketest.sql.';

-- ============================================================================
-- EXECUTE GRANTS — ORDER MATTERS, AND THIS IS THE CORRECT ORDER
-- ============================================================================
--
-- These statements run AFTER the create above. That is load-bearing, not
-- incidental: the revokes act on the function that the create has just
-- defined. Revoking before creating would apply to the OLD function (or
-- nothing at all, since the drops removed it) and the new function would be
-- left holding Supabase's permissive defaults.
--
-- The signature CHANGED, so nothing carries over — the new function starts
-- with Supabase's defaults, which include EXECUTE for anon and authenticated
-- granted DIRECTLY rather than through PUBLIC. `revoke from public` alone
-- does NOT touch them. Standing rule from
-- 20260922135021_lock_split_creation_rpc_to_service_role.sql: revoke anon and
-- authenticated BY NAME, revoke public belt-and-braces, grant service_role,
-- then verify the catalog.
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text, uuid, text) from anon;
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text, uuid, text) from authenticated;
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text, uuid, text) from public;
grant  execute on function public.admin_create_split_orders(jsonb, jsonb, text, uuid, text) to service_role;

-- ============================================================================
-- POST-APPLY VERIFICATION — run by hand, trust the catalog, not the SQL
-- ============================================================================
--
--   select p.oid::regprocedure                        as signature,
--          p.prosecdef                                as is_security_definer,
--          p.proacl                                   as acl
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname = 'admin_create_split_orders';
--
-- EXPECT EXACTLY ONE ROW:
--
--   signature  admin_create_split_orders(jsonb,jsonb,text,uuid,text)
--   prosecdef  false
--   proacl     {postgres=X/postgres,service_role=X/postgres}
--
-- Read the ACL, not just the row count. proacl is the assertion that matters:
-- anon or authenticated appearing in it means the lockdown did not happen,
-- which is exactly the failure 20260922134956 shipped with and 135021 had to
-- come back and fix. A second row means a drop did not take and a stale-arity
-- landmine is still callable.
