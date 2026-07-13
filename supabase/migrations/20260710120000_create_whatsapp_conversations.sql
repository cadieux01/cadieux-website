-- WhatsApp AI agent — conversation store (foundation, MSG91-independent).
--
-- Two tables:
--   public.whatsapp_conversations  — one row per customer phone; carries the
--                                    24-hour customer-service-window clock
--                                    (last_inbound_at) + routing status.
--   public.whatsapp_messages       — full inbound/outbound thread history,
--                                    used both as the audit trail and as the
--                                    context window we feed the AI.
--
-- Conventions mirrored from existing public tables (e.g. order_change_requests):
--   * uuid PK, gen_random_uuid() default
--   * created_at / updated_at timestamptz default now()
--   * public.touch_updated_at() BEFORE UPDATE trigger
--   * RLS enabled + a single deny-all policy for {anon, authenticated};
--     the service role bypasses RLS, so only server-side code (Edge Functions,
--     Next.js route handlers using the service key) can read/write.
--
-- NOTE: NOT YET APPLIED to production. Review-only.

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_conversations (
  id             uuid primary key default gen_random_uuid(),
  -- E.164 phone (e.g. +919170934037). One conversation per number.
  phone          text not null,
  -- Optional link to a known customer; null for unknown/first-touch numbers.
  customer_id    uuid references public.customers (id) on delete set null,
  -- Routing state: 'open' (bot may reply), 'needs_human' (escalated,
  -- bot must stay quiet), 'closed' (resolved/archived).
  status         text not null default 'open'
                   check (status in ('open', 'needs_human', 'closed')),
  -- Timestamp of the most recent INBOUND (customer -> us) message. This is
  -- the sole gate for Meta's 24-hour free-form service window.
  last_inbound_at   timestamptz,
  -- Timestamp of the most recent OUTBOUND (us -> customer) message.
  last_outbound_at  timestamptz,
  -- Timestamp of the most recent message in either direction (list sort key).
  last_message_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One conversation row per phone number.
create unique index if not exists whatsapp_conversations_phone_key
  on public.whatsapp_conversations (phone);

-- Fast "which threads are still inside the 24h window" scans + inbox sort.
create index if not exists whatsapp_conversations_last_inbound_at_idx
  on public.whatsapp_conversations (last_inbound_at desc);
create index if not exists whatsapp_conversations_last_message_at_idx
  on public.whatsapp_conversations (last_message_at desc);
create index if not exists whatsapp_conversations_status_idx
  on public.whatsapp_conversations (status);

comment on table  public.whatsapp_conversations is
  'One row per customer WhatsApp phone. Holds the 24h service-window clock (last_inbound_at) and bot/human routing status.';
comment on column public.whatsapp_conversations.last_inbound_at is
  'Most recent inbound message time. Free-form replies are only allowed while now() - last_inbound_at < 24 hours (Meta rule).';
comment on column public.whatsapp_conversations.status is
  'open = bot may auto-reply; needs_human = escalated, bot stays silent; closed = archived.';

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null
                     references public.whatsapp_conversations (id) on delete cascade,
  -- Denormalised phone for convenient filtering without a join.
  phone            text not null,
  direction        text not null check (direction in ('inbound', 'outbound')),
  -- Raw message text (WhatsApp text body). Template sends store the rendered
  -- text here too.
  body             text not null,
  -- Provider (Twilio/MSG91/Meta) message SID/ID. Null until we get one back;
  -- unique when present so webhook re-deliveries are idempotent.
  wa_message_id    text,
  -- Provider delivery lifecycle: queued/sent/delivered/read/failed/received.
  status           text,
  -- True when the body was produced by the Claude AI reply function.
  ai_generated     boolean not null default false,
  -- When the provider accepted the send (outbound) / we received it (inbound).
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Thread history in chronological order (AI context + inbox render).
create index if not exists whatsapp_messages_conversation_created_idx
  on public.whatsapp_messages (conversation_id, created_at);

-- Idempotent webhook ingest: dedupe on provider id when present.
create unique index if not exists whatsapp_messages_wa_message_id_key
  on public.whatsapp_messages (wa_message_id)
  where wa_message_id is not null;

comment on table public.whatsapp_messages is
  'Full inbound/outbound WhatsApp thread history. Doubles as the AI context window and the delivery/audit log.';
comment on column public.whatsapp_messages.wa_message_id is
  'Provider message id (Twilio/MSG91/Meta). Unique when present so redelivered webhooks are idempotent.';

-- ---------------------------------------------------------------------------
-- updated_at touch triggers (reuse existing public.touch_updated_at())
-- ---------------------------------------------------------------------------
drop trigger if exists touch_whatsapp_conversations on public.whatsapp_conversations;
create trigger touch_whatsapp_conversations
  before update on public.whatsapp_conversations
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_whatsapp_messages on public.whatsapp_messages;
create trigger touch_whatsapp_messages
  before update on public.whatsapp_messages
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Keep conversation rollups in sync on every message insert.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_bump_conversation()
returns trigger
language plpgsql
as $$
declare
  ts timestamptz := coalesce(new.sent_at, new.created_at, now());
begin
  update public.whatsapp_conversations c
     set last_message_at  = greatest(coalesce(c.last_message_at, ts), ts),
         last_inbound_at  = case
                              when new.direction = 'inbound'
                                then greatest(coalesce(c.last_inbound_at, ts), ts)
                              else c.last_inbound_at
                            end,
         last_outbound_at = case
                              when new.direction = 'outbound'
                                then greatest(coalesce(c.last_outbound_at, ts), ts)
                              else c.last_outbound_at
                            end
   where c.id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists whatsapp_messages_bump_conversation on public.whatsapp_messages;
create trigger whatsapp_messages_bump_conversation
  after insert on public.whatsapp_messages
  for each row execute function public.whatsapp_bump_conversation();

-- ---------------------------------------------------------------------------
-- 24-hour free-reply gate helper. Returns true only while the conversation is
-- inside Meta's customer-service window. Server code checks this before
-- attempting a free-form (non-template) send.
-- ---------------------------------------------------------------------------
create or replace function public.whatsapp_can_free_reply(p_phone text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select c.last_inbound_at > now() - interval '24 hours'
       from public.whatsapp_conversations c
      where c.phone = p_phone),
    false
  );
$$;

comment on function public.whatsapp_can_free_reply(text) is
  'True when the phone has sent an inbound message within the last 24h (Meta free-form service window is open).';

-- ---------------------------------------------------------------------------
-- Row Level Security — deny all for anon/authenticated. Service role bypasses.
-- ---------------------------------------------------------------------------
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages      enable row level security;

drop policy if exists deny_anon_whatsapp_conversations_all on public.whatsapp_conversations;
create policy deny_anon_whatsapp_conversations_all
  on public.whatsapp_conversations
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists deny_anon_whatsapp_messages_all on public.whatsapp_messages;
create policy deny_anon_whatsapp_messages_all
  on public.whatsapp_messages
  for all
  to anon, authenticated
  using (false)
  with check (false);
