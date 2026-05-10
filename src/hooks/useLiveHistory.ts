import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { LiveSessionRow } from '../lib/database.types';

/**
 * Liste des sessions terminées (ended_at IS NOT NULL), pour la section
 * historique. On ne s'abonne PAS au realtime ici (l'historique change peu),
 * on refetch ponctuellement.
 */
export function useLiveHistory(limit = 20): {
  sessions: LiveSessionRow[];
  loading: boolean;
  error: string | null;
} {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchAll = async (): Promise<void> => {
      const { data, error: err } = await supabase
        .from('live_sessions')
        .select('*')
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(limit);
      if (cancelled) return;
      if (err) setError(err.message);
      else setSessions((data ?? []) as LiveSessionRow[]);
      setLoading(false);
    };

    void fetchAll();

    // Refetch à la fin de chaque live (subscribe sur events de fin)
    const channel = supabase
      .channel('live-history')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'sequencer', table: 'live_sessions' },
        (payload) => {
          const newRow = payload.new as LiveSessionRow;
          if (!cancelled && newRow.ended_at) void fetchAll();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [limit]);

  return { sessions, loading, error };
}
