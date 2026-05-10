import { useStore } from '../store';
import { useToast } from './Toast';
import { Icon } from './Icon';
import { formatTime, totalDuration } from '../lib/time';
import { createSequence, deleteSequence } from '../lib/sequenceActions';

export function Library(): JSX.Element {
  const sequences = useStore((s) => s.sequences);
  const activeId = useStore((s) => s.activeId);
  const loading = useStore((s) => s.loading);
  const select = useStore((s) => s.selectSequence);
  const toast = useToast();

  const sorted = [...sequences].sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCreate = async (): Promise<void> => {
    try {
      const seq = await createSequence();
      select(seq.id);
    } catch (e) {
      toast.show('Erreur création : ' + (e as Error).message);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();
    if (sequences.length <= 1) {
      toast.show('Au moins une séquence est requise');
      return;
    }
    try {
      await deleteSequence(id);
    } catch (err) {
      toast.show('Erreur suppression : ' + (err as Error).message);
    }
  };

  return (
    <aside className="pane pane-library">
      <div className="pane-header">
        <span className="title">Séquences</span>
        <button
          className="btn ghost icon"
          onClick={handleCreate}
          title="Nouvelle séquence"
          aria-label="Nouvelle séquence"
        >
          <Icon name="plus" />
        </button>
      </div>
      <div className="pane-body">
        {loading && sequences.length === 0 ? (
          <div className="empty">
            <div className="empty-title">Chargement…</div>
          </div>
        ) : (
          <ul className="seq-list">
            {sorted.map((seq) => {
              const total = totalDuration(seq.steps);
              const isActive = seq.id === activeId;
              return (
                <li
                  key={seq.id}
                  className={`seq-item ${isActive ? 'active' : ''}`}
                  onClick={() => select(seq.id)}
                >
                  <Icon name="folder" className="seq-icon" />
                  <div className="seq-info">
                    <div className="seq-name">{seq.name}</div>
                    <div className="seq-meta">
                      {seq.steps.length} étape{seq.steps.length > 1 ? 's' : ''} ·{' '}
                      {formatTime(total)}
                    </div>
                  </div>
                  <div className="seq-actions">
                    <button
                      className="btn ghost icon"
                      onClick={(e) => void handleDelete(seq.id, e)}
                      title="Supprimer la séquence"
                      aria-label="Supprimer la séquence"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
