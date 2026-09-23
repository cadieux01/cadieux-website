-- Smoke test for public.admin_create_split_orders.
--
-- STANDALONE — NOT a migration. Lives under supabase/scripts/ so the
-- migration tool never runs it automatically. Run it AFTER applying the
-- split-creation RPC migration to prove the function does what the
-- migration promises.
--
-- TARGETS THE 5-ARGUMENT SIGNATURE
--   (p_bread jsonb, p_sandwich jsonb, p_fulfillment_type text,
--    p_pickup_location_id uuid, p_razorpay_order_id text default null)
-- introduced by 20260923115206_split_orders_rpc_take_fulfillment_as_argument,
-- applied to prod 2026-09-23. (That file was written as 20260923043000 and
-- renamed to its minted ledger version; this reference follows the rename.)
--
-- LAST RUN: 2026-09-23 against prod, immediately after the apply. All 16
-- subtests PASSED. Nothing landed — verified after the rollback: 0 rows
-- matching either smoke marker, 0 sandwich rows, orders total unchanged
-- at 299.
--
--   "function does not exist"  → that migration is not applied here.
--   a stale-arity call resolves → a drop did not take; check pg_proc for
--                                 more than one row and stop.
--
-- ============================================================================
-- WHAT IT PROVES
-- ============================================================================
--
--   Test 1  BASELINE DELIVERY GROUP. All required keys present. Proves the
--           supplied values land verbatim, the stamped values land on BOTH
--           rows, and the columns that legitimately carry defaults
--           (is_preorder, payment_status, id) still get them.
--
--   Test 2  FORGERY. Caller supplies order_kind, public_ref, order_number,
--           a foreign payment_group_id, and — on OPPOSITE sides —
--           fulfillment_type and pickup_location_id. Opposite forgeries are
--           deliberate: a bug that honoured payload values would produce a
--           DIVERGENT pair, and the asserts would catch it in both
--           directions rather than in one.
--
--   Test 3  BAD SHAPE. Non-object payload → 22023.
--
--   Test 4  PER-ORDER DELIVERY FEE. DELIVERY_FEE_SPLIT_MODE = "per_order"
--           (src/lib/deliveryFee.ts): two rider trips, two fees,
--           DELIVERY_FEE_FLAT_INR = 12 on EACH row.
--
--   Test 5  PICKUP GROUP. Both rows must read 'pickup' and carry the same
--           pickup_location_id. Before the argument-stamping rewrite, a
--           pickup group whose payloads omitted fulfillment_type produced
--           two rows reading 'delivery' with no error anywhere.
--
--   Test 6  INVALID FULFILMENT → 22023. Wrong case, junk, and NULL.
--
--   Test 7  MISSING REQUIRED KEY → 22023, once per key, on both payload
--           sides, plus the present-but-JSON-null variant. THE CORE OF THE
--           DEFECT CLASS: each of these used to succeed silently and write
--           a column default that looked plausible and was wrong.
--
--   Test 8  PICKUP-LOCATION CONTRACT → 22023 in both directions.
--
-- ============================================================================
-- A TRAP IN THE NEGATIVE TESTS — READ BEFORE EDITING
-- ============================================================================
--
--   The RPC validates in ORDER: shape → required-present → fulfilment →
--   pickup contract. So a negative test for fulfilment or the pickup
--   contract must send OTHERWISE-COMPLETE payloads. Send a stub payload and
--   it raises 22023 from the required-present check instead, the test goes
--   green, and it proved nothing about the thing it is named after.
--
--   That is why Tests 6 and 8 build off v_base_bread / v_base_sand rather
--   than inlining minimal objects. Keep it that way.
--
--   (Test 7 is the exception and is allowed to send incomplete payloads —
--   incompleteness is its subject.)
--
-- ============================================================================
-- HOW IT RUNS
-- ============================================================================
--
--   Wrapped in `begin; ... rollback;`. Nothing lands. Sequence numbers ARE
--   burned regardless — the price of proof, already policy (plan §1,
--   OLF285). FOUR successful calls per run (Tests 1, 2, 4, 5), so roughly
--   FOUR OLF + FOUR OLW numbers burned. Tests 3, 6, 7 and 8 raise before
--   any insert. Do not run this in a loop.
--
-- BEFORE RUNNING:
--
--   1. Replace <REPLACE_ME_CUSTOMER_UUID> with a real UUID from
--      public.customers. Any existing customer works — nothing is
--      committed. Do not invent one; the FK will refuse.
--
--   2. The pickup location UUID is generated, not looked up: there is NO FK
--      from orders.pickup_location_id to pickup_locations.id (see
--      src/lib/order-notification.ts:287). If that FK is ever added, Test 5
--      starts failing on the FK and needs a real id here.
--
--   3. Run against the SAME database the migration was applied to. Look for
--      "ALL SMOKE TESTS PASSED" at the bottom of the notices — the per-test
--      PASS lines are milestones; the final line is the only one that means
--      the whole thing worked.
--
--   4. If any ASSERT fails, the transaction rolls back and Postgres raises
--      with the assertion message. That is the report.

