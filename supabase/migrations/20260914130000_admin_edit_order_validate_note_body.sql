-- Follow-up to 20260914120100_admin_edit_order_rpc.sql.
--
-- Bug: the previous version passed `coalesce(p_customer_note->>'body', '')`
-- straight into public.order_notes, which has the check constraint
-- `length(btrim(body)) between 1 and 1000`. A payload with a missing
-- or blank body therefore raised the constraint violation *inside*
-- the same transaction as the orders UPDATE — rolling the entire
-- edit back with an opaque "check constraint order_notes_body_check
-- violated" error rather than a caller-usable message.
--
-- Fix: validate the note bodies BEFORE the orders UPDATE runs, and
-- raise a clear exception naming which field is empty. Same for
-- length: 1..1000 is enforced in the RPC as well as by the check
-- constraint, so a caller learns "your body is too long" rather than
-- "constraint order_notes_body_check violated".
--
-- Also: distance_km cast tightened from ::numeric to
-- ::double precision to match the column type. The old cast worked
-- (CASE coerces at the column boundary) but was misleading.
--
-- Function signature unchanged. Grants / revokes / SECURITY DEFINER
-- unchanged. This is a create-or-replace of the exact same argument
-- list so PostgREST route stability is preserved.

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
  v_customer_body text;
  v_money_body text;
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

  -- Validate note bodies UP FRONT so a bad payload raises a clear
  -- error before the orders UPDATE, not an opaque check-constraint
  -- violation after. Trim first, then bounds-check against the same
  -- 1..1000 range order_notes' own constraint enforces.
  if p_customer_note is not null then
    v_customer_body := btrim(coalesce(p_customer_note->>'body', ''));
    if v_customer_body = '' then
      raise exception 'admin_edit_order: p_customer_note.body must be a non-empty string';
    end if;
    if length(v_customer_body) > 1000 then
      raise exception 'admin_edit_order: p_customer_note.body exceeds 1000 characters (got %)', length(v_customer_body);
    end if;
  end if;

  if p_money_note is not null then
    v_money_body := btrim(coalesce(p_money_note->>'body', ''));
    if v_money_body = '' then
      raise exception 'admin_edit_order: p_money_note.body must be a non-empty string';
    end if;
    if length(v_money_body) > 1000 then
      raise exception 'admin_edit_order: p_money_note.body exceeds 1000 characters (got %)', length(v_money_body);
    end if;
  end if;

  if p_updates is not null and jsonb_typeof(p_updates) = 'object' then
    for v_key in select jsonb_object_keys(p_updates) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'admin_edit_order: field % not allowed', v_key;
      end if;
    end loop;

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
          then (p_updates->>'distance_km')::double precision
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
      v_customer_body,
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
      v_money_body,
      p_money_note->>'author',
      false,
      p_money_note->'meta'
    );
  end if;
end
$$;

-- Grants are unchanged by create-or-replace, but re-assert them so a
-- future manual `drop function` followed by re-apply of just this
-- migration cannot land a wide-open function.
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) from authenticated;
grant  execute on function public.admin_edit_order(uuid, jsonb, jsonb, jsonb) to service_role;
