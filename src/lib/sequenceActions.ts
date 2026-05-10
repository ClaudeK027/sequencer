import { supabase } from './supabase';
import { uid } from './uid';
import type { Sequence, Step } from '../types';

/* ----------------------------------------------------------------
   Helpers DB ↔ App
   ---------------------------------------------------------------- */

interface DbStep {
  id?: string;
  name: string;
  duration: number;
}

interface DbSequenceRow {
  id: string;
  name: string;
  steps: DbStep[];
  updated_at: string;
}

export function rowToSequence(row: DbSequenceRow): Sequence {
  return {
    id: row.id,
    name: row.name,
    steps: (row.steps ?? []).map((s) => ({
      id: s.id ?? uid(),
      name: s.name,
      duration: s.duration,
    })),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function stepsToDb(steps: Step[]): DbStep[] {
  return steps.map((s) => ({ id: s.id, name: s.name, duration: s.duration }));
}

/* ----------------------------------------------------------------
   Mutations niveau séquence
   ---------------------------------------------------------------- */

export async function createSequence(name = 'Nouvelle séquence'): Promise<Sequence> {
  const { data, error } = await supabase
    .from('sequences')
    .insert({ name, steps: [] })
    .select('*')
    .single();
  if (error) throw error;
  return rowToSequence(data as DbSequenceRow);
}

export async function deleteSequence(id: string): Promise<void> {
  const { error } = await supabase.from('sequences').delete().eq('id', id);
  if (error) throw error;
}

export async function renameSequence(id: string, name: string): Promise<void> {
  const trimmed = name.trim() || 'Sans nom';
  const { error } = await supabase.from('sequences').update({ name: trimmed }).eq('id', id);
  if (error) throw error;
}

export async function importSequence(
  name: string,
  steps: Array<{ name: string; duration: number }>
): Promise<Sequence> {
  const dbSteps: DbStep[] = steps
    .filter((s) => s && typeof s.name === 'string' && typeof s.duration === 'number' && s.duration > 0)
    .map((s) => ({ id: uid(), name: s.name, duration: s.duration }));
  const { data, error } = await supabase
    .from('sequences')
    .insert({ name: name || `Importée ${new Date().toLocaleDateString()}`, steps: dbSteps })
    .select('*')
    .single();
  if (error) throw error;
  return rowToSequence(data as DbSequenceRow);
}

export async function fetchAllSequences(): Promise<Sequence[]> {
  const { data, error } = await supabase
    .from('sequences')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => rowToSequence(r as DbSequenceRow));
}

/** Réinitialisation totale : supprime toutes les séquences puis ré-insère. */
export async function restoreSequencesBackup(
  sequences: Array<{ name: string; steps: Array<{ name: string; duration: number }> }>
): Promise<number> {
  // DELETE all (RLS v1 ouvertes le permet)
  const { error: delErr } = await supabase
    .from('sequences')
    .delete()
    .gte('created_at', '1970-01-01');
  if (delErr) throw delErr;

  if (sequences.length === 0) return 0;

  const inserts = sequences.map((s) => ({
    name: s.name || 'Sans nom',
    steps: s.steps
      .filter((st) => st && typeof st.name === 'string' && typeof st.duration === 'number' && st.duration > 0)
      .map((st) => ({ id: uid(), name: st.name, duration: st.duration })),
  }));
  const { data, error } = await supabase.from('sequences').insert(inserts).select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

/* ----------------------------------------------------------------
   Mutations niveau étape (mise à jour bulk du JSONB `steps`)
   ---------------------------------------------------------------- */

async function updateSteps(sequenceId: string, steps: Step[]): Promise<void> {
  const { error } = await supabase
    .from('sequences')
    .update({ steps: stepsToDb(steps) })
    .eq('id', sequenceId);
  if (error) throw error;
}

export async function addStep(seq: Sequence, name: string, duration: number): Promise<void> {
  if (!name.trim() || duration <= 0) return;
  const newStep: Step = { id: uid(), name: name.trim(), duration };
  await updateSteps(seq.id, [...seq.steps, newStep]);
}

export async function removeStep(seq: Sequence, stepId: string): Promise<void> {
  await updateSteps(seq.id, seq.steps.filter((s) => s.id !== stepId));
}

export async function renameStep(seq: Sequence, stepId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await updateSteps(
    seq.id,
    seq.steps.map((s) => (s.id === stepId && s.name !== trimmed ? { ...s, name: trimmed } : s))
  );
}

export async function retimeStep(seq: Sequence, stepId: string, duration: number): Promise<void> {
  if (duration <= 0) return;
  await updateSteps(
    seq.id,
    seq.steps.map((s) => (s.id === stepId && s.duration !== duration ? { ...s, duration } : s))
  );
}

export async function reorderStep(
  seq: Sequence,
  srcId: string,
  targetId: string,
  position: 'above' | 'below'
): Promise<void> {
  if (srcId === targetId) return;
  const srcIdx = seq.steps.findIndex((s) => s.id === srcId);
  if (srcIdx < 0) return;
  const next = seq.steps.slice();
  const [moved] = next.splice(srcIdx, 1);
  const targetIdx = next.findIndex((s) => s.id === targetId);
  if (targetIdx < 0) return;
  next.splice(position === 'below' ? targetIdx + 1 : targetIdx, 0, moved);
  await updateSteps(seq.id, next);
}
