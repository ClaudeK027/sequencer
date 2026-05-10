import { useLiveList } from '../hooks/useLiveList';
import { useLiveHistory } from '../hooks/useLiveHistory';
import { Icon } from './Icon';
import { computeLiveView, formatMs } from '../lib/liveTime';
import { useRoute } from '../hooks/useRoute';
import { useEffect, useState } from 'react';
import { formatDurationVerbose, formatVariance } from '../lib/liveReport';
import type { LiveSessionRow } from '../lib/database.types';
import { deleteLiveSession } from '../lib/liveActions';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';

type Tab = 'active' | 'history';

function parseTabFromUrl(): Tab {
  const params = new URLSearchParams(window.location.search);
  return params.get('tab') === 'history' ? 'history' : 'active';
}

export function LiveListPage(): JSX.Element {
  const { sessions: active, loading: loadingActive, error } = useLiveList();
  const { sessions: history, loading: loadingHistory } = useLiveHistory(30);
  const { navigate, goBack } = useRoute();
  const [tab, setTab] = useState<Tab>(parseTabFromUrl);

  // Persister l'onglet actif dans l'URL via replaceState
  // (replaceState plutôt que pushState : changer d'onglet ne pollue pas l'historique)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (tab === 'active') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  // Tick local pour rafraîchir les "X min restantes"
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="page-live-list">
      <header className="live-page-header">
        <button className="btn ghost" onClick={() => goBack('/')}>
          <Icon name="arrow-left" />
          Retour
        </button>
        <h1>Lives</h1>
        <div className="live-counter">
          <span className="live-dot" />
          {active.length} actif{active.length > 1 ? 's' : ''}
        </div>
      </header>

      <div className="live-tabs">
        <button
          className={`live-tab ${tab === 'active' ? 'active' : ''}`}
          onClick={() => setTab('active')}
        >
          En cours
          <span className="live-tab-badge">{active.length}</span>
        </button>
        <button
          className={`live-tab ${tab === 'history' ? 'active' : ''}`}
          onClick={() => setTab('history')}
        >
          Historique
          <span className="live-tab-badge">{history.length}</span>
        </button>
      </div>

      <div className="live-list-body">
        {tab === 'active' ? (
          <ActiveLivesList
            sessions={active}
            loading={loadingActive}
            error={error}
            onJoin={(id) => navigate(`/live/${id}`)}
          />
        ) : (
          <HistoryList
            sessions={history}
            loading={loadingHistory}
            onOpen={(id) => navigate(`/live/${id}`)}
          />
        )}
      </div>
    </div>
  );
}

function ActiveLivesList({
  sessions,
  loading,
  error,
  onJoin,
}: {
  sessions: LiveSessionRow[];
  loading: boolean;
  error: string | null;
  onJoin: (id: string) => void;
}): JSX.Element {
  if (loading) return <Empty title="Chargement…" />;
  if (error) return <Empty title="Erreur" desc={error} />;
  if (sessions.length === 0) {
    return (
      <Empty
        icon="broadcast"
        title="Aucun live en cours"
        desc="Démarre un live depuis l'éditeur en cliquant sur Mettre en live."
      />
    );
  }

  return (
    <ul className="live-card-list">
      {sessions.map((s) => {
        const view = computeLiveView(s);
        const currentStep = s.sequence_snapshot.steps[view.currentIndex];
        return (
          <li key={s.id} className="live-card" onClick={() => onJoin(s.id)}>
            <div className="live-card-status">
              <StatusBadge status={s.status} />
              {s.mode === 'control' && (
                <span className="status-badge mode-control">Contrôle</span>
              )}
            </div>
            <div className="live-card-info">
              <div className="live-card-title">{s.title}</div>
              <div className="live-card-meta">
                Étape {view.currentIndex + 1}/{s.sequence_snapshot.steps.length}
                {currentStep && ` · ${currentStep.name}`}
                {s.status === 'running' && !view.inOvertime && ` · ${formatMs(view.remainingInStepMs)} restant`}
                {s.status === 'running' && view.inOvertime && ` · +${formatMs(view.overtimeMs)} dépassement`}
                {s.status === 'paused' && ' · ⏸ en pause'}
                {s.status === 'pending' && ' · prêt à démarrer'}
              </div>
            </div>
            <button className="btn primary live-card-join" onClick={() => onJoin(s.id)}>
              Rejoindre
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function HistoryList({
  sessions,
  loading,
  onOpen,
}: {
  sessions: LiveSessionRow[];
  loading: boolean;
  onOpen: (id: string) => void;
}): JSX.Element {
  const toast = useToast();
  const [pendingDelete, setPendingDelete] = useState<LiveSessionRow | null>(null);

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteLiveSession(target.id);
      toast.show('Rapport supprimé');
    } catch (e) {
      toast.show('Erreur : ' + (e as Error).message);
    }
  };

  if (loading) return <Empty title="Chargement…" />;
  if (sessions.length === 0) {
    return (
      <Empty
        icon="archive"
        title="Aucun live terminé"
        desc="L'historique des sessions clôturées apparaîtra ici avec leur rapport."
      />
    );
  }
  return (
    <>
      <ul className="live-card-list">
        {sessions.map((s) => {
          const report = s.report;
          const variance = report ? formatVariance(report.varianceMs) : null;
          const endedDate = s.ended_at ? new Date(s.ended_at) : null;
          return (
            <li key={s.id} className="live-card history" onClick={() => onOpen(s.id)}>
              <div className="live-card-status">
                <StatusBadge status="finished" />
                {s.mode === 'control' && (
                  <span className="status-badge mode-control">Contrôle</span>
                )}
              </div>
              <div className="live-card-info">
                <div className="live-card-title">{s.title}</div>
                <div className="live-card-meta">
                  {endedDate && (
                    <>
                      {endedDate.toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {' · '}
                      {endedDate.toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </>
                  )}
                  {report && (
                    <>
                      {' · '}
                      {formatDurationVerbose(report.effectiveDurationMs)} effectif
                      {variance && variance.sign !== 'zero' && (
                        <span className={`variance variance-${variance.sign}`}>
                          {' · '}
                          {variance.text}
                        </span>
                      )}
                    </>
                  )}
                  {!report && ' · rapport non calculé'}
                </div>
              </div>
              <div className="live-card-actions">
                <button
                  className="btn ghost icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPendingDelete(s);
                  }}
                  title="Supprimer ce rapport"
                  aria-label="Supprimer ce rapport"
                >
                  <Icon name="trash" size={14} />
                </button>
                <button className="btn live-card-join" onClick={() => onOpen(s.id)}>
                  Voir le rapport
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Supprimer ce rapport ?"
        message={
          pendingDelete
            ? `« ${pendingDelete.title} » sera supprimée définitivement, avec ses événements. Cette action est irréversible.`
            : ''
        }
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        icon="trash"
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}

function Empty({
  title,
  desc,
  icon,
}: {
  title: string;
  desc?: string;
  icon?: 'broadcast' | 'archive';
}): JSX.Element {
  return (
    <div className="empty">
      {icon && <Icon name={icon} size={26} className="empty-icon" />}
      <div className="empty-title">{title}</div>
      {desc && <div className="empty-desc">{desc}</div>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: 'En attente', cls: 'pending' },
    running: { label: 'EN COURS', cls: 'running' },
    paused: { label: 'PAUSE', cls: 'paused' },
    finished: { label: 'Terminé', cls: 'finished' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: '' };
  return (
    <span className={`status-badge ${cls}`}>
      {status === 'running' && <span className="live-dot" />}
      {label}
    </span>
  );
}