begin;

do $$
declare
  v_cust        uuid := '<REPLACE_ME_CUSTOMER_UUID>'::uuid;
  v_pickup_loc  uuid := gen_random_uuid();
  v_result      record;
  v_bread       public.orders;
  v_sand        public.orders;

  -- Complete, valid payloads. Negative tests layer their one defect on top
  -- with || so that the defect under test is the ONLY thing wrong.
  v_base_bread  jsonb := jsonb_build_object(
    'customer_id',      v_cust,
    'items',            '[{"slug":"high-protein","qty":1}]'::jsonb,
    'total_amount',     112,
    'delivery_fee',     12,
    'delivery_address', 'smoke test — DO NOT SHIP',
    'delivery_date',    current_date::text,
    'delivery_slot',    '10:00-14:00',
    'status',           'pending',
    'payment_method',   'razorpay',
    'payment_status',   'created'
  );
  v_base_sand   jsonb := jsonb_build_object(
    'customer_id',      v_cust,
    'items',            '[{"slug":"club-sandwich","qty":1}]'::jsonb,
    'total_amount',     131,   -- 109 sandwich + 12 delivery + 10 packaging
    'delivery_fee',     12,
    'delivery_address', 'smoke test — DO NOT SHIP',
    'delivery_date',    current_date::text,
    'delivery_slot',    '10:00-14:00',
    'status',           'pending',
    'payment_method',   'razorpay',
    'payment_status',   'created'
  );
