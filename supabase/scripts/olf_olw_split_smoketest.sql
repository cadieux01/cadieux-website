-- Smoke test for public.admin_create_split_orders.
--
-- STANDALONE — this file is NOT a migration. Lives under supabase/scripts/
-- so the migration tool never runs it automatically. It is what you run
-- AFTER applying 20260922030100_orders_add_split_creation_rpc.sql to
-- prove the function actually does what the migration promises.
--
-- WHAT IT PROVES:
--
--   Test 1  MINIMAL PAYLOAD. Sends a payload that OMITS the seven
--           NOT NULL columns that carry defaults (id, items,
--           delivery_fee, payment_status, fulfillment_type, is_preorder,
--           order_kind). This is the scenario the first draft of the
--           RPC broke on: jsonb_populate_record wrote NULL for absent
--           keys instead of falling back to the column default. The
--           dynamic-column-list rewrite must not mention absent columns
--           in the INSERT, so defaults apply. Assertions verify id,
--           items, fulfillment_type all populated non-null.
--
--   Test 2  FORGERY. Caller supplies order_kind='sandwich' on the
--           BREAD payload (should be overridden to 'bread') plus
--           public_ref='CX-FORGED' and order_number='OLF9999999'
--           (both should be stripped, and the trigger stamps real
--           values instead).
--
--   Test 3  BAD SHAPE. Non-object payload. Must raise SQLSTATE 22023.
--
--   Test 4  ZERO DELIVERY FEE. Under DELIVERY_FEE_SPLIT_MODE = "single"
--           (src/lib/deliveryFee.ts) the OLW row must carry a ZERO
--           delivery fee — the fee is charged on OLF alone. But
--           orders.delivery_fee is NOT NULL DEFAULT 50, so a payload
--           that OMITS the key silently gets ₹50, not ₹0. That is the
--           trap: the RPC's dynamic column list correctly omits an
--           absent key from the INSERT, and the column then applies its
--           default. Test 4 sends delivery_fee => 0 EXPLICITLY on the
--           sandwich payload and asserts it lands as 0, proving the
--           behaviour step 5 (route wiring) depends on. Cheap to prove
--           now, expensive to catch after a live split.
--
-- HOW IT RUNS:
--
--   Wrapped in `begin; ... rollback;`. Nothing lands. Sequence numbers
--   ARE burned regardless — that is the price of proof and it is
--   already policy (see plan §1 on OLF285). Roughly THREE OLF + THREE
--   OLW numbers burned per run (one successful call per Test 1/2/4;
--   Test 3 raises before any insert). Do not run this in a loop.
--
-- BEFORE RUNNING:
--
--   1. Replace <REPLACE_ME_CUSTOMER_UUID> below with a real UUID from
--      public.customers. Any existing customer works — no rows are
--      committed. Do not invent one; the FK will refuse.
--
--   2. Run against the SAME database the migration was applied to.
--      Copy-paste into psql or the Supabase SQL editor. Look for
--      "ALL SMOKE TESTS PASSED" at the bottom of the notices — the
--      per-test PASS lines are milestones, the final line is the
--      only one that means the whole thing worked.
--
--   3. If any ASSERT fails, the transaction rolls back and Postgres
--      raises with the assertion message. That is the report.

begin;

do $$
declare
  v_cust     uuid := '<REPLACE_ME_CUSTOMER_UUID>'::uuid;
  v_result   record;
  v_bread    public.orders;
  v_sand     public.orders;
