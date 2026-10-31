-- TABLE21 initial schema. All money columns are integer half-coin units (2 units = 1 coin).

create table users (
  id text primary key,
  name text not null,
  avatar text not null,
  friend_code text not null unique,
  locale text not null default 'he',
  card_back text not null default 'classic',
  table_theme text not null default 'emerald',
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index sessions_user on sessions(user_id);

-- scope: 'casual' for the persistent wallet, 'match:<matchId>' for an equal-stack match stack.
create table wallets (
  id text primary key,
  user_id text not null references users(id),
  scope text not null,
  available_units bigint not null check (available_units >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, scope)
);

create table ledger (
  id bigserial primary key,
  wallet_id text not null references wallets(id),
  kind text not null check (kind in (
    'grant_welcome', 'grant_daily', 'grant_rescue', 'grant_ad', 'match_stack',
    'stake_reserve', 'stake_release', 'stake_return', 'refund', 'adjustment')),
  delta_available bigint not null,
  delta_reserved bigint not null,
  room_id text,
  round_id text,
  command_id text,
  idem_key text unique,
  created_at timestamptz not null default now()
);
create index ledger_wallet on ledger(wallet_id, id);

create table grant_claims (
  user_id text not null references users(id),
  kind text not null,
  period_key text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, kind, period_key)
);

create table groups (
  id text primary key,
  name text not null,
  code text not null unique,
  owner_id text not null references users(id),
  created_at timestamptz not null default now()
);

create table group_members (
  group_id text not null references groups(id),
  user_id text not null references users(id),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on group_members(user_id);

create table friendships (
  user_a text not null references users(id),
  user_b text not null references users(id),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

create table rooms (
  id text primary key,
  code text not null,
  owner_id text not null references users(id),
  mode text not null check (mode in ('casual', 'match')),
  status text not null default 'open' check (status in ('open', 'closed')),
  settings jsonb not null,
  dealer_user_id text references users(id),
  version bigint not null default 0,
  round_number int not null default 0,
  completed_rounds int not null default 0,
  phase text not null default 'waiting',
  deadline_at timestamptz,
  shoe jsonb not null,
  group_id text references groups(id),
  match_id text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index rooms_open_code on rooms(code) where status = 'open';

create table seats (
  room_id text not null references rooms(id),
  seat_index int not null,
  user_id text not null references users(id),
  bet_units bigint not null default 0 check (bet_units >= 0),
  sitting_out boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id, seat_index)
);
-- v1: a player may hold exactly one wagering seat across all rooms.
create unique index seats_one_per_user on seats(user_id);

create table rounds (
  id text primary key,
  room_id text not null references rooms(id),
  number int not null,
  status text not null,
  state jsonb not null,
  wallet_scope text not null,
  rules_version text not null,
  mode text not null,
  match_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (room_id, number)
);
create index rounds_room on rounds(room_id, number desc);

create table settlements (
  round_id text not null references rounds(id),
  user_id text not null references users(id),
  kind text not null check (kind in ('settle', 'void')),
  stake_units bigint not null,
  return_units bigint not null,
  created_at timestamptz not null default now(),
  primary key (round_id, user_id)
);

create table hand_results (
  id bigserial primary key,
  round_id text not null references rounds(id),
  room_id text not null references rooms(id),
  user_id text not null references users(id),
  hand_index int not null,
  stake_units bigint not null,
  return_units bigint not null,
  net_units bigint not null,
  outcome text not null,
  is_natural boolean not null,
  mode text not null,
  rules_version text not null,
  match_id text,
  created_at timestamptz not null default now(),
  unique (round_id, user_id, hand_index)
);
create index hand_results_user_time on hand_results(user_id, created_at);

create table commands (
  user_id text not null references users(id),
  command_id text not null,
  room_id text,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, command_id)
);

create table matches (
  id text primary key,
  room_id text not null references rooms(id),
  status text not null check (status in ('lobby', 'running', 'finished')),
  rounds_total int not null,
  rounds_played int not null default 0,
  stack_units bigint not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table match_entries (
  match_id text not null references matches(id),
  user_id text not null references users(id),
  wallet_id text not null references wallets(id),
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
