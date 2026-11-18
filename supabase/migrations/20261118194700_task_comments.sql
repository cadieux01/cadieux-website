-- =============================================================================
-- /mkt task comments — one new table + policies mirroring tasks
-- =============================================================================
-- NOT YET APPLIED. Written for human review. Applied by Claude via the
-- Supabase MCP after a human has read it. Every statement is idempotent.
--
-- RLS RULE: whoever can see the task can see its comments. The brief's
-- phrasing "RLS matching the tasks policies exactly" is implemented by
-- gating every policy on `task_id IN (select id from logistics.tasks)`
-- — which Postgres evaluates under THE SAME tasks RLS that the caller
-- has. Any future tightening of the tasks visibility rule automatically
-- tightens comments; nothing here has to be re-stated when that happens.
--
-- COMMENT EDITING: there is no UPDATE on comments. A comment is append-
-- only. If a mistake has to be corrected, delete and re-post — same
-- shape as order_notes in public (closest sibling table), and simpler
-- than tracking an edit history for a Phase 1 feature.
-- =============================================================================


create table if not exists logistics.task_comments (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references logistics.tasks(id) on delete cascade,
  author_id   uuid references logistics.profiles(id) on delete set null,
  body        text not null check (length(trim(body)) > 0 and length(body) <= 4000),
  created_at  timestamptz not null default now()
);

create index if not exists task_comments_task_idx on logistics.task_comments (task_id, created_at);

alter table logistics.task_comments enable row level security;


-- SELECT: the caller can see a comment iff they can see its task.
-- The subquery runs under the caller's RLS context, so the shape
-- is: this comment's task_id must be a row the tasks_select policy
-- admits. Direct mirror of the "RLS matching the tasks policies
-- exactly" requirement — one source of truth (tasks_select) decides
-- both.
drop policy if exists task_comments_select on logistics.task_comments;
create policy task_comments_select on logistics.task_comments for select to authenticated
  using (
    task_id in (select id from logistics.tasks)
  );

-- INSERT: author must be the caller AND the task must be visible
-- to them. A non-admin cannot post on someone else's behalf; admins
-- can set author_id directly if needed via the UPDATE-less write path
-- (service role), which is outside the row-owner UPDATE policy on
-- purpose.
drop policy if exists task_comments_insert on logistics.task_comments;
create policy task_comments_insert on logistics.task_comments for insert to authenticated
  with check (
         author_id = auth.uid()
    and  task_id   in (select id from logistics.tasks)
  );

-- NO UPDATE policy — comments are append-only. Read the module
-- comment for why.

-- DELETE: the author of the comment OR admin. A team leader cannot
-- delete someone else's comment — censoring a teammate quietly is
-- not a shape we want this surface to make easy.
drop policy if exists task_comments_delete on logistics.task_comments;
create policy task_comments_delete on logistics.task_comments for delete to authenticated
  using (
       logistics.is_admin()
    or author_id = auth.uid()
  );
