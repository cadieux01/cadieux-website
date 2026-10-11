-- Append-only protection for the audit_log table.
--
-- The admin UI only reads + inserts (no PATCH/DELETE endpoint exists
-- anywhere in the codebase), but the service-role key technically has
-- the privilege to UPDATE/DELETE any row. These triggers close that
-- gap at the database level so even a compromised service-role caller
-- can't rewrite history.
--
-- Idempotent: re-running the file safely replaces the function and
-- recreates the triggers.
--
-- ALREADY LIVE IN PRODUCTION, but NOT in the remote migration ledger
-- (verified 2026-10-11: both triggers present and enabled; the ledger's
-- latest row is 20261002045742). It lived in `sql/` until now, outside this
-- directory, which meant a freshly provisioned database got none of this
-- protection — that is the only reason it was moved here. Applying it to the
-- existing production database is a harmless no-op thanks to the
-- `create or replace` / `drop trigger if exists` above; the ledger row has
-- deliberately NOT been repaired, because that is a production write for a
-- documentation benefit. See ./README.md before running anything.

begin;

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

drop trigger if exists audit_log_no_update on public.audit_log;
create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();

drop trigger if exists audit_log_no_delete on public.audit_log;
create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();

commit;
