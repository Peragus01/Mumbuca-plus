create table auth_challenges (
  nonce text primary key, wallet_address text not null, message text not null,
  expires_at timestamptz not null, used_at timestamptz);
create table signup_ip_counts (
  ip_hash text not null, day date not null, count int not null default 0, primary key (ip_hash, day));
alter table payments add column created_via text not null default 'operator'
  check (created_via in ('operator','visitor'));
create index payments_user_created_idx on payments (user_id, created_at);
create index payments_visitor_created_idx on payments (created_at) where created_via = 'visitor';
