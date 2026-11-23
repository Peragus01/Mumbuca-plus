create table users (
  id uuid primary key, handle text not null unique, display_name text not null,
  wallet_address text not null unique, created_at timestamptz not null default now());
create table payments (
  id uuid primary key, user_id uuid not null references users(id),
  provider text not null, provider_env text not null, provider_payment_id text,
  requested_amount_cents bigint not null, received_amount_cents bigint,
  status text not null, pix_br_code text, pix_expires_at timestamptz,
  payment_ref text unique, mint_amount_wei text, tx_hash text, block_number bigint,
  needs_review boolean not null default false, amount_mismatch boolean not null default false,
  failure_reason text, last_error text, attempts int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id));
create table payment_events (
  id bigserial primary key, payment_id uuid references payments(id),
  kind text not null, from_status text, to_status text, provider_event_id text,
  detail jsonb, created_at timestamptz not null default now());
create unique index payment_events_provider_event on payment_events(provider_event_id) where provider_event_id is not null;
create table simulated_charges (
  id text primary key, amount_cents bigint not null, status text not null, created_at timestamptz not null default now());
