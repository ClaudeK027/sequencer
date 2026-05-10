import { useState } from 'react';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { useActiveSequence } from '../store';
import { createLiveSession } from '../lib/liveActions';
import type { LiveMode } from '../lib/database.types';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

export function GoLiveModal({ open, onClose, onCreated }: Props): JSX.Element {
  const active = useActiveSequence();
  const toast = useToast();
  const [title, setTitle] = useState(active?.name ?? '');
  const [isPublic, setIsPublic] = useState(true);
  const [mode, setMode] = useState<LiveMode>('auto');
  const [submitting, setSubmitting] = useState(false);

  // Synchronise le titre par défaut quand on ouvre la modale
  if (open && !title && active?.name) setTitle(active.name);

  const canSubmit = !!active && active.steps.length > 0 && title.trim().length > 0 && !submitting;

  const handleSubmit = async (): Promise<void> => {
    if (!active || active.steps.length === 0) {
      toast.show('Ajoute au moins une étape avant de mettre en live');
      return;
    }
    setSubmitting(true);
    try {
      const id = await createLiveSession({
        title: title.trim(),
        snapshot: {
          name: active.name,
          steps: active.steps.map((s) => ({ name: s.name, duration: s.duration })),
        },
        sequenceId: null,
        isPublic,
        mode,
      });
      toast.show('Live créé');
      onCreated(id);
      onClose();
    } catch (err) {
      console.error(err);
      toast.show('Erreur : ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} title="Mettre en live" onClose={onClose}>
      <div className="form-stack">
        <label className="field">
          <span className="field-label">Titre du live</span>
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex: Culte du dimanche 11/05"
            onFocus={(e) => e.target.select()}
            autoFocus
          />
        </label>

        <div className="field">
          <span className="field-label">Mode de pilotage</span>
          <div className="mode-picker">
            <label className={`mode-option ${mode === 'auto' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mode"
                value="auto"
                checked={mode === 'auto'}
                onChange={() => setMode('auto')}
              />
              <div>
                <strong>Auto</strong>
                <span className="mode-desc">
                  Le timer pilote : transitions automatiques à 0:00, fin auto à la dernière étape.
                </span>
              </div>
            </label>
            <label className={`mode-option ${mode === 'control' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="mode"
                value="control"
                checked={mode === 'control'}
                onChange={() => setMode('control')}
              />
              <div>
                <strong>Contrôle</strong>
                <span className="mode-desc">
                  Tu pilotes : transitions manuelles via « Étape suivante ». Le timer continue à compter en cas de dépassement (overtime).
                </span>
              </div>
            </label>
          </div>
        </div>

        <label className="field-toggle">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
          />
          <span>
            <strong>Visible dans la liste publique</strong>
            <span className="field-hint">
              Décocher pour ne partager qu'avec ceux qui ont l'URL
            </span>
          </span>
        </label>

        <div className="modal-actions">
          <button className="btn" onClick={onClose} disabled={submitting}>
            Annuler
          </button>
          <button className="btn primary" onClick={handleSubmit} disabled={!canSubmit}>
            <Icon name="broadcast" />
            {submitting ? 'Création…' : 'Créer le live'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
