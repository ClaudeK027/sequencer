-- ============================================================
-- MIGRATION 0003 : Journal d'événements + rapport de session
-- ============================================================
-- Capture chaque action utilisateur (play/pause/skip/end…) dans une table
-- dédiée, et stocke le rapport calculé dans live_sessions.report.
-- ============================================================

-- 1. Table d'événements : un INSERT par action (concurrence sans race)
create table if not exists sequencer.live_events (
  id           uuid        primary key default gen_random_uuid(),
  session_id   uuid        not null references sequencer.live_sessions(id) on delete cascade,

  event_type   text        not null,
  occurred_at  timestamptz not null default now(),
  step_index   int         not null,        -- index de l'étape au moment de l'événement
  metadata     jsonb       not null default '{}'::jsonb,

  created_at   timestamptz not null default now(),

  constraint live_events_type_valid check (event_type in (
    'session_started',
    'paused',
    'resumed',
    'skipped',
    'reset',
    'session_ended'
  ))
);

comment on table  sequencer.live_events            is 'Journal d''événements de chaque session live (audit + base du rapport)';
comment on column sequencer.live_events.event_type is 'session_started | paused | resumed | skipped | reset | session_ended';
comment on column sequencer.live_events.step_index is 'Index de l''étape au moment de l''événement';
comment on column sequencer.live_events.metadata   is 'Détails additionnels (from_index, to_index, target_elapsed_ms, reason…)';

-- 2. Index pour la lecture chronologique (utilisée par computeReport)
create index if not exists idx_live_events_session_time
  on sequencer.live_events (session_id, occurred_at);

-- 3. Colonne report sur live_sessions
alter table sequencer.live_sessions
  add column if not exists report jsonb;

comment on column sequencer.live_sessions.report is
  'Rapport calculé à la clôture : durées réelles, pauses, variance par étape, etc. (null tant que live actif)';

-- 4. Permissions
grant all on table sequencer.live_events to anon, authenticated, service_role;

-- 5. RLS
alter table sequencer.live_events enable row level security;

drop policy if exists "v1_live_events_all" on sequencer.live_events;
create policy "v1_live_events_all"
  on sequencer.live_events for all
  using (true) with check (true);

-- 6. Petite vue pratique : nb d'events par session (pour debug)
create or replace view sequencer.session_event_counts as
  select session_id, count(*) as event_count, max(occurred_at) as last_event_at
  from sequencer.live_events
  group by session_id;

grant select on sequencer.session_event_counts to anon, authenticated, service_role;
