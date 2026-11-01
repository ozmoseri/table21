-- Stage C: persistent identity, session lifecycle, recovery and pairing codes, invite links, blocks.
-- users.id stays the only internal identifier. Provider identities are attached to it; nothing is merged by email.

alter table users add column deleted_at timestamptz;

-- Sessions get a public id (for listing and revoking without exposing the token hash), expiry, revocation and rotation audit.
alter table sessions add column id text;
update sessions set id = 's_' || md5(token_hash || random()::text);
alter table sessions alter column id set not null;
create unique index sessions_public_id on sessions(id);
alter table sessions add column expires_at timestamptz;
update sessions set expires_at = created_at + interval '400 days';
alter table sessions alter column expires_at set not null;
alter table sessions add column revoked_at timestamptz;
alter table sessions add column revoke_reason text;
alter table sessions add column rotated_from text;
alter table sessions add column label text not null default '';

-- One row per (provider, subject). The provider subject identifies the person; email is informational only.
create table auth_identities (
  id text primary key,
  user_id text not null references users(id),
  provider text not null check (provider in ('google', 'facebook', 'apple', 'test')),
  subject text not null,
  email text,
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (provider, subject),
  unique (user_id, provider)
);

-- Recovery codes (shown once, single use) and short-lived device pairing codes. Only hashes are stored.
create table auth_codes (
  id text primary key,
  user_id text not null references users(id),
  kind text not null check (kind in ('recovery', 'pair')),
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz
);
create index auth_codes_user on auth_codes(user_id, kind);

-- Nonces for provider ID tokens (replay protection). Single use, short expiry.
create table auth_nonces (
  nonce_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

-- Security audit trail. No tokens, codes or emails are written here.
create table auth_events (
  id bigserial primary key,
  user_id text references users(id),
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index auth_events_user on auth_events(user_id, id);

-- Invite links (our own, provider independent). Token stored hashed; limited uses, expiry, revocable.
create table invites (
  id text primary key,
  token_hash text not null unique,
  kind text not null check (kind in ('friend', 'club')),
  owner_id text not null references users(id),
  group_id text references groups(id),
  max_uses int not null check (max_uses between 1 and 50),
  uses int not null default 0 check (uses >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'club') = (group_id is not null))
);
create index invites_owner on invites(owner_id, created_at);

create table invite_uses (
  invite_id text not null references invites(id),
  user_id text not null references users(id),
  used_at timestamptz not null default now(),
  primary key (invite_id, user_id)
);

-- Blocks act in both directions for gifts, reactions, friend codes, invites and the blocker's rooms.
create table blocks (
  blocker_id text not null references users(id),
  blocked_id text not null references users(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked on blocks(blocked_id);
