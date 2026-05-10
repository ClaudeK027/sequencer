-- ============================================================
-- MIGRATION 0002 : Activer Realtime sur sequencer.sequences
-- ============================================================
-- Permet la synchronisation des séquences (ajout, édition, suppression)
-- entre tous les appareils connectés.
-- ============================================================

do $$ begin
  alter publication supabase_realtime add table sequencer.sequences;
exception when duplicate_object then null; end $$;
