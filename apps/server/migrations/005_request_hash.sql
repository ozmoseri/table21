-- Idempotency keys remember what they were used for. A retry with the same key and the same request replays the
-- first result; the same key with a different request is refused (idempotency_conflict) and changes nothing.
-- Rows written before this migration have no hash and keep replaying as before.
alter table commands add column request_hash text;
alter table idempotency_keys add column request_hash text
