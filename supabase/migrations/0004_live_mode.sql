-- ============================================================
-- MIGRATION 0004 : Mode "control" pour les lives
-- ============================================================
-- Permet à l'utilisateur de choisir, à la création du live,
-- entre un pilotage par le timer (auto, comportement existant)
-- ou par lui-même (control, transitions manuelles uniquement).
-- ============================================================

-- 1. Nouveau type enum pour le mode
do $$ begin
  create type sequencer.live_mode as enum ('auto', 'control');
exception when duplicate_object then null; end $$;

-- 2. Colonnes ajoutées à live_sessions
alter table sequencer.live_sessions
  add column if not exists mode sequencer.live_mode not null default 'auto',
  add column if not exists current_step_index int not null default 0;

comment on column sequencer.live_sessions.mode is
  'auto = transitions automatiques (timer pilote). control = transitions manuelles (utilisateur pilote).';

comment on column sequencer.live_sessions.current_step_index is
  'Index de l''étape courante (0-based). En mode control : explicite, géré par les actions next/prev. En mode auto : informatif, dérivé du temps écoulé.';

-- 3. Index utile pour filtrer par mode dans la liste / historique (optionnel mais peu coûteux)
create index if not exists idx_live_sessions_mode on sequencer.live_sessions (mode);
