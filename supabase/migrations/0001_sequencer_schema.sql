-- ============================================================
-- SEQUENCER SCHEMA
-- Outil de minuteur séquentiel avec live multi-appareils
-- Tout est isolé dans le schéma `sequencer` pour ne pas polluer `public`.
-- ============================================================
-- À exécuter dans le SQL Editor de Supabase. Idempotent.
--
-- ⚠️  ÉTAPE OBLIGATOIRE après exécution :
--    Settings → API → "Exposed schemas" → ajouter `sequencer`
--    (sans ça, PostgREST ne verra pas les tables depuis le client JS)


-- ============================================================
-- 0. EXTENSIONS & SCHEMA
-- ============================================================
create extension if not exists "pgcrypto";  -- pour gen_random_uuid()

create schema if not exists sequencer;

comment on schema sequencer is 'Tables et types de l''outil Sequence Timer';


-- ============================================================
-- 1. TYPES
-- ============================================================
do $$ begin
  create type sequencer.live_status as enum ('pending', 'running', 'paused', 'finished');
exception when duplicate_object then null; end $$;


-- ============================================================
-- 2. TABLES
-- ============================================================

-- Sequences : templates de séquences (équivalent du localStorage actuel)
create table if not exists sequencer.sequences (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  steps       jsonb       not null default '[]'::jsonb,
  -- Format de chaque étape : { "name": text, "duration": int (en secondes) }

  owner_id    uuid        references auth.users(id) on delete set null,
  org_id      uuid,       -- FK à votre table `organizations` à ajouter quand elle existe

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint sequences_steps_is_array check (jsonb_typeof(steps) = 'array')
);

comment on table  sequencer.sequences         is 'Templates de séquences sauvegardées';
comment on column sequencer.sequences.steps   is 'Tableau JSON [{name, duration (sec)}]';
comment on column sequencer.sequences.org_id  is 'Référence vers organizations (FK à ajouter ultérieurement)';