begin
  ------------------------------------------------------------------
  -- Test 1: baseline delivery group.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    v_base_bread, v_base_sand,
    'delivery', null,
    'order_smoke_test_do_not_ship'
  );

  raise notice 'Test 1 baseline: bread=%, sandwich=%, group=%',
    v_result.bread_number, v_result.sandwich_number, v_result.payment_group_id;

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  -- Columns that legitimately carry defaults still get them.
  assert v_bread.id is not null,             'bread.id default did not apply (BUG 1 REGRESSION)';
  assert v_sand.id is not null,              'sandwich.id default did not apply (BUG 1 REGRESSION)';
  assert v_bread.is_preorder is not null,    'bread.is_preorder default did not apply';
  assert v_bread.payment_status is not null, 'bread.payment_status was null';

  -- Required keys land VERBATIM. Note what is NOT asserted here any more:
  -- the old test asserted delivery_fee = 50, i.e. that the ₹50 COLUMN
  -- DEFAULT applied. delivery_fee is now required-present, so that default
  -- is unreachable through this RPC and asserting it would be asserting the
  -- bug. If a future reader wants the default's value, read the catalog.
  assert v_bread.items is not null and v_bread.items <> '[]'::jsonb,
    'bread.items empty — THE WORST FAILURE: a paid order containing nothing';
  assert v_sand.items is not null and v_sand.items <> '[]'::jsonb,
    'sandwich.items empty — THE WORST FAILURE: a paid order containing nothing';
  assert v_bread.delivery_fee = 12, 'bread.delivery_fee not preserved (expected 12)';
  assert v_sand.delivery_fee  = 12, 'sandwich.delivery_fee not preserved (expected 12)';
  assert v_bread.total_amount = 112, 'bread.total_amount not preserved';
  assert v_sand.total_amount  = 131, 'sandwich.total_amount not preserved';

  -- Stamped values, on BOTH rows. Value, never non-nullness: a non-null
  -- assertion passes for a pickup order silently stamped 'delivery', which
  -- is the failure this file exists to catch.
  assert v_bread.fulfillment_type = 'delivery',
    'bread.fulfillment_type not stamped from argument (expected delivery)';
  assert v_sand.fulfillment_type = 'delivery',
    'sandwich.fulfillment_type not stamped from argument (expected delivery)';
  assert v_bread.fulfillment_type = v_sand.fulfillment_type,
    'fulfillment_type DIVERGED across the group — THE LANDMINE IS BACK';
  assert v_bread.pickup_location_id is null,
    'bread.pickup_location_id should be NULL on a delivery group';
  assert v_sand.pickup_location_id is null,
    'sandwich.pickup_location_id should be NULL on a delivery group';

  -- Trigger did its job.
  assert v_bread.order_number like 'OLF%', 'bread number is not OLF';
  assert v_sand.order_number  like 'OLW%', 'sandwich number is not OLW';
  assert v_bread.public_ref is not null,   'bread.public_ref not stamped by trigger';
  assert v_sand.public_ref  is not null,   'sandwich.public_ref not stamped by trigger';

  -- Remaining stamped values propagated.
  assert v_bread.order_kind = 'bread',                       'bread.order_kind wrong';
  assert v_sand.order_kind  = 'sandwich',                    'sandwich.order_kind wrong';
  assert v_bread.payment_group_id = v_sand.payment_group_id, 'group ids differ';
  assert v_bread.payment_group_id is not null,               'group id null';
  assert v_bread.razorpay_order_id = 'order_smoke_test_do_not_ship', 'bread rzp id lost';
  assert v_sand.razorpay_order_id  = 'order_smoke_test_do_not_ship', 'sandwich rzp id lost';

  raise notice 'Test 1 baseline delivery group: PASS';

  ------------------------------------------------------------------
  -- Test 2: forgery attempts must be overridden / stripped.
  -- Opposite forgeries on the two sides: if payload values were honoured,
  -- the pair would DIVERGE and both fulfilment asserts would fire.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    v_base_bread || jsonb_build_object(
      'order_kind',         'sandwich',
      'public_ref',         'CX-FORGED',
      'order_number',       'OLF9999999',
      'payment_group_id',   gen_random_uuid(),
      'fulfillment_type',   'pickup',
      'pickup_location_id', gen_random_uuid()
    ),
    v_base_sand || jsonb_build_object(
      'fulfillment_type',   'delivery',
      'pickup_location_id', gen_random_uuid()
    ),
    'delivery', null,
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
  assert v_bread.fulfillment_type = 'delivery',
    'forged fulfillment_type not overridden on bread — CALLER CAN FORGE FULFILMENT';
  assert v_sand.fulfillment_type = 'delivery',
    'forged fulfillment_type not overridden on sandwich — CALLER CAN FORGE FULFILMENT';
  assert v_bread.pickup_location_id is null,
    'forged pickup_location_id not overridden on bread — CALLER CAN PIN A COUNTER';
  assert v_sand.pickup_location_id is null,
    'forged pickup_location_id not overridden on sandwich — CALLER CAN PIN A COUNTER';

  raise notice 'Test 2 forgery: PASS';

  ------------------------------------------------------------------
  -- Test 4: per-order delivery fee — 12 on EACH row, two trips two fees.
  -- Asserted on values supplied explicitly by the caller; the ₹50 column
  -- default is now unreachable through this RPC (see Test 7b).
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    v_base_bread, v_base_sand,
    'delivery', null,
    'order_smoke_test_do_not_ship_3'
  );

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  assert v_bread.delivery_fee = 12,
    'bread.delivery_fee not preserved (expected 12)';
  assert v_sand.delivery_fee = 12,
    'sandwich.delivery_fee not preserved (expected 12 — PER_ORDER MODE WOULD UNDER-CHARGE)';

  raise notice 'Test 4 per-order delivery fee: PASS (bread=12, sandwich=12)';

  ------------------------------------------------------------------
  -- Test 5: PICKUP group. The regression test for the landmine.
  -- Neither payload mentions fulfillment_type or pickup_location_id —
  -- exactly the shape that used to inherit the 'delivery' column default
  -- on both rows. Fees zeroed and packaging omitted: pickup is exempt from
  -- both, and those are the CALLER's numbers, not the RPC's.
  ------------------------------------------------------------------
  select * into v_result from public.admin_create_split_orders(
    v_base_bread || jsonb_build_object('delivery_fee', 0, 'total_amount', 100),
    v_base_sand  || jsonb_build_object('delivery_fee', 0, 'total_amount', 109),
    'pickup', v_pickup_loc,
    'order_smoke_test_do_not_ship_4'
  );

  select * into v_bread from public.orders where id = v_result.bread_id;
  select * into v_sand  from public.orders where id = v_result.sandwich_id;

  assert v_bread.fulfillment_type = 'pickup',
    'bread row took the delivery DEFAULT on a pickup group — THE LANDMINE IS BACK';
  assert v_sand.fulfillment_type = 'pickup',
    'sandwich row took the delivery DEFAULT on a pickup group — THE LANDMINE IS BACK';
  assert v_bread.fulfillment_type = v_sand.fulfillment_type,
    'fulfillment_type DIVERGED across a pickup group';
  assert v_bread.pickup_location_id = v_pickup_loc,
    'bread.pickup_location_id not stamped from argument';
  assert v_sand.pickup_location_id = v_pickup_loc,
    'sandwich.pickup_location_id not stamped from argument';
  assert v_bread.pickup_location_id = v_sand.pickup_location_id,
    'pickup_location_id DIVERGED — TWO COUNTERS FOR ONE ORDER';
  assert v_bread.delivery_fee = 0 and v_sand.delivery_fee = 0,
    'pickup group carries a delivery fee';

  raise notice 'Test 5 pickup group: PASS (both rows pickup, one counter)';

  ------------------------------------------------------------------
  -- Test 3: bad shape → SQLSTATE 22023.
  ------------------------------------------------------------------
  begin
    perform public.admin_create_split_orders(
      '"not an object"'::jsonb,
      v_base_sand,
      'delivery', null, null
    );
    raise exception 'Test 3 did NOT raise as expected';
  exception when sqlstate '22023' then
    raise notice 'Test 3 non-object payload: PASS (raised 22023)';
  end;

  ------------------------------------------------------------------
  -- Test 6: invalid fulfilment → 22023.
  -- COMPLETE payloads, so the raise can only come from the fulfilment
  -- check. See "A TRAP IN THE NEGATIVE TESTS" in the header.
  ------------------------------------------------------------------

  -- 6a: wrong case. Rejected, NOT coerced.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand, 'Delivery', null, null
    );
    raise exception 'Test 6a did NOT raise — ''Delivery'' was accepted';
  exception when sqlstate '22023' then
    raise notice 'Test 6a wrong case: PASS (raised 22023)';
  end;

  -- 6b: junk value. 'dine_in' specifically — it is the fulfilment we expect
  -- to add one day, and until the CHECK constraint learns it, it must be
  -- refused rather than half-supported.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand, 'dine_in', null, null
    );
    raise exception 'Test 6b did NOT raise — junk fulfilment was accepted';
  exception when sqlstate '22023' then
    raise notice 'Test 6b junk value: PASS (raised 22023)';
  end;

  -- 6c: NULL. The CHECK constraint alone would NOT catch this
  -- (NULL = ANY(...) is NULL, and CHECK passes on NULL); only the column's
  -- NOT NULL would, two inserts later. The RPC must refuse it at the door.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand, null, null, null
    );
    raise exception 'Test 6c did NOT raise — NULL fulfilment was accepted';
  exception when sqlstate '22023' then
    raise notice 'Test 6c null fulfilment: PASS (raised 22023)';
  end;

  ------------------------------------------------------------------
  -- Test 7: MISSING REQUIRED KEY → 22023. The defect class itself.
  -- Each subtest removes ONE key from an otherwise-complete payload. Every
  -- one of these used to SUCCEED and write a plausible, wrong default.
  ------------------------------------------------------------------

  -- 7a: items missing on bread. Used to produce a paid order containing
  -- nothing (column default '[]').
  begin
    perform public.admin_create_split_orders(
      v_base_bread - 'items', v_base_sand, 'delivery', null, null
    );
    raise exception 'Test 7a did NOT raise — MISSING items ACCEPTED, ORDER WOULD CONTAIN NOTHING';
  exception when sqlstate '22023' then
    raise notice 'Test 7a missing items (bread): PASS (raised 22023)';
  end;

  -- 7b: delivery_fee missing on sandwich. Used to silently charge ₹50 —
  -- the fossil default the app charges at no distance.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand - 'delivery_fee', 'delivery', null, null
    );
    raise exception 'Test 7b did NOT raise — MISSING delivery_fee ACCEPTED, ₹50 FOSSIL WOULD APPLY';
  exception when sqlstate '22023' then
    raise notice 'Test 7b missing delivery_fee (sandwich): PASS (raised 22023)';
  end;

  -- 7c: total_amount missing on bread.
  begin
    perform public.admin_create_split_orders(
      v_base_bread - 'total_amount', v_base_sand, 'delivery', null, null
    );
    raise exception 'Test 7c did NOT raise — MISSING total_amount ACCEPTED';
  exception when sqlstate '22023' then
    raise notice 'Test 7c missing total_amount (bread): PASS (raised 22023)';
  end;

  -- 7d: customer_id missing on sandwich.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand - 'customer_id', 'delivery', null, null
    );
    raise exception 'Test 7d did NOT raise — MISSING customer_id ACCEPTED';
  exception when sqlstate '22023' then
    raise notice 'Test 7d missing customer_id (sandwich): PASS (raised 22023)';
  end;

  -- 7e: PRESENT BUT JSON NULL. {"items": null} is a caller mistake wearing
  -- the costume of a supplied value — a bare jsonb_exists() check would
  -- wave it through and the NOT NULL would raise later, unnamed.
  begin
    perform public.admin_create_split_orders(
      v_base_bread || jsonb_build_object('items', null),
      v_base_sand, 'delivery', null, null
    );
    raise exception 'Test 7e did NOT raise — JSON-null items ACCEPTED';
  exception when sqlstate '22023' then
    raise notice 'Test 7e json-null items (bread): PASS (raised 22023)';
  end;

  ------------------------------------------------------------------
  -- Test 8: pickup-location contract → 22023 in BOTH directions.
  -- Complete payloads again, so the raise can only come from the contract.
  ------------------------------------------------------------------

  -- 8a: pickup without a location. Nobody knows which counter.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand, 'pickup', null, null
    );
    raise exception 'Test 8a did NOT raise — pickup with NULL location ACCEPTED';
  exception when sqlstate '22023' then
    raise notice 'Test 8a pickup without location: PASS (raised 22023)';
  end;

  -- 8b: delivery carrying a location. This is how a row ends up on the
  -- rider board AND the counter board at once.
  begin
    perform public.admin_create_split_orders(
      v_base_bread, v_base_sand, 'delivery', v_pickup_loc, null
    );
    raise exception 'Test 8b did NOT raise — delivery with a pickup location ACCEPTED';
  exception when sqlstate '22023' then
    raise notice 'Test 8b delivery with location: PASS (raised 22023)';
  end;

  raise notice 'ALL SMOKE TESTS PASSED';
end $$;

rollback;
