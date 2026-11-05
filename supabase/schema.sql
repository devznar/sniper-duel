-- =====================================================================
--  Sniper Duel - Supabase 설정 SQL
--  Supabase 대시보드 → SQL Editor → New query 에 전체를 붙여넣고 [Run]
--  (여러 번 실행해도 안전합니다)
-- =====================================================================

-- 1) 경기 점수 테이블
create table if not exists public.scores (
  id           bigint generated always as identity primary key,
  name         text        not null check (char_length(name) between 1 and 12),
  score        integer     not null check (score between 0 and 300000),
  hits         integer     not null default 0 check (hits between 0 and 1000),
  fired        integer     not null default 0 check (fired between 0 and 1000),
  heads        integer     not null default 0 check (heads between 0 and 1000),
  best_streak  integer     not null default 0 check (best_streak between 0 and 1000),
  mode         text        not null default '' check (char_length(mode) <= 20),
  duration     integer     not null default 180 check (duration in (60, 120, 180)),
  players      integer     not null default 1 check (players between 1 and 4),
  created_at   timestamptz not null default now()
);

create index if not exists scores_score_idx on public.scores (score desc);
create index if not exists scores_name_idx  on public.scores (name);

-- 2) 보안(RLS): 누구나 조회 + 점수 등록만 가능, 수정/삭제는 불가
alter table public.scores enable row level security;

drop policy if exists "scores readable by everyone" on public.scores;
create policy "scores readable by everyone"
  on public.scores for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can submit a score" on public.scores;
create policy "anyone can submit a score"
  on public.scores for insert
  to anon, authenticated
  with check (true);

grant select, insert on public.scores to anon, authenticated;

-- 3) 닉네임별 누적 순위 뷰 (조회 권한은 scores 의 RLS 를 그대로 따름)
create or replace view public.leaderboard_total
with (security_invoker = true) as
  select name,
         sum(score)::bigint as total,
         count(*)::int      as games,
         max(score)         as best,
         sum(hits)::int     as hits,
         sum(fired)::int    as fired
  from public.scores
  group by name;

grant select on public.leaderboard_total to anon, authenticated;

-- 참고: '열린 방 목록'은 Supabase Realtime(Presence)을 사용하므로 테이블이 필요 없습니다.
-- 기록 전체 삭제가 필요하면 (관리자만, SQL Editor 에서):  truncate table public.scores;