-- Live sessions : minuteurs en cours d'exécution, synchronisés entre appareils
create table if not exists sequencer.live_sessions (
  id                    uuid                   primary key default gen_random_uuid(),

  -- Source (snapshot reste autoritaire si la séquence d'origine est modifiée)
  sequence_id           uuid                   references sequencer.sequences(id) on delete set null,
  sequence_snapshot     jsonb                  not null,
  -- Format snapshot : { "name": text, "steps": [{name, duration (sec)}] }

  title                 text                   not null,

  -- Machine à états
  status                sequencer.live_status  not null default 'pending',

  -- Suivi du temps (synchronisé via Realtime)
  effective_start_at    timestamptz,           -- non-null quand status='running' :
                                               --   ms_écoulées = now() - effective_start_at
  elapsed_at_pause_ms   bigint,                -- non-null quand status='paused' :
                                               --   ms écoulées figées au moment de la pause

  -- Métadonnées
  host_id               uuid                   references auth.users(id) on delete set null,
  org_id                uuid,                  -- FK organizations (à ajouter)

  -- Visibilité dans la liste publique des lives
  is_public             boolean                not null default true,

  -- Cycle de vie
  created_at            timestamptz            not null default now(),
  updated_at            timestamptz            not null default now(),
  ended_at              timestamptz,           -- non-null = clôturée explicitement

  -- Concurrence optimiste
  version               int                    not null default 0,

  constraint live_snapshot_has_steps check (
    jsonb_typeof(sequence_snapshot -> 'steps') = 'array'
  )
);

comment on table  sequencer.live_sessions                       is 'Minuteurs en direct, synchronisés temps réel entre appareils';
comment on column sequencer.live_sessions.sequence_snapshot     is 'Copie figée de la séquence au moment du Go Live';
comment on column sequencer.live_sessions.effective_start_at    is 'status=running : moment de référence pour calcul ms_écoulées';
comment on column sequencer.live_sessions.elapsed_at_pause_ms   is 'status=paused : ms écoulées figées';
comment on column sequencer.live_sessions.version               is 'Incrémenté à chaque update (cache busting client)';


-- ============================================================
-- 3. INDEXES
-- ============================================================

create index if not exists idx_sequences_owner    on sequencer.sequences (owner_id);
create index if not exists idx_sequences_org      on sequencer.sequences (org_id);
create index if not exists idx_sequences_updated  on sequencer.sequences (updated_at desc);

-- Lives actifs (les plus consultés : la liste live)
create index if not exists idx_live_active        on sequencer.live_sessions (created_at desc) where ended_at is null;
create index if not exists idx_live_org_active    on sequencer.live_sessions (org_id, created_at desc) where ended_at is null;
create index if not exists idx_live_public_active on sequencer.live_sessions (created_at desc) where is_public = true and ended_at is null;


-- ============================================================
-- 4. TRIGGERS
-- ============================================================

-- Auto-update updated_at à chaque modification
create or replace function sequencer.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sequences_updated_at on sequencer.sequences;
create trigger trg_sequences_updated_at
  before update on sequencer.sequences
  for each row execute function sequencer.tg_set_updated_at();

drop trigger if exists trg_live_sessions_updated_at on sequencer.live_sessions;
create trigger trg_live_sessions_updated_at
  before update on sequencer.live_sessions
  for each row execute function sequencer.tg_set_updated_at();

-- Auto-increment version sur live_sessions à chaque update
create or replace function sequencer.tg_increment_version()
returns trigger language plpgsql as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_live_sessions_version on sequencer.live_sessions;
create trigger trg_live_sessions_version
  before update on sequencer.live_sessions
  for each row execute function sequencer.tg_increment_version();


-- ============================================================
-- 5. PERMISSIONS — exposer le schéma à PostgREST + Realtime
-- ============================================================
-- Sans ces grants, le client JS Supabase ne pourra pas accéder aux tables
-- même avec les bonnes RLS policies.

-- Accès au schéma lui-même
grant usage on schema sequencer to anon, authenticated, service_role;

-- Accès aux tables existantes
grant all on all tables    in schema sequencer to anon, authenticated, service_role;
grant all on all sequences in schema sequencer to anon, authenticated, service_role;
grant all on all functions in schema sequencer to anon, authenticated, service_role;

-- Accès aux futures tables/fonctions créées dans ce schéma
alter default privileges in schema sequencer grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema sequencer grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema sequencer grant all on functions to anon, authenticated, service_role;


-- ============================================================
-- 6. REALTIME
-- ============================================================
-- Active la diffusion temps réel uniquement sur live_sessions
-- (pas besoin pour sequences : pas de collaboration temps réel)

do $$ begin
  -- Ajout idempotent : on ignore si la table est déjà dans la publication
  alter publication supabase_realtime add table sequencer.live_sessions;
exception when duplicate_object then null; end $$;


-- ============================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================
alter table sequencer.sequences      enable row level security;
alter table sequencer.live_sessions  enable row level security;

-- ------------------------------------------------------------
-- POLICIES v1 — OUVERTES (pas d'auth requise)
-- À utiliser pendant le développement initial ou pour usage
-- single-tenant en intranet/réseau de confiance.
-- ------------------------------------------------------------

drop policy if exists "v1_sequences_all" on sequencer.sequences;
create policy "v1_sequences_all"
  on sequencer.sequences
  for all
  using (true)
  with check (true);

drop policy if exists "v1_live_all" on sequencer.live_sessions;
create policy "v1_live_all"
  on sequencer.live_sessions
  for all
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- POLICIES v2 — AVEC AUTH + ORG (à activer plus tard)
-- Suppose une table public.org_members (user_id, org_id, role)
-- Pour migrer : DROP les policies v1, puis exécuter le bloc ci-dessous.
-- ------------------------------------------------------------
/*
-- Sequences : lecture par membres de l'org, écriture par owner ou admin/editor
drop policy if exists "v2_sequences_select" on sequencer.sequences;
create policy "v2_sequences_select"
  on sequencer.sequences for select
  using (
    org_id is null
    or owner_id = auth.uid()
    or org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

drop policy if exists "v2_sequences_insert" on sequencer.sequences;
create policy "v2_sequences_insert"
  on sequencer.sequences for insert
  with check (
    auth.uid() is not null
    and (owner_id is null or owner_id = auth.uid())
  );

drop policy if exists "v2_sequences_update" on sequencer.sequences;
create policy "v2_sequences_update"
  on sequencer.sequences for update
  using (
    owner_id = auth.uid()
    or org_id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

drop policy if exists "v2_sequences_delete" on sequencer.sequences;
create policy "v2_sequences_delete"
  on sequencer.sequences for delete
  using (owner_id = auth.uid());

-- Live sessions : lecture publique pour les lives marqués public, contrôle par membres
drop policy if exists "v2_live_select" on sequencer.live_sessions;
create policy "v2_live_select"
  on sequencer.live_sessions for select
  using (
    is_public = true
    or host_id = auth.uid()
    or org_id in (select org_id from public.org_members where user_id = auth.uid())
  );

drop policy if exists "v2_live_insert" on sequencer.live_sessions;
create policy "v2_live_insert"
  on sequencer.live_sessions for insert
  with check (auth.uid() is not null);

drop policy if exists "v2_live_update" on sequencer.live_sessions;
create policy "v2_live_update"
  on sequencer.live_sessions for update
  using (
    host_id = auth.uid()
    or org_id in (
      select org_id from public.org_members
      where user_id = auth.uid() and role in ('admin', 'editor')
    )
  );

drop policy if exists "v2_live_delete" on sequencer.live_sessions;
create policy "v2_live_delete"
  on sequencer.live_sessions for delete
  using (host_id = auth.uid());
*/


-- ============================================================
-- 8. HELPER FUNCTIONS
-- ============================================================

-- Clôture les sessions abandonnées (>24h sans update et toujours pending/running)
-- À appeler manuellement ou via un cron Supabase (pg_cron)
create or replace function sequencer.cleanup_stale_live_sessions()
returns int language plpgsql security definer as $$
declare affected int;
begin
  update sequencer.live_sessions
  set ended_at = now(), status = 'finished'
  where ended_at is null
    and updated_at < now() - interval '24 hours'
    and status in ('pending', 'running', 'paused');

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function sequencer.cleanup_stale_live_sessions is
  'Clôture automatique des lives oubliés. À planifier via pg_cron si souhaité.';

-- Exemple de planification cron (à exécuter une fois si pg_cron activé) :
-- select cron.schedule('cleanup-stale-lives', '0 * * * *', 'select sequencer.cleanup_stale_live_sessions()');


-- ============================================================
-- 9. SEED (optionnel) — exemple de séquence pour tester
-- ============================================================
-- insert into sequencer.sequences (name, steps) values (
--   'Culte type',
--   '[
--     {"name": "Préculte",       "duration": 600},
--     {"name": "Louange",        "duration": 1200},
--     {"name": "Annonces",       "duration": 300},
--     {"name": "Témoignages",    "duration": 600},
--     {"name": "Prédication",    "duration": 2700},
--     {"name": "Offrande",       "duration": 300},
--     {"name": "Bénédiction",    "duration": 180}
--   ]'::jsonb
-- );
