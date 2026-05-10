let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = Ctor ? new Ctor() : null;
  }
  return ctx;
}

/** Bip à deux notes (signal de fin d'étape) */
export function playBeep(): void {
  const audio = getCtx();
  if (!audio) return;
  try {
    [880, 1175].forEach((freq, i) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = audio.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // ignore
  }
}
