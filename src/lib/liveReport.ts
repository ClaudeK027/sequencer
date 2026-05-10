import type {
  LiveEventRow,
  LiveMode,
  SequenceSnapshot,
  SessionReport,
  StepReport,
} from './database.types';

/**
 * Reconstruit un rapport complet à partir d'un journal d'événements + snapshot.
 *
 * Principe :
 *  - On parcourt les events dans l'ordre chronologique
 *  - On maintient un état (running ou paused, elapsed_total_ms, current_step_idx)
 *  - À chaque event, on met à jour les stats par étape :
 *      * running periods (auto only) → calcul de transitions naturelles
 *      * pauses → accumulées sur l'étape courante
 *      * skips → fin de l'étape source, début de l'étape cible
 *  - Si reset → on repart de zéro (les stats précédentes sont écrasées)
 *
 * En mode 'control', les transitions naturelles sont DÉSACTIVÉES : seuls les
 * events `skipped` provoquent une transition d'étape. Permet de gérer
 * proprement l'overtime (l'utilisateur reste sur une étape au-delà du prévu).
 *
 * Robuste face à : pauses multiples, skips chaînés, reset en cours, fin
 * prématurée, étape jamais atteinte, overtime en mode contrôle.
 */
export function computeReport(
  snapshot: SequenceSnapshot,
  events: LiveEventRow[],
  mode: LiveMode = 'auto'
): SessionReport | null {
  if (events.length === 0) return null;

  const steps = snapshot.steps;
  const stepDurMs = steps.map((s) => s.duration * 1000);
  const plannedDurationMs = stepDurMs.reduce((a, b) => a + b, 0);

  // État du parcours
  let stepResults: StepReport[] = makeBlankStepReports(steps);
  let currentIdx = 0;
  let running = false;
  let runStartedAt = 0;            // wall-clock ms où on a commencé/repris
  let elapsedTotalMs = 0;          // chronomètre interne (running uniquement)
  let pauseStartedAt: number | null = null;

  // Compteurs niveau session
  let totalPauseDurationMs = 0;
  let pauseCount = 0;
  let skipForwardCount = 0;
  let skipBackCount = 0;
  let resetCount = 0;

  let firstStartedAt: string | null = null;
  let endedAt: string | null = null;

  // Tri défensif (au cas où l'ordre arrive perturbé via Realtime)
  const sortedEvents = [...events].sort((a, b) =>
    a.occurred_at.localeCompare(b.occurred_at)
  );

  /** Avance la timeline : applique l'écoulé d'une période running jusqu'à `untilAt`,
   *  en détectant les transitions automatiques d'étapes (mode auto uniquement).
   *  En mode 'control', on met simplement à jour elapsedTotalMs sans walker
   *  les frontières (les transitions ne suivent pas le temps). */
  const advanceRunningUntil = (untilAt: number): void => {
    if (!running) return;
    const periodMs = Math.max(0, untilAt - runStartedAt);
    let elapsedAtMark = elapsedTotalMs + periodMs;

    if (mode === 'auto') {
      // Détection des transitions naturelles pendant la période
      while (currentIdx < steps.length - 1) {
        const boundary = sumUpTo(stepDurMs, currentIdx + 1);
        if (elapsedAtMark < boundary) break;

        const transitionWall = runStartedAt + (boundary - elapsedTotalMs);
        const transitionIso = new Date(transitionWall).toISOString();

        stepResults[currentIdx].actualEndAt = transitionIso;
        stepResults[currentIdx].completed = true;

        currentIdx++;
        stepResults[currentIdx].actualStartAt = transitionIso;
        stepResults[currentIdx].reached = true;

        elapsedTotalMs = boundary;
        runStartedAt = transitionWall;
      }

      // Si on a dépassé la dernière étape, on cape (auto mode)
      if (currentIdx >= steps.length - 1 && elapsedAtMark > plannedDurationMs) {
        elapsedAtMark = plannedDurationMs;
      }
    }
    // En mode contrôle : on laisse elapsedAtMark s'envoler — c'est normal,
    // ça représente du temps passé y compris en overtime.
    elapsedTotalMs = elapsedAtMark;
    runStartedAt = untilAt;
  };

  for (const e of sortedEvents) {
    const at = new Date(e.occurred_at).getTime();
    const atIso = e.occurred_at;

    switch (e.event_type) {
      case 'session_started': {
        // Premier démarrage (ou démarrage après reset)
        running = true;
        runStartedAt = at;
        elapsedTotalMs = 0;
        currentIdx = 0;
        if (firstStartedAt === null) firstStartedAt = atIso;
        // Si on n'a pas encore touché à l'étape 0, on initialise
        if (!stepResults[0].reached) {
          stepResults[0].actualStartAt = atIso;
          stepResults[0].reached = true;
        } else {
          // Cas redémarrage après reset : tout a été remis à zéro juste avant
          stepResults[0].actualStartAt = atIso;
          stepResults[0].reached = true;
        }
        break;
      }

      case 'paused': {
        advanceRunningUntil(at);
        running = false;
        pauseStartedAt = at;
        pauseCount++;
        break;
      }

      case 'resumed': {
        if (pauseStartedAt !== null) {
          const pauseDur = Math.max(0, at - pauseStartedAt);
          totalPauseDurationMs += pauseDur;
          stepResults[currentIdx].pauseDurationMs += pauseDur;
          stepResults[currentIdx].pauseCount++;
        }
        pauseStartedAt = null;
        running = true;
        runStartedAt = at;
        break;
      }

      case 'skipped': {
        // metadata: { from_index, to_index, target_elapsed_ms, reason: 'next'|'prev'|'jump' }
        const fromIdx = (e.metadata.from_index as number | undefined) ?? currentIdx;
        const toIdx = (e.metadata.to_index as number | undefined) ?? currentIdx;
        const targetElapsedMs = (e.metadata.target_elapsed_ms as number | undefined) ?? 0;

        if (running) {
          // Pas de transition naturelle : la skip impose la fin de l'étape source
          // (on ne fait pas advanceRunningUntil car on remplace explicitement)
        } else if (pauseStartedAt !== null) {
          // Skip pendant pause : la pause continue mais sur la nouvelle étape
          const pauseDur = Math.max(0, at - pauseStartedAt);
          stepResults[fromIdx].pauseDurationMs += pauseDur;
          totalPauseDurationMs += pauseDur;
          pauseStartedAt = at; // on redémarre la pause sur la nouvelle étape
        }

        // Fin de l'étape source à l'instant du skip
        stepResults[fromIdx].actualEndAt = atIso;
        const wallSpent =
          stepResults[fromIdx].actualStartAt
            ? at - new Date(stepResults[fromIdx].actualStartAt!).getTime()
            : 0;
        const effective = wallSpent - stepResults[fromIdx].pauseDurationMs;
        if (effective < 1000) {
          // <1s : l'utilisateur a sauté l'étape sans s'y attarder
          stepResults[fromIdx].skipped = true;
        } else {
          // L'utilisateur a passé du temps puis cliqué « suivant » : étape complétée.
          // C'est essentiel en mode contrôle où chaque transition est un clic explicite,
          // mais ça vaut aussi pour les skips manuels en mode auto.
          stepResults[fromIdx].completed = true;
        }

        // Étape cible
        if (toIdx >= 0 && toIdx < steps.length) {
          currentIdx = toIdx;
          stepResults[toIdx].reached = true;
          stepResults[toIdx].actualStartAt = atIso;
          stepResults[toIdx].actualEndAt = null;
          stepResults[toIdx].pauseDurationMs = 0;
          stepResults[toIdx].pauseCount = 0;
          stepResults[toIdx].skipped = false;
          stepResults[toIdx].completed = false;
        }

        elapsedTotalMs = targetElapsedMs;
        if (running) runStartedAt = at;

        if (toIdx > fromIdx) skipForwardCount++;
        else if (toIdx < fromIdx) skipBackCount++;
        break;
      }

      case 'reset': {
        // On efface tout l'historique de ce run et on redémarre à zéro
        resetCount++;
        stepResults = makeBlankStepReports(steps);
        currentIdx = 0;
        running = false;
        elapsedTotalMs = 0;
        pauseStartedAt = null;
        firstStartedAt = null;
        // pauseCount + totalPauseDurationMs ne sont PAS reset : on garde la trace
        // de toutes les actions au niveau session pour l'audit. Si tu préfères
        // ne compter que le dernier run, décommenter :
        // pauseCount = 0; totalPauseDurationMs = 0;
        break;
      }

      case 'session_ended': {
        // On fige tout
        if (running) {
          advanceRunningUntil(at);
        } else if (pauseStartedAt !== null) {
          const pauseDur = Math.max(0, at - pauseStartedAt);
          totalPauseDurationMs += pauseDur;
          stepResults[currentIdx].pauseDurationMs += pauseDur;
          pauseStartedAt = null;
        }
        // Étape courante : end = at (sauf si déjà terminée naturellement avant)
        if (stepResults[currentIdx].actualEndAt === null) {
          stepResults[currentIdx].actualEndAt = atIso;
        }

        // Logique « completed » sur la dernière étape :
        //   - mode auto    : completed si reason='auto' OU si elapsed atteint
        //                    la fin du planning (capping naturel)
        //   - mode control : completed UNIQUEMENT si reason='auto', ce qui
        //                    signifie que l'utilisateur a cliqué « next » sur
        //                    la dernière étape. Une fin manuelle (bouton End)
        //                    laisse l'étape « interrompue ».
        const reason = (e.metadata.reason as string | undefined) ?? 'manual';
        const isLastStep = currentIdx === steps.length - 1;
        if (isLastStep) {
          if (mode === 'control') {
            if (reason === 'auto') stepResults[currentIdx].completed = true;
          } else {
            const reachedEnd = elapsedTotalMs >= plannedDurationMs;
            if (reason === 'auto' || reachedEnd) {
              stepResults[currentIdx].completed = true;
            }
          }
        }

        endedAt = atIso;
        running = false;
        break;
      }
    }
  }

  // Si pas de session_ended explicite, on prend le dernier event comme fin
  if (!endedAt) {
    endedAt = sortedEvents[sortedEvents.length - 1].occurred_at;
  }
  if (!firstStartedAt) {
    // Session jamais démarrée : pas de rapport intéressant
    return null;
  }

  // Finalisation : calcul des durées dérivées par étape
  // ⚠️ Variance = wall-clock - prévu (incluant pauses).
  // ⚠️ Overtime = effective - prévu (capé à 0). C'est le vrai dépassement
  //    "actif" (sans compter les pauses).
  for (const sr of stepResults) {
    if (sr.actualStartAt && sr.actualEndAt) {
      sr.actualDurationMs = Math.max(
        0,
        new Date(sr.actualEndAt).getTime() - new Date(sr.actualStartAt).getTime()
      );
      sr.effectiveDurationMs = Math.max(0, sr.actualDurationMs - sr.pauseDurationMs);
      sr.varianceMs = sr.actualDurationMs - sr.plannedDurationMs;
      sr.variancePercent =
        sr.plannedDurationMs > 0 ? (sr.varianceMs / sr.plannedDurationMs) * 100 : 0;
      sr.overtimeMs = Math.max(0, sr.effectiveDurationMs - sr.plannedDurationMs);
    } else {
      sr.overtimeMs = 0;
    }
  }

  const realDurationMs = Math.max(
    0,
    new Date(endedAt).getTime() - new Date(firstStartedAt).getTime()
  );
  const effectiveDurationMs = Math.max(0, realDurationMs - totalPauseDurationMs);
  const varianceMs = realDurationMs - plannedDurationMs;
  const totalOvertimeMs = stepResults.reduce((s, sr) => s + sr.overtimeMs, 0);
  // On compte les étapes "significativement" en overtime (>1s pour ignorer le bruit)
  const overtimeStepCount = stepResults.filter((sr) => sr.overtimeMs > 1000).length;

  return {
    startedAt: firstStartedAt,
    endedAt,
    realDurationMs,
    effectiveDurationMs,
    totalPauseDurationMs,
    pauseCount,
    skipForwardCount,
    skipBackCount,
    resetCount,
    plannedDurationMs,
    varianceMs,
    variancePercent: plannedDurationMs > 0 ? (varianceMs / plannedDurationMs) * 100 : 0,
    totalOvertimeMs,
    overtimeStepCount,
    steps: stepResults,
    mode,
    computedAt: new Date().toISOString(),
    computedBy: 'client',
    schemaVersion: 2,
  };
}

