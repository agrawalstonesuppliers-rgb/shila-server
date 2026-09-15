-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run

create table if not exists leads (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name text,
  phone text,
  email text,
  message text,
  transcript jsonb,
  page text,
  source text
);

-- Lock the table down: only the server (using the service key) can read/write.
-- Nothing is exposed to the public internet.
alter table leads enable row level security;
