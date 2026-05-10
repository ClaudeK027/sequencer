import { useCallback, useEffect, useRef, useState } from 'react';
import type { Sequence } from '../types';
import { playBeep } from '../lib/audio';

export interface TimerState {
  currentIndex: number;
  remaining: number;
  running: boolean;
  finished: boolean;
}

export interface UseTimerResult extends TimerState {
  start: () => void;
  pause: () => void;
  toggle: () => void;
  reset: () => void;
  next: () => void;
  prev: () => void;
}

interface Options {
  sequence: Sequence | null;
  soundEnabled: boolean;
  onFinish?: () => void;
}

/**
 * Gère le minuteur séquentiel : interval, currentIndex, enchaînement
 * automatique des étapes avec bip de transition.
 */
export function useTimer({ sequence, soundEnabled, onFinish }: Options): UseTimerResult {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const intervalRef = useRef<number | null>(null);
  // Refs pour accéder aux dernières valeurs depuis le tick (évite la stale closure)
  const sequenceRef = useRef(sequence);
  const indexRef = useRef(currentIndex);
  const soundRef = useRef(soundEnabled);
  const onFinishRef = useRef(onFinish);

  useEffect(() => { sequenceRef.current = sequence; }, [sequence]);
  useEffect(() => { indexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { soundRef.current = soundEnabled; }, [soundEnabled]);
  useEffect(() => { onFinishRef.current = onFinish; }, [onFinish]);

  const clearTick = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Reset auto quand la séquence active change
  useEffect(() => {
    clearTick();
    setRunning(false);
    setCurrentIndex(0);
    setRemaining(0);
    setFinished(false);
  }, [sequence?.id, clearTick]);

  const tick = useCallback(() => {
    setRemaining((prev) => {
      const next = prev - 1;
      if (next > 0) return next;

      // Étape terminée : on bipe et on enchaîne
      if (soundRef.current) playBeep();
      const seq = sequenceRef.current;
      const idx = indexRef.current;
      if (seq && idx < seq.steps.length - 1) {
        const newIdx = idx + 1;
        setCurrentIndex(newIdx);
        return seq.steps[newIdx].duration;
      }
      // Plus d'étape : fin de séquence
      clearTick();
      setRunning(false);
      setFinished(true);
      onFinishRef.current?.();
      return 0;
    });
  }, [clearTick]);

  const start = useCallback(() => {
    const seq = sequenceRef.current;
    if (!seq || seq.steps.length === 0) return;
    if (intervalRef.current !== null) return;
    setFinished(false);
    setRemaining((r) => (r > 0 ? r : seq.steps[indexRef.current].duration));
    setRunning(true);
    intervalRef.current = window.setInterval(tick, 1000);
  }, [tick]);

  const pause = useCallback(() => {
    clearTick();
    setRunning(false);
  }, [clearTick]);

  const toggle = useCallback(() => {
    if (running) pause();
    else start();
  }, [running, pause, start]);

  const reset = useCallback(() => {
    clearTick();
    setRunning(false);
    setCurrentIndex(0);
    setRemaining(0);
    setFinished(false);
  }, [clearTick]);

  const next = useCallback(() => {
    const seq = sequenceRef.current;
    if (!seq || seq.steps.length === 0) return;
    const wasRunning = running;
    clearTick();
    setRunning(false);
    if (indexRef.current < seq.steps.length - 1) {
      const newIdx = indexRef.current + 1;
      setCurrentIndex(newIdx);
      setRemaining(seq.steps[newIdx].duration);
      if (wasRunning) {
        setRunning(true);
        intervalRef.current = window.setInterval(tick, 1000);
      }
    } else {
      setRemaining(0);
      setFinished(true);
      onFinishRef.current?.();
    }
  }, [running, clearTick, tick]);

  const prev = useCallback(() => {
    const seq = sequenceRef.current;
    if (!seq || seq.steps.length === 0) return;
    const wasRunning = running;
    clearTick();
    setRunning(false);
    const newIdx = Math.max(0, indexRef.current - 1);
    setCurrentIndex(newIdx);
    setRemaining(seq.steps[newIdx].duration);
    setFinished(false);
    if (wasRunning) {
      setRunning(true);
      intervalRef.current = window.setInterval(tick, 1000);
    }
  }, [running, clearTick, tick]);

  // Cleanup au démontage
  useEffect(() => () => clearTick(), [clearTick]);

  return { currentIndex, remaining, running, finished, start, pause, toggle, reset, next, prev };
}
