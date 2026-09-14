-- Atomic admin order edit + paired order_notes writes, in one plpgsql
-- transaction. supabase-js cannot do this from the client side because
-- .update() and .insert() are separate round trips with no transaction
-- around them, and this touches money: an edit that changes
-- total_amount on a paid order MUST leave a paired 'note' row so the
-- Paid / Outstanding reconciliation view is never silently wrong.
--
-- The API handler builds three jsonb payloads and calls this once:
--
--   p_order_id      uuid       — order to update
--   p_updates       jsonb      — sparse column -> new value map. Only
--                                the whitelisted keys below are honoured;
--                                every other key raises. A key that is
--                                present with a JSON null value writes
--                                SQL NULL to that column (that IS an
--                                edit — e.g. clearing delivery_slot).
--   p_customer_note jsonb      — { body text, author text, meta jsonb }
--                                for the kind='edit', customer_visible=true
--                                row. NULL → no customer note (e.g. an
--                                internal-only fix that shouldn't show
--                                on the tracking page).
--   p_money_note    jsonb      — { body text, author text, meta jsonb }
--                                for the kind='note', customer_visible=false
--                                row that records "REFUND DUE" or "COLLECT".
--                                NULL → no money note (COD path, or
--                                total_amount didn't change).
--
-- On any raise, the whole transaction rolls back — the orders UPDATE,
-- the customer note, and the money note either all land or none do.
-- The `trg_audit_orders` -> `logistics.capture_public_audit` row is
-- written by the trigger on commit, so rolled-back attempts leave zero
-- forensic trace, which is what we want.
--
-- SECURITY DEFINER so the function can insert into order_notes without
-- being blocked by the (deny-all) RLS. EXECUTE is granted to
-- service_role only; anon and authenticated never call this directly.

create or replace function public.admin_edit_order(
  p_order_id      uuid,
  p_updates       jsonb,
  p_customer_note jsonb,
  p_money_note    jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_allowed constant text[] := array[
    'delivery_date',
    'delivery_slot',
    'delivery_address',
    'items',
    'total_amount',
    'delivery_fee',
    'latitude',
    'longitude',
    'distance_km'
  ];
begin
  if p_order_id is null then
    raise exception 'admin_edit_order: p_order_id required';
  end if;

  -- Whitelist check. Anything not in v_allowed is rejected so a client
  -- mistake can never write to status / refund_status / payment_status
  -- via this path — those transitions have their own handlers with
  -- their own side-effects (push, refund, audit).
  if p_updates is not null and jsonb_typeof(p_updates) = 'object' then
    for v_key in select jsonb_object_keys(p_updates) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'admin_edit_order: field % not allowed', v_key;
      end if;
    end loop;

    -- Single UPDATE using `case when p_updates ? 'k' then ... else k end`
    -- so only the keys actually present in the jsonb are touched.
    -- `->>` returns SQL NULL when the JSON value is null, which is the
    -- intended semantic — an explicit null clears the column.
    update public.orders set
      delivery_date = case
        when p_updates ? 'delivery_date'
          then (p_updates->>'delivery_date')::date
        else delivery_date
      end,
      delivery_slot = case
        when p_updates ? 'delivery_slot'
          then p_updates->>'delivery_slot'
        else delivery_slot
      end,
      delivery_address = case
        when p_updates ? 'delivery_address'
          then p_updates->>'delivery_address'
        else delivery_address
      end,
      items = case
        when p_updates ? 'items'
          then p_updates->'items'
        else items
      end,
      total_amount = case
        when p_updates ? 'total_amount'
          then (p_updates->>'total_amount')::numeric
        else total_amount
      end,
      delivery_fee = case
        when p_updates ? 'delivery_fee'
          then (p_updates->>'delivery_fee')::numeric
        else delivery_fee
      end,
      latitude = case
        when p_updates ? 'latitude'
          then (p_updates->>'latitude')::double precision
        else latitude
      end,
      longitude = case
        when p_updates ? 'longitude'
          then (p_updates->>'longitude')::double precision
        else longitude
      end,
      distance_km = case
        when p_updates ? 'distance_km'
          then (p_updates->>'distance_km')::numeric
        else distance_km
      end
    where id = p_order_id;

    if not found then
      raise exception 'admin_edit_order: order % not found', p_order_id;
    end if;
  end if;

  if p_customer_note is not null then
    insert into public.order_notes (
      order_id, kind, body, author, customer_visible, meta
    ) values (
      p_order_id,
      'edit',
      coalesce(p_customer_note->>'body', ''),
      p_customer_note->>'author',
      true,
      p_customer_note->'meta'
    );
  end if;

  if p_money_note is not null then
    insert into public.order_notes (
      order_id, kind, body, author, customer_visible, meta
    ) values (
      p_order_id,
      'note',
      coalesce(p_money_note->>'body', ''),
      p_money_note->>'author',
      false,
      p_money_note->'meta'
    );
  end if;
end
$$;

-- Lock the function down BEFORE PostgREST can expose it. The moment the
-- function exists it is reachable at POST /rest/v1/rpc/admin_edit_order
-- from anon and authenticated (Supabase mints both roles a JWT-less
-- endpoint). A stray default privilege or an inherited PUBLIC grant is
-- enough for an unauthenticated caller to rewrite any order's
-- total_amount / delivery_address / delivery_date — the admin PIN is
-- not in that path. So: revoke from public (covers anon+authenticated
-- via inheritance) AND revoke from anon and authenticated EXPLICITLY,
-- so a future `grant … to authenticated` never silently re-arms this.
-- Only service_role (used by supabaseAdmin behind isAdmin-gated routes)
-- can execute. Order matters: revokes first, single grant last.
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from authenticated;
grant  execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) to service_role;

comment on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) is
  'Atomic admin order edit + paired order_notes inserts (customer-visible edit summary + optional internal money-delta note). Only whitelisted columns can be updated; anything else raises and rolls the whole transaction back. Called only by /api/admin/orders/[id] PATCH via supabase-js .rpc().';
