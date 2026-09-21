-- ============================================================
-- PCG Map - weekly Buffalo Wild Wings new-store scan
-- Run this in the Supabase SQL editor BEFORE deploying the scan.
-- Safe to run more than once.
-- ============================================================

create table if not exists public.bww_scan_stores (
    id          serial primary key,
    store_id    text not null unique,
    state       text not null check (state in ('pa', 'nj')),
    city        text not null,
    address     text not null,
    source_url  text,
    lat         float8,
    lng         float8,
    status      text not null default 'pending'
                check (status in ('baseline', 'pending', 'approved', 'rejected')),
    first_seen  timestamptz not null default now(),
    reviewed_at timestamptz
);

create table if not exists public.bww_scan_runs (
    id        serial primary key,
    ran_at    timestamptz not null default now(),
    total     int,
    new_count int,
    note      text
);

-- Row-level security ON with no policies: only the service-role key
-- (used by the Netlify functions) can read or write these tables.
alter table public.bww_scan_stores enable row level security;
alter table public.bww_scan_runs   enable row level security;
