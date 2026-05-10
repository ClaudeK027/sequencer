import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY manquant. Vérifie .env.local'
  );
}

/**
 * Client Supabase non-générique : Supabase-js a des soucis connus de typage
 * avec un schéma custom (Insert/Update inférés à `never`). On garde donc
 * un client souple et on type explicitement les Row/Insert via nos types
 * applicatifs (LiveSessionRow, SequenceRow) dans les hooks et actions.
 */
export const supabase = createClient(url, anonKey, {
  db: { schema: 'sequencer' },
  realtime: { params: { eventsPerSecond: 5 } },
  auth: { persistSession: false },
});
