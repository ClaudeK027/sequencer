import { useEffect, useState, type DragEvent } from 'react';
import type { Sequence, Step } from '../types';
import { Icon } from './Icon';
import { useToast } from './Toast';
import { renameStep, retimeStep, removeStep } from '../lib/sequenceActions';

interface Props {
  sequence: Sequence;
  step: Step;
  index: number;
  isActive: boolean;
  isDone: boolean;
  dragState: 'none' | 'above' | 'below' | 'dragging';
  onDragStart: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent, id: string) => void;
  onDragLeave: (id: string) => void;
  onDrop: (e: DragEvent, id: string) => void;
}

export function StepItem({
  sequence,
  step,
  index,
  isActive,
  isDone,
  dragState,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props): JSX.Element {
  const toast = useToast();
  const initialMin = Math.floor(step.duration / 60);
  const initialSec = step.duration % 60;
  const [name, setName] = useState(step.name);
  const [min, setMin] = useState(initialMin);
  const [sec, setSec] = useState(initialSec);

  // Synchronisation si la valeur change depuis l'extérieur (drag, realtime, restore)
  useEffect(() => setName(step.name), [step.name]);
  useEffect(() => {
    setMin(Math.floor(step.duration / 60));
    setSec(step.duration % 60);
  }, [step.duration]);

  const commitName = async (): Promise<void> => {
    if (!name.trim()) {
      setName(step.name);
      return;
    }
    if (name.trim() === step.name) return;
    try {
      await renameStep(sequence, step.id, name);
    } catch (err) {
      toast.show('Erreur : ' + (err as Error).message);
      setName(step.name);
    }
  };

  const commitDuration = async (): Promise<void> => {
    const duration = Math.max(0, min) * 60 + Math.max(0, Math.min(59, sec));
    if (duration <= 0) {
      setMin(initialMin);
      setSec(initialSec);
      return;
    }
    if (duration === step.duration) return;
    try {
      await retimeStep(sequence, step.id, duration);
    } catch (err) {
      toast.show('Erreur : ' + (err as Error).message);
      setMin(initialMin);
      setSec(initialSec);
    }
  };

  const handleDelete = async (): Promise<void> => {
    try {
      await removeStep(sequence, step.id);
    } catch (err) {
      toast.show('Erreur suppression : ' + (err as Error).message);
    }
  };

  const cls = ['step'];
  if (isActive) cls.push('active');
  if (isDone) cls.push('done');
  if (dragState === 'dragging') cls.push('dragging');
  if (dragState === 'above') cls.push('drop-above');
  if (dragState === 'below') cls.push('drop-below');

  return (
    <li
      className={cls.join(' ')}
      data-id={step.id}
      onDragOver={(e) => onDragOver(e, step.id)}
      onDragLeave={() => onDragLeave(step.id)}
      onDrop={(e) => onDrop(e, step.id)}
    >
      <span
        className="drag-handle"
        draggable
        onDragStart={(e) => onDragStart(e, step.id)}
        onDragEnd={onDragEnd}
        title="Glisser pour réorganiser"
      >
        <Icon name="grip" size={14} />
      </span>
      <span className="step-num">{String(index + 1).padStart(2, '0')}</span>
      <input
        className="inline-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setName(step.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        onFocus={(e) => e.target.select()}
        aria-label="Nom de l'étape"
      />
      <span className="step-time-edit">
        <input
          type="number"
          min={0}
          max={999}
          value={min}
          onChange={(e) => setMin(parseInt(e.target.value, 10) || 0)}
          onBlur={commitDuration}
          onFocus={(e) => e.target.select()}
          aria-label="Minutes"
        />
        <span className="colon">:</span>
        <input
          type="number"
          min={0}
          max={59}
          value={String(sec).padStart(2, '0')}
          onChange={(e) => setSec(parseInt(e.target.value, 10) || 0)}
          onBlur={commitDuration}
          onFocus={(e) => e.target.select()}
          aria-label="Secondes"
        />
      </span>
      <span className="step-controls">
        <button
          className="btn ghost icon"
          onClick={() => void handleDelete()}
          title="Supprimer l'étape"
          aria-label="Supprimer l'étape"
        >
          <Icon name="trash" size={14} />
        </button>
      </span>
    </li>
  );
}
