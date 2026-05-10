import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { LiveSessionRow } from '../lib/database.types';

export interface UseLiveListResult {
  sessions: LiveSessionRow[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * S'abonne à toutes les sessions live actives (ended_at IS NULL).
 * Re-fetch sur chaque INSERT/UPDATE/DELETE.
 */
export function useLiveList(): UseLiveListResult {
  const [sessions, setSessions] = useState<LiveSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchAll = async (): Promise<void> => {
      const { data, error: err } = await supabase
        .from('live_sessions')
        .select('*')
        .is('ended_at', null)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (err) setError(err.message);
      else setSessions((data ?? []) as LiveSessionRow[]);
      setLoading(false);
    };

    void fetchAll();

    const channel = supabase
      .channel('live-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'sequencer', table: 'live_sessions' },
        () => {
          if (!cancelled) void fetchAll();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [refetchKey]);

  return {
    sessions,
    loading,
    error,
    refetch: () => setRefetchKey((k) => k + 1),
  };
}
