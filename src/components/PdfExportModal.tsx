import { useEffect, useState } from 'react';
import type { Sequence } from '../types';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { printSequenceAsPdf } from '../lib/pdfExport';

interface Props {
  open: boolean;
  onClose: () => void;
  sequence: Sequence;
}

/** Modal de configuration avant génération du PDF de la séquence. */
export function PdfExportModal({ open, onClose, sequence }: Props): JSX.Element {
  // On synchronise les défauts au moment de l'ouverture (et pas avant, sinon
  // ils ne reflètent pas la séquence active la plus récente)
  const [title, setTitle] = useState(sequence.name);
  const [subtitle, setSubtitle] = useState('');
  const [startTime, setStartTime] = useState('10:00');

  useEffect(() => {
    if (open) {
      setTitle(sequence.name);
      // Sous-titre par défaut : date du jour
      const today = new Date().toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      setSubtitle(today.charAt(0).toUpperCase() + today.slice(1));
    }
  }, [open, sequence.name]);

  const handleSubmit = (): void => {
    printSequenceAsPdf(sequence, {
      title: title.trim() || sequence.name,
      subtitle: subtitle.trim() || undefined,
      startTime,
    });
    onClose();
  };

  const canSubmit = sequence.steps.length > 0 && title.trim().length > 0;

  return (
    <Modal open={open} title="Exporter en PDF" onClose={onClose}>
      <div className="form-stack">
        <label className="field">
          <span className="field-label">Titre</span>
          <input
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Titre du document"
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">Sous-titre (optionnel)</span>
          <input
            className="input"
            type="text"
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="ex: Dimanche 11 mai 2026"
          />
        </label>

        <label className="field">
          <span className="field-label">Heure de début</span>
          <input
            className="input"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <span className="field-hint">
            Les heures de chaque étape sont calculées à partir de ce point de départ.
          </span>
        </label>

        {sequence.steps.length === 0 && (
          <div className="field-hint" style={{ color: 'var(--warning)' }}>
            Ajoute au moins une étape avant d'exporter.
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn primary" onClick={handleSubmit} disabled={!canSubmit}>
            <Icon name="file-text" size={14} />
            Générer le PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}
