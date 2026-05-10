import { useState } from 'react';
import type { LiveSessionRow, SessionReport } from '../lib/database.types';
import {
  formatDurationVerbose,
  formatTimeOfDay,
  formatVariance,
} from '../lib/liveReport';
import { regenerateReport, deleteLiveSession } from '../lib/liveActions';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { useRoute } from '../hooks/useRoute';

interface Props {
  session: LiveSessionRow;
}

export function ReportView({ session }: Props): JSX.Element {
  const toast = useToast();
  const { goBack } = useRoute();
  const [regenerating, setRegenerating] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const report = session.report;

  const handleRegenerate = async (): Promise<void> => {
    setRegenerating(true);
    try {
      await regenerateReport(session.id);
      toast.show('Rapport recalculé');
    } catch (e) {
      toast.show('Erreur : ' + (e as Error).message);
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    try {
      await deleteLiveSession(session.id);
      toast.show('Rapport supprimé');
      goBack('/live?tab=history');
    } catch (e) {
      toast.show('Erreur : ' + (e as Error).message);
      setDeleting(false);
    }
  };

  const handleExport = (): void => {
    if (!report) return;
    const payload = {
      session: {
        id: session.id,
        title: session.title,
        sequence_snapshot: session.sequence_snapshot,
      },
      report,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rapport-${slug(session.title)}-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!report) {
    return (
      <div className="report-empty">
        <div className="empty-title">Rapport non disponible</div>
        <div className="empty-desc">
          Aucun rapport calculé pour cette session. Tu peux le générer
          maintenant à partir des événements stockés.
        </div>
        <button className="btn primary" onClick={handleRegenerate} disabled={regenerating}>
          {regenerating ? 'Calcul…' : 'Générer le rapport'}
        </button>
      </div>
    );
  }

  return (
    <div className="report">
      {/* === Résumé niveau séquence === */}
      <div className="report-summary">
        <div className="report-row">
          <ReportStat label="Début" value={formatTimeOfDay(report.startedAt)} />
          <ReportStat label="Fin" value={formatTimeOfDay(report.endedAt)} />
          <ReportStat
            label="Durée totale"
            value={formatDurationVerbose(report.realDurationMs)}
            sub="wall-clock (incluant pauses)"
          />
        </div>
        <div className="report-row">
          <ReportStat
            label="Temps effectif"
            value={formatDurationVerbose(report.effectiveDurationMs)}
            sub="hors pauses"
          />
          <ReportStat
            label="Pauses"
            value={formatDurationVerbose(report.totalPauseDurationMs)}
            sub={`${report.pauseCount} pause${report.pauseCount > 1 ? 's' : ''}`}
          />
          <ReportStat
            label="Variance vs planning"
            value={formatVariance(report.varianceMs).text}
            sub={`prévu ${formatDurationVerbose(report.plannedDurationMs)} · réel ${formatDurationVerbose(report.realDurationMs)}`}
            variance={formatVariance(report.varianceMs).sign}
          />
        </div>
        {/* Dépassement total : pertinent surtout en mode contrôle, mais affiché
            dès qu'il y a au moins une étape en overtime */}
        {(report.totalOvertimeMs > 1000 || report.mode === 'control') && (
          <div className="report-row">
            <ReportStat
              label="Dépassement total"
              value={formatDurationVerbose(report.totalOvertimeMs)}
              sub={`${report.overtimeStepCount} étape${report.overtimeStepCount > 1 ? 's' : ''} en dépassement`}
              variance={report.totalOvertimeMs > 1000 ? 'pos' : 'zero'}
            />
            <ReportStat
              label="Mode"
              value={report.mode === 'control' ? 'Contrôle' : 'Auto'}
              sub={report.mode === 'control' ? 'transitions manuelles' : 'transitions automatiques'}
            />
            <div /> {/* slot vide pour conserver la grille 3 colonnes */}
          </div>
        )}
        {(report.skipForwardCount > 0 ||
          report.skipBackCount > 0 ||
          report.resetCount > 0) && (
          <div className="report-row report-row-sub">
            {report.skipForwardCount > 0 && (
              <span className="report-pill">
                {report.skipForwardCount} skip{report.skipForwardCount > 1 ? 's' : ''} avant
              </span>
            )}
            {report.skipBackCount > 0 && (
              <span className="report-pill">
                {report.skipBackCount} retour{report.skipBackCount > 1 ? 's' : ''}
              </span>
            )}
            {report.resetCount > 0 && (
              <span className="report-pill">
                {report.resetCount} reset{report.resetCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* === Tableau par étape === */}
      <div className="report-table-wrap">
        <table className="report-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Étape</th>
              <th>Début</th>
              <th>Fin</th>
              <th>Prévu</th>
              <th title="Durée wall-clock = effectif + pauses">Réel</th>
              <th title="Hors pauses">Effectif</th>
              <th>Pauses</th>
              <th title="Effectif - Prévu, capé à 0">Dépassement</th>
              <th title="Réel - Prévu (incluant pauses)">Variance</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {report.steps.map((s) => {
              const v = formatVariance(s.varianceMs);
              const hasOvertime = s.overtimeMs > 1000;
              return (
                <tr key={s.index} className={!s.reached ? 'unreached' : ''}>
                  <td className="num">{String(s.index + 1).padStart(2, '0')}</td>
                  <td className="name">{s.name}</td>
                  <td className="time">{formatTimeOfDay(s.actualStartAt)}</td>
                  <td className="time">{formatTimeOfDay(s.actualEndAt)}</td>
                  <td className="dur">{formatDurationVerbose(s.plannedDurationMs)}</td>
                  <td className="dur strong">
                    {s.reached ? formatDurationVerbose(s.actualDurationMs) : '—'}
                  </td>
                  <td className="dur dim">
                    {s.reached ? formatDurationVerbose(s.effectiveDurationMs) : '—'}
                  </td>
                  <td className="dur">
                    {s.pauseDurationMs > 0 ? (
                      <span title={`${s.pauseCount} pause${s.pauseCount > 1 ? 's' : ''}`}>
                        {formatDurationVerbose(s.pauseDurationMs)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`overtime ${hasOvertime ? 'positive' : ''}`}>
                    {s.reached
                      ? hasOvertime
                        ? `+${formatDurationVerbose(s.overtimeMs)}`
                        : '—'
                      : '—'}
                  </td>
                  <td className={`variance variance-${v.sign}`}>{s.reached ? v.text : '—'}</td>
                  <td>
                    <StatusChip step={s} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="report-actions">
        <button
          className="btn danger-action"
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={deleting}
        >
          <Icon name="trash" size={14} />
          {deleting ? 'Suppression…' : 'Supprimer'}
        </button>
        <button className="btn ghost" onClick={handleRegenerate} disabled={regenerating}>
          <Icon name="rotate" size={14} />
          {regenerating ? 'Recalcul…' : 'Recalculer'}
        </button>
        <button className="btn" onClick={handleExport}>
          <Icon name="download" size={14} />
          Exporter JSON
        </button>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Supprimer ce rapport ?"
        message="Le rapport, la session live et tous ses événements seront supprimés définitivement. Cette action est irréversible."
        confirmLabel="Supprimer"
        cancelLabel="Annuler"
        variant="danger"
        icon="trash"
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          void handleDelete();
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}

function ReportStat({
  label,
  value,
  sub,
  variance,
}: {
  label: string;
  value: string;
  sub?: string;
  variance?: 'pos' | 'neg' | 'zero';
}): JSX.Element {
  return (
    <div className="report-stat">
      <div className="report-stat-label">{label}</div>
      <div className={`report-stat-value ${variance ? `variance-${variance}` : ''}`}>
        {value}
      </div>
      {sub && <div className="report-stat-sub">{sub}</div>}
    </div>
  );
}

function StatusChip({ step }: { step: SessionReport['steps'][number] }): JSX.Element {
  if (!step.reached) return <span className="chip chip-muted">non atteinte</span>;
  if (step.skipped) return <span className="chip chip-warn">sautée</span>;
  if (step.completed) return <span className="chip chip-ok">complétée</span>;
  return <span className="chip chip-info">interrompue</span>;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
