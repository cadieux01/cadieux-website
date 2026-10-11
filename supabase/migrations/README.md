# Do not run `supabase db push` against this repo

Read this before touching anything in this directory.

## The landmine

`20260710120000_create_whatsapp_conversations.sql` is **not** in the remote
migration history (`supabase_migrations.schema_migrations`), but
`public.whatsapp_conversations` **exists in production and holds live customer
conversations** — 20 of them as of 2026-09-11.

The table was created by two differently-versioned migrations that *are*
recorded. This file is a third, unrecorded description of the same table.

`supabase db push` applies every local file absent from remote history. It will
therefore attempt this one. What happens next depends on whether the statements
inside are idempotent — and nobody should be finding that out against a table
with real customer data in it.

**Nobody runs `db push` here until either the history row is repaired
(`supabase migration repair --status applied 20260710120000`) or this file is
made idempotent.** Neither has been done. This note is a record, not a fix.

The same warning is now repeated in the header of
`20260710120000_create_whatsapp_conversations.sql` itself, because that header
previously claimed the table was "NOT YET APPLIED to production. Review-only."
— the exact opposite of the truth, and the only text a person opening that file
would have read.

## Files here that are absent from the remote ledger

Checked 2026-10-11: the remote ledger holds 138 rows, latest
`20261002045742`. This directory holds 25 files. Everything after
`20261002045742` is therefore unapplied by definition.

| File | Status | Safe to re-run? |
| --- | --- | --- |
| `20260710120000_create_whatsapp_conversations.sql` | table exists in prod with live data; not in ledger | **NO — see the file header** |
| `20261011093000_audit_log_tamper_protection.sql` | triggers exist in prod; not in ledger | yes — `create or replace` + `drop trigger if exists` throughout |

The tamper-protection file was moved here from `sql/` so a fresh environment
gets the `audit_log` append-only triggers, which previously existed only
outside this directory and so were silently missing from any new database.

## Why this went unnoticed

The CLI in this worktree has no credentials — no `SUPABASE_ACCESS_TOKEN`, no
`SUPABASE_DB_PASSWORD` — so `supabase migration list --linked` fails with a 401
and the drift between these filenames and the remote history is invisible from
here. The project ref in `supabase/.temp/project-ref` points at **production**,
which is what makes an unreviewed `db push` dangerous rather than merely untidy.

## Consequence for the workflow

Migrations in this repo are applied **by hand**, and a filename here is
documentation rather than proof that anything ran. If you add one, say so in its
header, and keep every statement idempotent so that re-running it is a harmless
no-op rather than a failure.
