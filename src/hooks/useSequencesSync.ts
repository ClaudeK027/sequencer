import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store';
import { createSequence, fetchAllSequences, rowToSequence } from '../lib/sequenceActions';

/**
 * Synchronise le store local avec la table sequencer.sequences :
 *  - fetch initial
 *  - garantit qu'au moins une séquence existe (auto-création si table vide)
 *  - garantit qu'activeId pointe vers une séquence valide
 *  - subscribe Realtime (INSERT/UPDATE/DELETE) pour la sync multi-appareils
 *
 * À appeler UNE SEULE FOIS au top de l'arbre React.
 */
export function useSequencesSync(): void {
  useEffect(() => {
    let cancelled = false;
    const store = useStore.getState();
    store._setLoading(true);
    store._setError(null);

    const init = async (): Promise<void> => {
      try {
        let sequences = await fetchAllSequences();

        // Si la base est vide, on crée une séquence par défaut
        if (sequences.length === 0) {
          const blank = await createSequence();
          sequences = [blank];
        }

        if (cancelled) return;

        useStore.setState((s) => ({
          sequences,
          loading: false,
          error: null,
          // Si l'activeId persisté ne correspond plus à rien, on prend le premier
          activeId:
            s.activeId && sequences.find((seq) => seq.id === s.activeId)
              ? s.activeId
              : sequences[0].id,
        }));
      } catch (err) {
        if (cancelled) return;
        useStore.setState({
          loading: false,
          error: (err as Error).message,
        });
      }
    };

    void init();

    // Realtime : on réagit aux mutations distantes (et locales — c'est aussi
    // le mécanisme qui propage nos propres updates dans le store)
    const channel = supabase
      .channel('sequences-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'sequencer', table: 'sequences' },
        (payload) => {
          if (cancelled) return;
          const state = useStore.getState();
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id;
            state._removeSequence(id);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            state._upsertSequence(rowToSequence(payload.new as any));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);
}
