import type { CSSProperties } from 'react';

interface Step {
  duration: number; // en secondes
}

interface Props {
  steps: Step[];
  /** Pourcentage de remplissage (0..100) */
  fillPercent: number;
}

/**
 * Barre de progression jalonnée d'un point par frontière d'étape.
 * Les ticks sont placés en pourcentage selon la durée cumulée.
 */
export function ProgressBar({ steps, fillPercent }: Props): JSX.Element {
  const total = steps.reduce((s, x) => s + x.duration, 0);
  const ticks: number[] = [];
  if (total > 0 && steps.length > 1) {
    let acc = 0;
    // Frontières internes uniquement (pas 0% ni 100%)
    for (let i = 0; i < steps.length - 1; i++) {
      acc += steps[i].duration;
      ticks.push((acc / total) * 100);
    }
  }
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ width: `${fillPercent}%` }} />
      {ticks.map((t, i) => {
        const passed = fillPercent >= t;
        const style: CSSProperties = { left: `${t}%` };
        return (
          <span
            key={i}
            className={`progress-tick ${passed ? 'passed' : ''}`}
            style={style}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}