begin
  ------------------------------------------------------------------
  -- Test 1: MINIMAL payload proves column defaults apply.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     100,
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created'
    ),
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     109,
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created'
    ),
    'order_smoke_test_do_not_ship'
  );

  raise notice 'Test 1 minimal payload: bread=%, sandwich=%, group=%',
    v_result.bread_number, v_result.sandwich_number, v_result.payment_group_id;

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  -- Column defaults (the seven that would have gone NULL in draft 1):
  assert v_bread.id is not null, 'bread.id default did not apply (BUG 1 REGRESSION)';
  assert v_sand.id is not null,  'sandwich.id default did not apply (BUG 1 REGRESSION)';
  assert v_bread.items is not null,             'bread.items default did not apply';
  -- ACTUAL VALUE, not just non-nullness. orders.delivery_fee is NOT NULL
  -- DEFAULT 50. Absence-of-value is the WRONG assertion here: a default
  -- of 50 is exactly the trap Test 4 exists to catch. If the default
  -- ever changes to 0 or NULL, this assert fires and Test 4 needs a
  -- re-read.
  assert v_bread.delivery_fee = 50,             'bread delivery_fee default changed';
  assert v_bread.payment_status is not null,    'bread.payment_status was null';
  assert v_bread.fulfillment_type is not null,  'bread.fulfillment_type default did not apply';
  assert v_bread.is_preorder is not null,       'bread.is_preorder default did not apply';
  assert v_bread.order_kind is not null,        'bread.order_kind not set';

  -- Trigger did its job:
  assert v_bread.order_number like 'OLF%', 'bread number is not OLF';
  assert v_sand.order_number  like 'OLW%', 'sandwich number is not OLW';
  assert v_bread.public_ref is not null,   'bread.public_ref not stamped by trigger';
  assert v_sand.public_ref  is not null,   'sandwich.public_ref not stamped by trigger';

  -- RPC stamped values propagated:
  assert v_bread.order_kind = 'bread',                  'bread.order_kind wrong';
  assert v_sand.order_kind  = 'sandwich',               'sandwich.order_kind wrong';
  assert v_bread.payment_group_id = v_sand.payment_group_id, 'group ids differ';
  assert v_bread.payment_group_id is not null,          'group id null';
  assert v_bread.razorpay_order_id = 'order_smoke_test_do_not_ship', 'bread rzp id lost';
  assert v_sand.razorpay_order_id  = 'order_smoke_test_do_not_ship', 'sandwich rzp id lost';

  raise notice 'Test 1: PASS';

  ------------------------------------------------------------------
  -- Test 2: forgery attempts must be overridden / stripped.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     100,
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created',
      -- forgeries below
      'order_kind',       'sandwich',
      'public_ref',       'CX-FORGED',
      'order_number',     'OLF9999999',
      'payment_group_id', gen_random_uuid()
    ),
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     109,
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created'
    ),
    'order_smoke_test_do_not_ship_2'
  );

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  assert v_bread.order_kind = 'bread',
    'forged order_kind not overridden — CALLER CAN FORGE KIND';
  assert v_bread.public_ref is distinct from 'CX-FORGED',
    'forged public_ref not stripped — CALLER CAN PIN public_ref';
  assert v_bread.order_number is distinct from 'OLF9999999',
    'forged order_number not stripped — CALLER CAN PIN order_number';
  assert v_bread.order_number like 'OLF%',
    'bread number not stamped by trigger after strip';
  assert v_bread.payment_group_id = v_sand.payment_group_id,
    'forged payment_group_id not overridden — CALLER CAN PIN GROUP';

  raise notice 'Test 2 forgery: PASS';

  ------------------------------------------------------------------
  -- Test 4: explicit delivery_fee => 0 on the sandwich payload must
  -- LAND as 0, not fall back to the ₹50 column default. This is what
  -- DELIVERY_FEE_SPLIT_MODE = "single" needs at step 5 — one fee on
  -- OLF, zero on OLW. The dynamic column list mentions delivery_fee
  -- when the key IS present, so 0 must be preserved verbatim.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     100,
      'delivery_fee',     50,   -- bread carries the whole fee
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created'
    ),
    jsonb_build_object(
      'customer_id',      v_cust,
      'total_amount',     109,
      'delivery_fee',     0,    -- sandwich carries zero (single-mode)
      'delivery_address', 'smoke test — DO NOT SHIP',
      'delivery_date',    current_date::text,
      'delivery_slot',    '10:00-14:00',
      'status',           'pending',
      'payment_method',   'razorpay',
      'payment_status',   'created'
    ),
    'order_smoke_test_do_not_ship_3'
  );

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  assert v_bread.delivery_fee = 50,
    'bread.delivery_fee not preserved (expected 50, got other)';
  assert v_sand.delivery_fee = 0,
    'sandwich.delivery_fee not preserved (expected 0 — SPLIT MODE SINGLE WOULD DOUBLE-CHARGE)';

  raise notice 'Test 4 zero delivery_fee: PASS (bread=50, sandwich=0)';

  ------------------------------------------------------------------
  -- Test 3: bad shape → SQLSTATE 22023.
  ------------------------------------------------------------------
  begin
    perform public.admin_create_split_orders(
      '"not an object"'::jsonb,
      jsonb_build_object('customer_id', v_cust),
      null
    );
    raise exception 'Test 3 did NOT raise as expected';
  exception when sqlstate '22023' then
    raise notice 'Test 3 non-object payload: PASS (raised 22023)';
  end;

  raise notice 'ALL SMOKE TESTS PASSED';
end $$;

rollback;
