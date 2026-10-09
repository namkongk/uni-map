-- Uni Map: database for live course fees, course discovery and user accounts.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run again (it only creates what's missing).

-- Latest reading for each course page. /api/refresh writes here; /api/fees reads it for every visitor.
create table if not exists public.course_fees (
  url         text primary key,          -- the course page the fee was read from (matches "url" in masters_rows.json)
  uni         text not null,             -- university name, as on the map
  fee         integer,                   -- international tuition fee per year (GBP), last successful reading
  fee_year    integer,                   -- academic year the fee is for, e.g. 2027 = 2027/28 (null if the page didn't say)
  ctx         text,                      -- the text around the fee on the page, to check it by eye
  src         text,                      -- page the fee was actually found on (can be a fees sub-page)
  via         text,                      -- how it was found: page / embedded data / fees page
  checked_at  timestamptz,               -- when that successful reading was taken
  last_error  text,                      -- most recent failure, if the last attempt failed (the fee above is kept)
  error_at    timestamptz,
  updated_at  timestamptz not null default now()
);

-- Every time a fee changes, a row is added here, so you can see how fees moved over time.
create table if not exists public.fee_history (
  id          bigint generated always as identity primary key,
  url         text not null,
  uni         text not null,
  fee         integer not null,
  fee_year    integer,
  prev_fee    integer,
  ctx         text,
  checked_at  timestamptz not null default now()
);
create index if not exists fee_history_url_idx on public.fee_history (url, checked_at desc);

-- Lock both tables: with row level security on and no policies, the public (publishable) key can't read or write them.
-- Only the server, using the secret key in Vercel's environment variables, can.
alter table public.course_fees enable row level security;
alter table public.fee_history enable row level security;

-- ---------------------------------------------------------------------------------------------------------------
-- Course details read on every refresh (added later — running this whole file again just adds what's missing).
alter table public.course_fees add column if not exists title        text;        -- course name as shown on the page
alter table public.course_fees add column if not exists intakes      text[];      -- start months found on the page, e.g. {Sept,Jan}
alter table public.course_fees add column if not exists course_status text;       -- open | closed (not recruiting) | gone (page removed) | check (a deadline has closed)
alter table public.course_fees add column if not exists status_note  text;        -- the sentence that triggered closed/check
alter table public.course_fees add column if not exists entry        text;        -- entry requirement sentence from the page
alter table public.course_fees add column if not exists info_at      timestamptz; -- when these details were last read

-- Courses found by the weekly discovery scan at universities that aren't on the map yet. Review them here:
-- set status to 'added' once added to the map (scripts/masters_rows.json), or 'rejected' to stop seeing them.
create table if not exists public.course_candidates (
  url         text primary key,
  uni         text not null,
  subject     text,                      -- best-guess subject group: CS, AI, HCI, HM, NUR, DEV, SF, DM
  title       text,
  fee         integer,                   -- international fee per year if the page showed one
  intakes     text[],
  entry       text,
  status      text not null default 'new',   -- new | added | rejected
  found_at    timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
alter table public.course_candidates enable row level security;

-- ---------------------------------------------------------------------------------------------------------------
-- User accounts (username + password, no email). Only the server touches these tables, through /api/account.

-- One row per account. The password is stored only as a scrypt hash with a random salt.
create table if not exists public.app_accounts (
  id               uuid primary key default gen_random_uuid(),
  username         text not null check (username ~ '^[a-z][a-z0-9_.]{2,19}$'),
  name             text not null check (char_length(name) between 1 and 60),
  pass_hash        text not null,
  avatar_url       text,
  data             jsonb not null default '{}'::jsonb,   -- saved inputs: { map: {...}, plan: {...} }
  data_updated_at  timestamptz,
  created_at       timestamptz not null default now(),
  last_login_at    timestamptz
);
create unique index if not exists app_accounts_username_key on public.app_accounts (lower(username));

-- Earlier versions: an ID-based app_users table (and its app_sessions pointing at it). Move any accounts there to
-- app_accounts (same password hash format, so passwords keep working; the username comes from the name), then remove
-- the old tables. Does nothing once they're gone.
do $$
begin
  if to_regclass('public.app_users') is not null then
    insert into public.app_accounts (username, name, pass_hash, data, data_updated_at, created_at, last_login_at)
    select case when lower(regexp_replace(name, '[^A-Za-z0-9_.]', '', 'g')) ~ '^[a-z][a-z0-9_.]{2,19}$'
                 and not exists (select 1 from public.app_accounts a where lower(a.username) = lower(regexp_replace(u.name, '[^A-Za-z0-9_.]', '', 'g')))
                then lower(regexp_replace(name, '[^A-Za-z0-9_.]', '', 'g'))
                else 'user' || u.id end,
           u.name, u.pass_hash, u.data, u.data_updated_at, u.created_at, u.last_login_at
    from public.app_users u;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_sessions'
             and column_name = 'user_id' and data_type = 'text') then
    drop table public.app_sessions;
  end if;
  drop table if exists public.app_users;
end $$;

-- Signed-in browsers. Only a SHA-256 fingerprint of each session token is stored, so a leaked table can't be used to sign in.
create table if not exists public.app_sessions (
  token_hash  text primary key,
  user_id     uuid not null references public.app_accounts (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists app_sessions_user_idx on public.app_sessions (user_id);

-- Sign-in and sign-up attempts, for lockouts and rate limits. Network addresses are stored only as keyed fingerprints.
create table if not exists public.auth_attempts (
  id    bigint generated always as identity primary key,
  kind  text not null,            -- login | signup
  key   text not null,            -- "user:<username>" or "ip:<fingerprint>"
  ok    boolean not null default false,
  at    timestamptz not null default now()
);
create index if not exists auth_attempts_lookup_idx on public.auth_attempts (kind, key, at desc);

alter table public.app_accounts enable row level security;
alter table public.app_sessions enable row level security;
alter table public.auth_attempts enable row level security;

-- Profile photos: a public bucket (photos are shown on the page), max 200 KB, images only. Uploads go through the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 204800, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 204800, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- "Report wrong info" from course cards, for you to review (Table editor → course_reports). Written only by /api/report.
create table if not exists public.course_reports (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  co          text not null,                 -- uk | de
  uni         text not null,
  course      text not null,
  field       text not null,                 -- fee | dates | entry | closed | scholarship | other
  details     text not null,
  link        text,
  user_id     uuid references public.app_accounts (id) on delete set null,
  status      text not null default 'new'    -- set to 'done' once you've checked it
);
create index if not exists course_reports_new_idx on public.course_reports (status, created_at desc);
alter table public.course_reports enable row level security;

-- Make the API see the new tables straight away.
notify pgrst, 'reload schema';
