import { useEffect, useRef, useState } from 'react';
import { useLiveSession } from '../hooks/useLiveSession';
import { Icon } from './Icon';
import { computeLiveView, formatMs } from '../lib/liveTime';
import {
  togglePlayPause,
  nextStepLive,
  prevStepLive,
  resetLive,
  endLive,
} from '../lib/liveActions';
import { useRoute } from '../hooks/useRoute';
import { useToast } from './Toast';
import { ReportView } from './ReportView';
import { ConfirmDialog } from './ConfirmDialog';
import { ProgressBar } from './ProgressBar';

interface Props {
  sessionId: string;
}

export function LiveSessionPage({ sessionId }: Props): JSX.Element {
  const { session, loading, error } = useLiveSession(sessionId);
  const { goBack } = useRoute();
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const autoEndTriggeredRef = useRef(false);

  // Tick local pour l'affichage uniquement (le state vient de Supabase)
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [session?.status]);

  // === Plein écran ===
  const toggleFullscreen = (): void => {
    setIsFullscreen((v) => !v);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Sync sur ESC navigateur
  useEffect(() => {
    const onFs = (): void => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // Class CSS au body
  useEffect(() => {
    document.body.classList.toggle('live-fullscreen', isFullscreen);
    return () => {
      document.body.classList.remove('live-fullscreen');
    };
  }, [isFullscreen]);

  // Sortie auto du plein écran quand la session passe en `finished` :
  // sans ça, le rapport s'afficherait en plein écran sans bouton de sortie évident.
  useEffect(() => {
    if (session?.status === 'finished' && isFullscreen) {
      setIsFullscreen(false);
      document.exitFullscreen?.().catch(() => {});
    }
  }, [session?.status, isFullscreen]);

  // Auto-hide des contrôles après 3s d'inactivité (uniquement en fullscreen)
  useEffect(() => {
    if (!isFullscreen) {
      setShowControls(true);
      return;
    }
    let timeout: number;
    const reveal = (): void => {
      setShowControls(true);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => setShowControls(false), 3000);
    };
    reveal();
    window.addEventListener('mousemove', reveal);
    window.addEventListener('keydown', reveal);
    window.addEventListener('touchstart', reveal);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('mousemove', reveal);
      window.removeEventListener('keydown', reveal);
      window.removeEventListener('touchstart', reveal);
    };
  }, [isFullscreen]);

  // Auto-clôture en mode AUTO uniquement : quand le timer arrive à zéro sur la
  // dernière étape, n'importe quel client connecté déclenche l'endLive (UPDATE
  // conditionnel côté serveur garantit qu'un seul client réussit).
  // En mode CONTROL : aucun auto-end. L'utilisateur clique « Étape suivante »
  // pour finir, sinon le timer continue à compter en overtime.
  useEffect(() => {
    if (!session || session.status !== 'running') return;
    if (session.mode === 'control') return;
    if (autoEndTriggeredRef.current) return;

    const view = computeLiveView(session, now);
    if (view.elapsedTotalMs >= view.totalMs && view.totalMs > 0) {
      autoEndTriggeredRef.current = true;
      endLive(session.id, 'auto').catch((e) => {
        autoEndTriggeredRef.current = false;
        console.error('Auto-end failed', e);
      });
    }
  }, [now, session]);

  // Reset le flag d'auto-end si la session change
  useEffect(() => {
    autoEndTriggeredRef.current = false;
  }, [session?.id, session?.status]);

  const copyUrl = async (): Promise<void> => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      toast.show('URL copiée');
    } catch {
      toast.show('Impossible de copier');
    }
  };

  const wrap = async (fn: () => Promise<void>): Promise<void> => {
    if (busy || !session) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast.show('Erreur : ' + (e as Error).message); }
    finally { setBusy(false); }
  };

  // Raccourcis clavier (espace, flèches, F)
  useEffect(() => {
    if (!session || session.status === 'finished') return;
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.matches('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); void wrap(() => togglePlayPause(session)); }
      else if (e.code === 'ArrowRight') void wrap(() => nextStepLive(session));
      else if (e.code === 'ArrowLeft') void wrap(() => prevStepLive(session));
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.status]);

  if (loading) {
    return (
      <div className="page-live-session">
        <div className="empty"><div className="empty-title">Chargement du live…</div></div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page-live-session">
        <div className="empty">
          <div className="empty-title">Erreur</div>
          <div className="empty-desc">{error}</div>
          <button className="btn" onClick={() => goBack('/live')}>Retour à la liste</button>
        </div>
      </div>
    );
  }
  if (!session) {
    return (
      <div className="page-live-session">
        <div className="empty">
          <div className="empty-title">Session introuvable</div>
          <div className="empty-desc">Cette session n'existe pas ou a été supprimée.</div>
          <button className="btn" onClick={() => goBack('/live')}>Retour à la liste</button>
        </div>
      </div>
    );
  }

  const view = computeLiveView(session, now);
  const currentStep = session.sequence_snapshot.steps[view.currentIndex];
  const stepDurMs = (currentStep?.duration ?? 0) * 1000;
  const ratio = currentStep
    ? view.remainingInStepMs / (currentStep.duration * 1000)
    : 1;
  const globalRatio = view.totalMs > 0 ? (view.elapsedTotalMs / view.totalMs) * 100 : 0;
  // Progression dans l'étape courante (mode contrôle : 0..100% jusqu'à overtime)
  const stepRatio = stepDurMs > 0
    ? Math.min(100, (view.elapsedInStepMs / stepDurMs) * 100)
    : 0;

  const isControl = session.mode === 'control';

  let timeClass = '';
  if (session.status === 'running') {
    if (view.inOvertime) timeClass = 'danger';
    else if (ratio < 0.15) timeClass = 'danger';
    else if (ratio < 0.4) timeClass = 'warning';
  }

  const isFinished = session.status === 'finished';
  const isRunning = session.status === 'running';
  const isPaused = session.status === 'paused';
  const isLastStep = view.currentIndex >= session.sequence_snapshot.steps.length - 1;

  // Si la session est finie → vue Rapport au lieu du minuteur
  if (isFinished) {
    return (
      <div className="page-live-session report-mode">
        <header className="live-page-header">
          <button className="btn ghost back-btn" onClick={() => goBack('/live')}>
            <Icon name="arrow-left" />
            <span className="back-label">Lives</span>
          </button>
          <div className="live-session-title">
            <span className="status-badge finished">Terminé</span>
            {session.title}
          </div>
          <button className="btn ghost" onClick={copyUrl} title="Copier l'URL du rapport">
            <Icon name="copy" />
          </button>
        </header>
        <div className="report-body">
          <ReportView session={session} />
        </div>
      </div>
    );
  }

  return (
    <div className="page-live-session">
      <header className="live-page-header">
        <button className="btn ghost back-btn" onClick={() => goBack('/live')}>
          <Icon name="arrow-left" />
          <span className="back-label">Lives</span>
        </button>
        <div className="live-session-title">
          <span className="live-dot pulsing" data-active={isRunning} />
          {session.title}
        </div>
        <button className="btn ghost" onClick={copyUrl} title="Copier l'URL du live">
          <Icon name="copy" />
        </button>
        <button
          className="btn ghost"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Quitter le plein écran (F ou Échap)' : 'Plein écran (F)'}
          aria-label="Plein écran"
        >
          <Icon name="maximize" />
        </button>
      </header>

      <div className="live-stage">
        <div className="step-label">
          <span>
            Étape {view.currentIndex + 1} / {session.sequence_snapshot.steps.length}
          </span>
          {isControl && <span className="state-chip mode-control">Mode contrôle</span>}
          {isPaused && <span className="state-chip paused">⏸ En pause</span>}
          {session.status === 'pending' && <span className="state-chip pending">Prêt à démarrer</span>}
          {view.inOvertime && (
            <span className="state-chip overtime">Dépassement</span>
          )}
        </div>
        <div className="step-name-big">{currentStep?.name ?? '—'}</div>

        {/* Affichage du timer : compte à rebours OU overtime ascendant */}
        {view.inOvertime ? (
          <div className="time-big overtime-state">
            +{formatMs(view.overtimeMs)}
          </div>
        ) : (
          <div className={`time-big ${timeClass} ${isPaused ? 'paused-state' : ''}`}>
            {formatMs(view.remainingInStepMs)}
          </div>
        )}

        {/* Sous le timer en mode contrôle : durée prévue de l'étape, mise en avant */}
        {isControl && (
          <div className="planned-context">
            <span className="planned-label">Prévu</span>
            <span className="planned-value">{formatMs(stepDurMs)}</span>
          </div>
        )}

        {/* Barre de progression : par étape en contrôle, globale en auto */}
        {isControl ? (
          <div className={`step-progress-track ${view.inOvertime ? 'overtime' : ''}`}>
            <div className="step-progress-fill" style={{ width: `${stepRatio}%` }} />
          </div>
        ) : (
          <ProgressBar steps={session.sequence_snapshot.steps} fillPercent={globalRatio} />
        )}
        <div className="global-info">
          <span>{formatMs(view.elapsedTotalMs)} écoulées</span>
          <span className="sep" />
          <span>{formatMs(view.totalMs - view.elapsedTotalMs)} restantes</span>
          <span className="sep" />
          <span>{formatMs(view.totalMs)} total</span>
        </div>
      </div>

      <div className={`live-controls ${isFullscreen && !showControls ? 'auto-hidden' : ''} ${isControl ? 'control-mode' : ''}`}>
          <button
            className="btn icon lg"
            onClick={() => wrap(() => prevStepLive(session))}
            disabled={busy}
            title="Précédent (←)"
            aria-label="Précédent"
          >
            <Icon name="skip-back" size={20} />
          </button>
          <button
            className="btn icon xl"
            onClick={() => wrap(() => togglePlayPause(session))}
            disabled={busy}
            title={isRunning ? 'Pause' : 'Lecture'}
            aria-label={isRunning ? 'Pause' : 'Lecture'}
          >
            <Icon name={isRunning ? 'pause' : 'play'} size={26} />
          </button>

          {/* En mode CONTROL, le bouton "Étape suivante" est mis en avant
              (libellé textuel + style primary) car c'est l'action centrale.
              En mode AUTO, on garde le petit bouton skip-forward classique. */}
          {isControl ? (
            <button
              className="btn primary next-step-btn"
              onClick={() => wrap(() => nextStepLive(session))}
              disabled={busy}
              title="Étape suivante (→)"
            >
              <Icon name="skip-forward" size={18} />
              {isLastStep ? 'Terminer la séquence' : 'Étape suivante'}
            </button>
          ) : (
            <button
              className="btn icon lg"
              onClick={() => wrap(() => nextStepLive(session))}
              disabled={busy || isLastStep}
              title="Suivant"
              aria-label="Suivant"
            >
              <Icon name="skip-forward" size={20} />
            </button>
          )}

          <button
            className="btn icon lg"
            onClick={() => wrap(() => resetLive(session))}
            disabled={busy || session.status === 'pending'}
            title="Reset"
            aria-label="Reset"
          >
            <Icon name="rotate" size={20} />
          </button>
          <button
            className="btn icon lg danger-btn"
            onClick={() => setConfirmEndOpen(true)}
            disabled={busy}
            title="Clôturer le live"
            aria-label="Clôturer le live"
          >
            <Icon name="square" size={18} />
          </button>
      </div>

      <ConfirmDialog
        open={confirmEndOpen}
        title="Clôturer le live ?"
        message="Cette action est irréversible. Le rapport final sera calculé et la session apparaîtra dans l'historique."
        confirmLabel="Clôturer le live"
        cancelLabel="Continuer"
        variant="danger"
        icon="square"
        onConfirm={() => {
          setConfirmEndOpen(false);
          void wrap(() => endLive(session.id));
        }}
        onCancel={() => setConfirmEndOpen(false)}
      />
    </div>
  );
}
