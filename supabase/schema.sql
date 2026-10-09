-- Uni Map: live course fees.
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
