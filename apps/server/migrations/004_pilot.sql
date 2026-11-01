-- Free-tier pilot: retries after a cold start must not create a second guest, room or club.
-- One row per (scope, key). The row is written in the same transaction as the thing it creates, so a retry either
-- waits for that transaction and replays its result, or (if it rolled back) creates the thing once.
create table idempotency_keys (
  scope text not null,
  key text not null,
  user_id text,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);
create index idempotency_keys_created on idempotency_keys (created_at)
