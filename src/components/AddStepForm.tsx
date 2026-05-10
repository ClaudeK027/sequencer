import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { addStep } from '../lib/sequenceActions';
import type { Sequence } from '../types';

interface Props {
  sequence: Sequence;
}

const PRESETS: Array<{ label: string; value: string }> = [
  { label: '15 secondes', value: '0:15' },
  { label: '30 secondes', value: '0:30' },
  { label: '45 secondes', value: '0:45' },
  { label: '1 minute', value: '1:0' },
  { label: '2 minutes', value: '2:0' },
  { label: '3 minutes', value: '3:0' },
  { label: '5 minutes', value: '5:0' },
  { label: '10 minutes', value: '10:0' },
  { label: '15 minutes', value: '15:0' },
  { label: '20 minutes', value: '20:0' },
  { label: '30 minutes', value: '30:0' },
  { label: '45 minutes', value: '45:0' },
  { label: '1 heure', value: '60:0' },
];

export function AddStepForm({ sequence }: Props): JSX.Element {
  const toast = useToast();
  const [name, setName] = useState('');
  const [min, setMin] = useState(0);
  const [sec, setSec] = useState(30);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const duration = min * 60 + sec;
    if (!name.trim() || duration <= 0 || submitting) return;
    setSubmitting(true);
    try {
      await addStep(sequence, name, duration);
      setName('');
    } catch (err) {
      toast.show('Erreur ajout : ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreset = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    if (!e.target.value) return;
    const [m, s] = e.target.value.split(':').map((n) => parseInt(n, 10) || 0);
    setMin(m);
    setSec(s);
    e.target.value = '';
  };

  return (
    <form className="step-form" onSubmit={handleSubmit}>
      <span className="form-label">Ajouter une étape</span>
      <input
        className="input name-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom de l'étape (ex: Introduction)"
        autoComplete="off"
        required
      />
      <div className="duration-row">
        <div className="time-box">
          <input
            type="number"
            min={0}
            max={999}
            value={min}
            onChange={(e) => setMin(Math.max(0, parseInt(e.target.value, 10) || 0))}
            onFocus={(e) => e.target.select()}
            aria-label="Minutes"
          />
          <span className="unit">min</span>
          <span className="colon">:</span>
          <input
            type="number"
            min={0}
            max={59}
            value={sec}
            onChange={(e) => setSec(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
            onFocus={(e) => e.target.select()}
            aria-label="Secondes"
          />
          <span className="unit">sec</span>
        </div>
        <select
          className="duration-preset"
          defaultValue=""
          onChange={handlePreset}
          aria-label="Durée prédéfinie"
        >
          <option value="">Préréglage…</option>
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <button
        className="btn primary add-button"
        type="submit"
        disabled={submitting}
        title="Ajouter l'étape (Entrée)"
      >
        <Icon name="plus" />
        {submitting ? 'Ajout…' : "Ajouter l'étape"}
      </button>
    </form>
  );
}
