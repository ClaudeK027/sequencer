import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Sequence } from '../types';
import { Icon } from './Icon';
import { AddStepForm } from './AddStepForm';
import { StepItem } from './StepItem';
import { useToast } from './Toast';
import { renameSequence, reorderStep } from '../lib/sequenceActions';

interface Props {
  sequence: Sequence;
  currentIndex: number;
  running: boolean;
  remaining: number;
}

type DragState = 'none' | 'above' | 'below' | 'dragging';

export function Editor({ sequence, currentIndex, running, remaining }: Props): JSX.Element {
  const toast = useToast();

  const [name, setName] = useState(sequence.name);
  useEffect(() => setName(sequence.name), [sequence.name]);

  const dragSrcId = useRef<string | null>(null);
  const [dragStates, setDragStates] = useState<Record<string, DragState>>({});

  const handleDragStart = (e: DragEvent, id: string): void => {
    dragSrcId.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setDragStates({ [id]: 'dragging' });
  };

  const handleDragEnd = (): void => {
    dragSrcId.current = null;
    setDragStates({});
  };

  const handleDragOver = (e: DragEvent, id: string): void => {
    if (!dragSrcId.current || dragSrcId.current === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY - rect.top < rect.height / 2;
    const src = dragSrcId.current;
    setDragStates({ [src]: 'dragging', [id]: above ? 'above' : 'below' });
  };

  const handleDragLeave = (id: string): void => {
    setDragStates((prev) => {
      if (prev[id] === 'above' || prev[id] === 'below') {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return prev;
    });
  };

  const handleDrop = (e: DragEvent, id: string): void => {
    e.preventDefault();
    if (!dragSrcId.current || dragSrcId.current === id) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const above = e.clientY - rect.top < rect.height / 2;
    void reorderStep(sequence, dragSrcId.current, id, above ? 'above' : 'below').catch((err) =>
      toast.show('Erreur réorganisation : ' + (err as Error).message)
    );
    dragSrcId.current = null;
    setDragStates({});
  };

  const commitName = async (): Promise<void> => {
    if (name.trim() === sequence.name) return;
    try {
      await renameSequence(sequence.id, name);
    } catch (err) {
      toast.show('Erreur renommage : ' + (err as Error).message);
    }
  };

  const empty = sequence.steps.length === 0;

  return (
    <section className="pane pane-editor">
      <div className="editor-name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          placeholder="Nom de la séquence"
          aria-label="Nom de la séquence"
        />
      </div>
      <AddStepForm sequence={sequence} />
      <div className="pane-body">
        {empty ? (
          <div className="empty">
            <Icon name="list" size={26} className="empty-icon" />
            <div className="empty-title">Aucune étape</div>
            <div className="empty-desc">
              Ajoute une première étape avec le formulaire ci-dessus.
            </div>
          </div>
        ) : (
          <ul className="steps">
            {sequence.steps.map((step, i) => (
              <StepItem
                key={step.id}
                sequence={sequence}
                step={step}
                index={i}
                isActive={i === currentIndex && (running || remaining > 0)}
                isDone={running && i < currentIndex}
                dragState={dragStates[step.id] ?? 'none'}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
