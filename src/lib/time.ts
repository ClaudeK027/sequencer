import type { Step } from '../types';

export function formatTime(secs: number): string {
  const m = Math.floor(Math.max(0, secs) / 60);
  const s = Math.max(0, secs) % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function totalDuration(steps: Step[]): number {
  return steps.reduce((sum, s) => sum + s.duration, 0);
}
