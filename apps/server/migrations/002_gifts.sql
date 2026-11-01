-- Table gifts: visual gestures only. No coin value, nothing is credited to the recipient.
create table gift_events (
  id text primary key,
  room_id text not null references rooms(id),
  sender_id text not null references users(id),
  recipient_id text not null references users(id),
  gift_id text not null,
  client_event_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (sender_id, client_event_id)
);
create index gift_events_room_active on gift_events(room_id, expires_at);
create index gift_events_sender_time on gift_events(sender_id, created_at);
