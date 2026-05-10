/**
 * Types correspondant au schéma `sequencer` dans Supabase.
 * Format aligné sur ce que `supabase gen types typescript --schema sequencer` produirait.
 * À régénérer un jour automatiquement.
 */

export type LiveStatus = 'pending' | 'running' | 'paused' | 'finished';
export type LiveMode = 'auto' | 'control';

export type LiveEventType =
  | 'session_started'
  | 'paused'
  | 'resumed'
  | 'skipped'
  | 'reset'
  | 'session_ended';

export interface LiveEventRow {
  id: string;
  session_id: string;
  event_type: LiveEventType;
  occurred_at: string;
  step_index: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

/* ----------------- Rapport (stocké dans live_sessions.report) ---------------- */

export interface StepReport {
  index: number;
  name: string;
  plannedDurationMs: number;

  actualStartAt: string | null;       // null si étape jamais atteinte
  actualEndAt: string | null;         // null si live arrêté pendant cette étape
  actualDurationMs: number;           // wall-clock = end - start (incluant pauses)
  pauseDurationMs: number;            // somme des pauses pendant cette étape
  effectiveDurationMs: number;        // actualDuration - pauseDuration
  varianceMs: number;                 // wall-clock - planned (incluant pauses)
  variancePercent: number;            // (variance / planned) * 100, 0 si planned=0
  /** Dépassement net : temps EFFECTIF passé au-delà de la durée prévue.
   *  Toujours >= 0. Métrique principale du mode contrôle. */
  overtimeMs: number;
  pauseCount: number;

  reached: boolean;                   // l'étape a été atteinte au moins une fois
  completed: boolean;                 // s'est terminée naturellement (passage à la suivante)
  skipped: boolean;                   // sautée par next/prev sans temps significatif
}

export interface SessionReport {
  // Niveau séquence (wall-clock)
  startedAt: string;                  // ISO, premier session_started après reset éventuel
  endedAt: string;                    // ISO, session_ended
  realDurationMs: number;             // endedAt - startedAt (wall-clock)

  // Niveau séquence (chronomètre interne)
  effectiveDurationMs: number;        // somme des périodes running uniquement
  totalPauseDurationMs: number;       // somme des périodes paused
  pauseCount: number;
  skipForwardCount: number;
  skipBackCount: number;
  resetCount: number;

  // Comparaison prévu / réel
  plannedDurationMs: number;
  varianceMs: number;                 // realDuration - planned (wall-clock)
  variancePercent: number;

  // Dépassement net (somme des overtime par étape) — utile en mode contrôle
  totalOvertimeMs: number;
  overtimeStepCount: number;

  // Détail par étape
  steps: StepReport[];

  // Méta
  mode: LiveMode;
  computedAt: string;
  computedBy: 'client' | 'server';
  schemaVersion: 2;
}

export interface SequenceStep {
  name: string;
  duration: number; // en secondes
}

export interface SequenceSnapshot {
  name: string;
  steps: SequenceStep[];
}

export interface SequenceRow {
  id: string;
  name: string;
  steps: SequenceStep[];
  owner_id: string | null;
  org_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LiveSessionRow {
  id: string;
  sequence_id: string | null;
  sequence_snapshot: SequenceSnapshot;
  title: string;
  status: LiveStatus;
  /**
   * Sémantique de `effective_start_at` et `elapsed_at_pause_ms` selon le mode :
   *  - mode 'auto'    → réfèrent au DÉBUT DE LA SÉQUENCE (elapsed total)
   *  - mode 'control' → réfèrent au DÉBUT DE L'ÉTAPE COURANTE (elapsed dans l'étape)
   * Le calcul `now - effective_start_at` ou `elapsed_at_pause_ms` reste identique,
   * seul le point de référence change selon le mode.
   */
  effective_start_at: string | null;
  elapsed_at_pause_ms: number | null;
  host_id: string | null;
  org_id: string | null;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  version: number;
  report: SessionReport | null;
  mode: LiveMode;
  current_step_index: number;
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  sequencer: {
    Tables: {
      sequences: {
        Row: SequenceRow;
        Insert: {
          id?: string;
          name: string;
          steps?: SequenceStep[];
          owner_id?: string | null;
          org_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          steps?: SequenceStep[];
          owner_id?: string | null;
          org_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      live_sessions: {
        Row: LiveSessionRow;
        Insert: {
          id?: string;
          sequence_id?: string | null;
          sequence_snapshot: SequenceSnapshot;
          title: string;
          status?: LiveStatus;
          effective_start_at?: string | null;
          elapsed_at_pause_ms?: number | null;
          host_id?: string | null;
          org_id?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
          ended_at?: string | null;
          version?: number;
          mode?: LiveMode;
          current_step_index?: number;
        };
        Update: {
          id?: string;
          sequence_id?: string | null;
          sequence_snapshot?: SequenceSnapshot;
          title?: string;
          status?: LiveStatus;
          effective_start_at?: string | null;
          elapsed_at_pause_ms?: number | null;
          host_id?: string | null;
          org_id?: string | null;
          is_public?: boolean;
          created_at?: string;
          updated_at?: string;
          ended_at?: string | null;
          version?: number;
          mode?: LiveMode;
          current_step_index?: number;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      live_status: LiveStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
