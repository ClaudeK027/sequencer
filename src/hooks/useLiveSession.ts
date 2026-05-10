import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { LiveSessionRow } from '../lib/database.types';

export interface UseLiveSessionResult {
  session: LiveSessionRow | null;
  loading: boolean;
  error: string | null;
}

/**
 * S'abonne à une session live via Realtime.
 * Re-fetch initial + subscribe aux UPDATE/DELETE sur la ligne.
 */
export function useLiveSession(sessionId: string | undefined): UseLiveSessionResult {
  const [session, setSession] = useState<LiveSessionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // 1. Fetch initial
    supabase
      .from('live_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) {
          setError(err.message);
        } else {
          setSession(data as LiveSessionRow | null);
        }
        setLoading(false);
      });

    // 2. Subscribe realtime
    const channel = supabase
      .channel(`live-session:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'sequencer',
          table: 'live_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') {
            setSession(null);
          } else {
            setSession(payload.new as LiveSessionRow);
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  return { session, loading, error };
}
