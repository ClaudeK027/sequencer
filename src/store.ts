import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sequence } from './types';

/**
 * Store local = cache des séquences Supabase + préférences par appareil.
 *
 * Persistance localStorage limitée à `activeId` et `soundEnabled` (préférences
 * propres à l'appareil). Les `sequences` sont la source de vérité Supabase,
 * synchronisées via le hook useSequencesSync.
 */
interface StoreState {
  // Cache (rempli par useSequencesSync, jamais persisté)
  sequences: Sequence[];
  loading: boolean;
  error: string | null;

  // Préférences locales (persistées)
  activeId: string | null;
  soundEnabled: boolean;

  // Actions UI
  selectSequence: (id: string | null) => void;
  toggleSound: () => void;

  // Setters internes utilisés par le hook de sync
  _setSequences: (seqs: Sequence[]) => void;
  _upsertSequence: (seq: Sequence) => void;
  _removeSequence: (id: string) => void;
  _setLoading: (b: boolean) => void;
  _setError: (msg: string | null) => void;
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
      sequences: [],
      loading: true,
      error: null,
      activeId: null,
      soundEnabled: true,

      selectSequence: (id) => set({ activeId: id }),
      toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),

      _setSequences: (sequences) => set({ sequences }),
      _upsertSequence: (seq) =>
        set((s) => {
          const idx = s.sequences.findIndex((x) => x.id === seq.id);
          if (idx >= 0) {
            const next = s.sequences.slice();
            next[idx] = seq;
            return { sequences: next };
          }
          return { sequences: [...s.sequences, seq] };
        }),
      _removeSequence: (id) =>
        set((s) => ({
          sequences: s.sequences.filter((x) => x.id !== id),
          activeId: s.activeId === id ? null : s.activeId,
        })),
      _setLoading: (loading) => set({ loading }),
      _setError: (error) => set({ error }),
    }),
    {
      name: 'sequencer.prefs.v1',
      // On ne persiste QUE les préférences de l'appareil
      partialize: (s) => ({ activeId: s.activeId, soundEnabled: s.soundEnabled }),
    }
  )
);

export function useActiveSequence(): Sequence | null {
  return useStore((s) => s.sequences.find((seq) => seq.id === s.activeId) ?? null);
}
