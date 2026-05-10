import { useRef } from 'react';
import { useStore, useActiveSequence } from '../store';
import { useToast } from './Toast';
import { Icon } from './Icon';
import type { BackupPayload } from '../types';
import { importSequence, restoreSequencesBackup } from '../lib/sequenceActions';

interface Props {
  onToggleFullscreen: () => void;
  onGoLive: () => void;
}

export function TopBar({ onToggleFullscreen, onGoLive }: Props): JSX.Element {
  const soundEnabled = useStore((s) => s.soundEnabled);
  const toggleSound = useStore((s) => s.toggleSound);
  const sequences = useStore((s) => s.sequences);
  const selectSequence = useStore((s) => s.selectSequence);
  const active = useActiveSequence();
  const toast = useToast();

  const importInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);

  const exportActive = (): void => {
    if (!active) return;
    const payload = {
      name: active.name,
      steps: active.steps.map((s) => ({ name: s.name, duration: s.duration })),
    };
    downloadJson(payload, `${slug(active.name)}.json`);
  };

  const exportBackup = (): void => {
    const payload: BackupPayload = {
      type: 'sequence-timer-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      soundEnabled,
      sequences: sequences.map((seq) => ({
        name: seq.name,
        updatedAt: seq.updatedAt,
        steps: seq.steps.map((s) => ({ name: s.name, duration: s.duration })),
      })),
    };
    downloadJson(payload, `sequencer-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast.show(`Backup de ${sequences.length} séquence${sequences.length > 1 ? 's' : ''}`);
  };

  const handleImportFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const steps = Array.isArray(data) ? data : data.steps;
      const name = (data && data.name) || `Importée ${new Date().toLocaleDateString()}`;
      if (!Array.isArray(steps)) throw new Error('Format invalide');
      const seq = await importSequence(name, steps);
      selectSequence(seq.id);
      toast.show(`"${name}" importée`);
    } catch (err) {
      toast.show('Fichier JSON invalide : ' + (err as Error).message);
    }
  };

  const handleRestoreFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      const data: BackupPayload = JSON.parse(text);
      if (data.type !== 'sequence-timer-backup' || !Array.isArray(data.sequences)) {
        throw new Error('Format de backup invalide');
      }
      const ok = window.confirm(
        `Restaurer ce backup ?\n\n${data.sequences.length} séquence(s) à importer.\nLes séquences actuelles (${sequences.length}) seront remplacées dans Supabase.`
      );
      if (!ok) return;
      const n = await restoreSequencesBackup(data.sequences);
      if (n === 0) throw new Error('Aucune séquence valide');
      toast.show(`${n} séquence${n > 1 ? 's' : ''} restaurée${n > 1 ? 's' : ''}`);
    } catch (err) {
      toast.show('Backup invalide : ' + (err as Error).message);
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="dot" />
        <span>Sequence Timer</span>
      </div>
      <div className="actions">
        <button
          className="btn go-live-btn"
          onClick={onGoLive}
          title="Mettre en live"
          aria-label="Mettre en live"
        >
          <Icon name="broadcast" />
          <span className="go-live-label">Live</span>
        </button>
        <a
          className="btn ghost"
          href="/live"
          onClick={(e) => {
            e.preventDefault();
            window.history.pushState({}, '', '/live');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          title="Voir les lives en cours"
          aria-label="Voir les lives en cours"
        >
          <Icon name="users" />
        </a>
        <span className="divider" />
        <button
          className="btn ghost"
          onClick={() => importInput.current?.click()}
          title="Importer une séquence"
          aria-label="Importer une séquence"
        >
          <Icon name="upload" />
        </button>
        <button
          className="btn ghost"
          onClick={exportActive}
          title="Exporter la séquence active"
          aria-label="Exporter la séquence active"
        >
          <Icon name="download" />
        </button>
        <span className="divider" />
        <button
          className="btn ghost"
          onClick={() => restoreInput.current?.click()}
          title="Restaurer un backup complet"
          aria-label="Restaurer un backup complet"
        >
          <Icon name="restore" />
        </button>
        <button
          className="btn ghost"
          onClick={exportBackup}
          title="Sauvegarder toutes les séquences"
          aria-label="Sauvegarder toutes les séquences"
        >
          <Icon name="archive" />
        </button>
        <span className="divider" />
        <button
          className="btn ghost"
          onClick={toggleSound}
          title={soundEnabled ? 'Désactiver le son' : 'Activer le son'}
          aria-label={soundEnabled ? 'Désactiver le son' : 'Activer le son'}
        >
          <Icon name={soundEnabled ? 'volume' : 'volume-off'} />
        </button>
        <button
          className="btn ghost"
          onClick={onToggleFullscreen}
          title="Plein écran (F)"
          aria-label="Plein écran"
        >
          <Icon name="maximize" />
        </button>
        <input
          ref={importInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = '';
          }}
        />
        <input
          ref={restoreInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleRestoreFile(file);
            e.target.value = '';
          }}
        />
      </div>
    </header>
  );
}

function slug(s: string): string {
  return s.replace(/\s+/g, '-').toLowerCase();
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
