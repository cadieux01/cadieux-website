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
(`supabase migration repair`) or this file is made idempotent.** Neither has
been done. This note is a record, not a fix.

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
