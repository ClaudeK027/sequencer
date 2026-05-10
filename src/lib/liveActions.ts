import { supabase } from './supabase';
import type {
  LiveEventRow,
  LiveEventType,
  LiveMode,
  LiveSessionRow,
  SequenceSnapshot,
} from './database.types';
import { computeElapsedMs, walkSteps, totalDurationMs } from './liveTime';
import { computeReport } from './liveReport';

/* ----------------------------------------------------------------
   Création d'une session live
   ---------------------------------------------------------------- */
export async function createLiveSession(args: {
  title: string;
  snapshot: SequenceSnapshot;
  sequenceId?: string | null;
  isPublic?: boolean;
  mode?: LiveMode;
}): Promise<string> {
  const { data, error } = await supabase
    .from('live_sessions')
    .insert({
      title: args.title,
      sequence_snapshot: args.snapshot,
      sequence_id: args.sequenceId ?? null,
      is_public: args.isPublic ?? true,
      status: 'pending',
      effective_start_at: null,
      elapsed_at_pause_ms: null,
      host_id: null,
      org_id: null,
      ended_at: null,
      mode: args.mode ?? 'auto',
      current_step_index: 0,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/* ----------------------------------------------------------------
   Helper : log d'un événement (INSERT, pas de race possible)
   ---------------------------------------------------------------- */
async function logEvent(
  sessionId: string,
  type: LiveEventType,
  stepIndex: number,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .from('live_events')
    .insert({ session_id: sessionId, event_type: type, step_index: stepIndex, metadata });
  if (error) console.error('logEvent failed', { type, error });
  // On ne throw pas : un event manqué n'est pas fatal pour l'utilisateur
}

/** Index de l'étape courante :
 *  - mode auto    : dérivé du temps écoulé
 *  - mode control : explicite, lu depuis la colonne current_step_index */
function currentStepIndex(session: LiveSessionRow): number {
  if (session.mode === 'control') {
    return Math.max(
      0,
      Math.min(session.sequence_snapshot.steps.length - 1, session.current_step_index)
    );
  }
  const elapsed = computeElapsedMs(session);
  const { currentIndex } = walkSteps(session.sequence_snapshot.steps, elapsed);
  return currentIndex;
}

/* ----------------------------------------------------------------
   Actions de contrôle
   ---------------------------------------------------------------- */

export async function playLive(session: LiveSessionRow): Promise<void> {
  if (session.status === 'finished') return;

  let effectiveStart: Date;
  let eventType: LiveEventType;
  if (session.status === 'paused' && session.elapsed_at_pause_ms != null) {
    effectiveStart = new Date(Date.now() - session.elapsed_at_pause_ms);
    eventType = 'resumed';
  } else {
    effectiveStart = new Date();
    eventType = 'session_started';
  }

  const { error } = await supabase
    .from('live_sessions')
    .update({
      status: 'running',
      effective_start_at: effectiveStart.toISOString(),
      elapsed_at_pause_ms: null,
    })
    .eq('id', session.id);
  if (error) throw error;

  await logEvent(session.id, eventType, currentStepIndex(session), {
    elapsed_ms_at_event: session.elapsed_at_pause_ms ?? 0,
  });
}

export async function pauseLive(session: LiveSessionRow): Promise<void> {
  if (session.status !== 'running') return;
  const elapsed = computeElapsedMs(session);
  const stepIdx = currentStepIndex(session);

  const { error } = await supabase
    .from('live_sessions')
    .update({
      status: 'paused',
      elapsed_at_pause_ms: elapsed,
      effective_start_at: null,
    })
    .eq('id', session.id);
  if (error) throw error;

  await logEvent(session.id, 'paused', stepIdx, { elapsed_ms_at_event: elapsed });
}

export async function togglePlayPause(session: LiveSessionRow): Promise<void> {
  if (session.status === 'running') return pauseLive(session);
  return playLive(session);
}

export async function nextStepLive(session: LiveSessionRow): Promise<void> {
  const steps = session.sequence_snapshot.steps;
  if (steps.length === 0) return;

  if (session.mode === 'control') {
    const fromIdx = currentStepIndex(session);
    const toIdx = fromIdx + 1;
    if (toIdx >= steps.length) {
      // Dernière étape : "next" termine la session
      await endLive(session.id, 'auto');
      return;
    }
    await advanceControlStep(session, fromIdx, toIdx, 'next');
    return;
  }

  // Mode auto : comportement existant
  const fromIdx = currentStepIndex(session);
  const toIdx = fromIdx + 1;

  if (toIdx >= steps.length) {
    await endLive(session.id, 'auto');
    return;
  }
  const targetElapsedMs = steps.slice(0, toIdx).reduce((s, x) => s + x.duration, 0) * 1000;
  await jumpToElapsed(session, targetElapsedMs, fromIdx, toIdx, 'next');
}

export async function prevStepLive(session: LiveSessionRow): Promise<void> {
  const steps = session.sequence_snapshot.steps;
  if (steps.length === 0) return;

  if (session.mode === 'control') {
    const fromIdx = currentStepIndex(session);
    const elapsedInStepMs = computeElapsedMs(session);
    // Si on est >3s dans l'étape courante, on la redémarre. Sinon on recule d'une étape.
    const toIdx = elapsedInStepMs > 3000 ? fromIdx : Math.max(0, fromIdx - 1);
    await advanceControlStep(session, fromIdx, toIdx, 'prev');
    return;
  }

  // Mode auto : comportement existant
  const view = walkSteps(steps, computeElapsedMs(session));
  const fromIdx = view.currentIndex;
  const toIdx = view.elapsedInStepMs > 3000 ? fromIdx : Math.max(0, fromIdx - 1);
  const targetElapsedMs = steps.slice(0, toIdx).reduce((s, x) => s + x.duration, 0) * 1000;
  await jumpToElapsed(session, targetElapsedMs, fromIdx, toIdx, 'prev');
}

/**
 * Mode contrôle : transition explicite vers une autre étape.
 * Reset effective_start_at = now (le timer de l'étape redémarre à 0)
 * et current_step_index = toIdx. Pas d'arithmétique sur l'elapsed total.
 */
async function advanceControlStep(
  session: LiveSessionRow,
  fromIdx: number,
  toIdx: number,
  reason: 'next' | 'prev' | 'jump'
): Promise<void> {
  const updates: Record<string, unknown> = {
    current_step_index: toIdx,
  };
  if (session.status === 'running') {
    updates.effective_start_at = new Date().toISOString();
    updates.elapsed_at_pause_ms = null;
  } else if (session.status === 'paused') {
    updates.effective_start_at = null;
    updates.elapsed_at_pause_ms = 0;
  } else {
    // pending : on reste pending, on déplace juste l'index
    updates.effective_start_at = null;
    updates.elapsed_at_pause_ms = null;
  }

  const { error } = await supabase
    .from('live_sessions')
    .update(updates)
    .eq('id', session.id);
  if (error) throw error;

  await logEvent(session.id, 'skipped', toIdx, {
    from_index: fromIdx,
    to_index: toIdx,
    target_elapsed_ms: 0, // en mode contrôle, on reset l'elapsed du step
    reason,
  });
}

export async function resetLive(session: LiveSessionRow): Promise<void> {
  const stepIdx = currentStepIndex(session);
  const { error } = await supabase
    .from('live_sessions')
    .update({
      status: 'pending',
      effective_start_at: null,
      elapsed_at_pause_ms: null,
      current_step_index: 0,
    })
    .eq('id', session.id);
  if (error) throw error;
  await logEvent(session.id, 'reset', stepIdx);
}

/**
 * Supprime définitivement une session live (et ses events via ON DELETE CASCADE
 * de la FK sur live_events). Utilisé pour purger un rapport.
 */
export async function deleteLiveSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('live_sessions')
    .delete()
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * Clôture la session. Si appelée alors qu'elle est encore active :
 *  1. UPDATE status='finished' + ended_at
 *  2. Log l'event session_ended
 *  3. Fetch tous les events (incluant celui qu'on vient de poser)
 *  4. Calcule le rapport et l'enregistre dans live_sessions.report
 */
export async function endLive(
  sessionId: string,
  reason: 'manual' | 'auto' = 'manual'
): Promise<void> {
  // 1. Récupérer la session pour connaître le step courant
  const { data: sess, error: e1 } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('id', sessionId)
    .single();
  if (e1) throw e1;
  if (!sess) return;
  const session = sess as LiveSessionRow;
  if (session.status === 'finished') {
    // Déjà fini : on s'assure juste que le rapport est calculé
    if (!session.report) await regenerateReport(sessionId);
    return;
  }

  const stepIdx = currentStepIndex(session);
  const endIso = new Date().toISOString();

  // 2. Marquer fini avec UPDATE conditionnel : si plusieurs clients essaient
  //    simultanément (auto-end côté A et clic manuel côté B), un seul réussit.
  const { data: updated, error: e2 } = await supabase
    .from('live_sessions')
    .update({ status: 'finished', ended_at: endIso })
    .eq('id', sessionId)
    .is('ended_at', null)
    .select('id');
  if (e2) throw e2;
  const wonTheRace = (updated?.length ?? 0) > 0;

  // 3. Logger session_ended UNIQUEMENT si on a vraiment fait la transition
  //    (sinon on pollue le journal avec des events fantômes)
  if (wonTheRace) {
    await logEvent(sessionId, 'session_ended', stepIdx, { reason });
  }

  // 4. Calculer + persister le rapport (idempotent — safe à appeler plusieurs fois)
  await regenerateReport(sessionId);
}

/**
 * Recalcule le rapport à partir des events de la session et le sauvegarde.
 * Utile :
 *  - automatiquement à la clôture
 *  - manuellement si le rapport est manquant ou pour rafraîchir
 */
export async function regenerateReport(sessionId: string): Promise<void> {
  // Petit délai pour laisser l'event session_ended se propager (Supabase
  // est en train de le commit)
  await new Promise((r) => setTimeout(r, 200));

  const [{ data: sess, error: eS }, { data: evts, error: eE }] = await Promise.all([
    supabase.from('live_sessions').select('*').eq('id', sessionId).single(),
    supabase
      .from('live_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('occurred_at', { ascending: true }),
  ]);
  if (eS) throw eS;
  if (eE) throw eE;
  if (!sess) return;

  const sessRow = sess as LiveSessionRow;
  const report = computeReport(
    sessRow.sequence_snapshot,
    (evts ?? []) as LiveEventRow[],
    sessRow.mode
  );
  if (!report) return;

  const { error: eU } = await supabase
    .from('live_sessions')
    .update({ report })
    .eq('id', sessionId);
  if (eU) throw eU;
}

/* ----------------------------------------------------------------
   Helper interne : skip vers une étape cible
   ---------------------------------------------------------------- */
async function jumpToElapsed(
  session: LiveSessionRow,
  targetElapsedMs: number,
  fromIdx: number,
  toIdx: number,
  reason: 'next' | 'prev' | 'jump'
): Promise<void> {
  const steps = session.sequence_snapshot.steps;
  if (targetElapsedMs >= totalDurationMs(steps)) {
    await endLive(session.id, 'auto');
    return;
  }

  if (session.status === 'running') {
    const newStart = new Date(Date.now() - targetElapsedMs);
    const { error } = await supabase
      .from('live_sessions')
      .update({
        effective_start_at: newStart.toISOString(),
        elapsed_at_pause_ms: null,
      })
      .eq('id', session.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('live_sessions')
      .update({
        status: 'paused',
        elapsed_at_pause_ms: targetElapsedMs,
        effective_start_at: null,
      })
      .eq('id', session.id);
    if (error) throw error;
  }

  await logEvent(session.id, 'skipped', toIdx, {
    from_index: fromIdx,
    to_index: toIdx,
    target_elapsed_ms: targetElapsedMs,
    reason,
  });
}
