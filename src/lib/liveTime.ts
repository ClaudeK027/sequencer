import type { LiveSessionRow, SequenceStep } from './database.types';

export interface LiveComputed {
  /** Index de l'étape courante (0-based) */
  currentIndex: number;
  /** ms écoulées dans l'étape courante */
  elapsedInStepMs: number;
  /** ms restantes dans l'étape courante (0 quand on est en overtime) */
  remainingInStepMs: number;
  /** ms écoulées totales (estimation pour la barre globale en mode auto) */
  elapsedTotalMs: number;
  /** ms totales de la séquence */
  totalMs: number;
  /** True si on a dépassé la dernière étape (mode auto uniquement) */
  finished: boolean;
  /** True quand on est dans la zone "overtime" de l'étape courante (mode contrôle) */
  inOvertime: boolean;
  /** ms passées au-delà de la durée prévue de l'étape courante (>= 0) */
  overtimeMs: number;
}

/**
 * Calcule le temps écoulé total (en ms) à partir de l'état d'une session live.
 * - pending  → 0
 * - running  → now() - effective_start_at
 * - paused   → elapsed_at_pause_ms
 * - finished → 0 (la session est close, on n'affiche plus de temps)
 */
export function computeElapsedMs(session: LiveSessionRow, now: number = Date.now()): number {
  if (session.status === 'pending' || session.status === 'finished') return 0;
  if (session.status === 'paused') return session.elapsed_at_pause_ms ?? 0;
  // running
  if (!session.effective_start_at) return 0;
  return Math.max(0, now - new Date(session.effective_start_at).getTime());
}

/**
 * Parcourt les étapes pour trouver où on en est étant donné le temps écoulé total.
 */
export function walkSteps(steps: SequenceStep[], elapsedTotalMs: number): {
  currentIndex: number;
  elapsedInStepMs: number;
  finished: boolean;
} {
  if (steps.length === 0) {
    return { currentIndex: 0, elapsedInStepMs: 0, finished: false };
  }
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    const stepMs = steps[i].duration * 1000;
    if (elapsedTotalMs < acc + stepMs) {
      return {
        currentIndex: i,
        elapsedInStepMs: elapsedTotalMs - acc,
        finished: false,
      };
    }
    acc += stepMs;
  }
  // Au-delà de la dernière étape
  return {
    currentIndex: steps.length - 1,
    elapsedInStepMs: steps[steps.length - 1].duration * 1000,
    finished: true,
  };
}

export function totalDurationMs(steps: SequenceStep[]): number {
  return steps.reduce((sum, s) => sum + s.duration, 0) * 1000;
}

/**
 * Vue calculée prête à afficher.
 *
 * Sémantique selon le mode :
 *  - mode 'auto' : les colonnes effective_start_at / elapsed_at_pause_ms réfèrent
 *    au DÉBUT DE LA SÉQUENCE. On dérive currentIndex en parcourant les durées.
 *  - mode 'control' : elles réfèrent au DÉBUT DE L'ÉTAPE COURANTE. currentIndex
 *    est lu directement depuis session.current_step_index. Si elapsedInStep
 *    dépasse la durée prévue → overtime (compteur ascendant rouge).
 */
export function computeLiveView(session: LiveSessionRow, now: number = Date.now()): LiveComputed {
  const steps = session.sequence_snapshot.steps;
  const totalMs = totalDurationMs(steps);
  const elapsedRaw = computeElapsedMs(session, now);

  if (session.mode === 'control') {
    const currentIndex = Math.max(0, Math.min(steps.length - 1, session.current_step_index));
    const stepDurMs = (steps[currentIndex]?.duration ?? 0) * 1000;
    const elapsedInStepMs = elapsedRaw;
    const overtimeMs = Math.max(0, elapsedInStepMs - stepDurMs);
    const inOvertime = elapsedInStepMs > stepDurMs && stepDurMs > 0;
    // Approximation utile pour les stats globales : étapes complètement passées
    // + temps écoulé (cappé à la durée) dans l'étape en cours
    const passedMs = steps.slice(0, currentIndex).reduce((s, x) => s + x.duration * 1000, 0);
    const elapsedTotalMs = passedMs + Math.min(elapsedInStepMs, stepDurMs);

    return {
      currentIndex,
      elapsedInStepMs,
      remainingInStepMs: Math.max(0, stepDurMs - elapsedInStepMs),
      elapsedTotalMs,
      totalMs,
      finished: session.status === 'finished',
      inOvertime,
      overtimeMs,
    };
  }

  // Mode auto (comportement existant)
  const elapsedTotalMs = elapsedRaw;
  const { currentIndex, elapsedInStepMs, finished } = walkSteps(steps, elapsedTotalMs);
  const stepDurMs = (steps[currentIndex]?.duration ?? 0) * 1000;
  return {
    currentIndex,
    elapsedInStepMs,
    remainingInStepMs: Math.max(0, stepDurMs - elapsedInStepMs),
    elapsedTotalMs,
    totalMs,
    finished: finished || session.status === 'finished',
    inOvertime: false,
    overtimeMs: 0,
  };
}

export function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