/* ---------------------------- Helpers ---------------------------- */

function makeBlankStepReports(steps: SequenceSnapshot['steps']): StepReport[] {
  return steps.map((s, i) => ({
    index: i,
    name: s.name,
    plannedDurationMs: s.duration * 1000,
    actualStartAt: null,
    actualEndAt: null,
    actualDurationMs: 0,
    pauseDurationMs: 0,
    effectiveDurationMs: 0,
    varianceMs: 0,
    variancePercent: 0,
    overtimeMs: 0,
    pauseCount: 0,
    reached: false,
    completed: false,
    skipped: false,
  }));
}

function sumUpTo(arr: number[], n: number): number {
  let s = 0;
  for (let i = 0; i < n && i < arr.length; i++) s += arr[i];
  return s;
}

/* ---------------------------- Formatters ---------------------------- */

export function formatDurationVerbose(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export function formatVariance(ms: number): { text: string; sign: 'pos' | 'neg' | 'zero' } {
  const sign: 'pos' | 'neg' | 'zero' = ms > 500 ? 'pos' : ms < -500 ? 'neg' : 'zero';
  const abs = Math.abs(ms);
  const prefix = sign === 'pos' ? '+' : sign === 'neg' ? '−' : '±';
  return { text: `${prefix}${formatDurationVerbose(abs)}`, sign };
}

export function formatTimeOfDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
