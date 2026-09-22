-- HELD — NOT APPLIED. Sunny to review before running.
--
-- Three rows on public.app_config that gate the sandwich kitchen. All three
-- default OFF/closed and must be flipped by admin. Every row is idempotent
-- (on conflict do nothing — an existing operator-set value is NEVER
-- overwritten by a migration).
--
--   sandwich_kitchen_enabled   'false' — master switch. When false, sandwich
--                              orders cannot be created and admin surfaces
--                              show the kitchen as closed. Only 'true' opens
--                              it.
--
--   sandwich_kitchen_open      '13:00' IST — earliest a sandwich order can be
--                              placed. Wall-clock, HH:MM, 24-hour.
--
--   sandwich_kitchen_close     '23:00' IST — latest a sandwich order can be
--                              placed. Enforcement is server-side, not client
--                              — the customer's clock is not authoritative.
--
-- All timestamps are IST wall-clock strings, not stored as `time` or
-- `timestamptz`, because the operator surface reads and writes them as
-- literal "13:00"/"23:00" and every reader parses to IST. Storing them as
-- `time` would drop the timezone hint that matters most in the string.

insert into public.app_config (key, value) values
  ('sandwich_kitchen_enabled', 'false'),
  ('sandwich_kitchen_open',    '13:00'),
  ('sandwich_kitchen_close',   '23:00')
on conflict (key) do nothing;
