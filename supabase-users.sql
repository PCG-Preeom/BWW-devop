-- Run this in the Supabase SQL editor before deploying the new login.
-- Creates the profiles table that maps auth.users -> username/role/status.
-- RLS is enabled with no policies: only the service-role key (used by
-- Netlify functions) can read or write this table.

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique not null,
    role text not null default 'user' check (role in ('admin', 'user')),
    must_change_password boolean not null default true,
    active boolean not null default true,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
