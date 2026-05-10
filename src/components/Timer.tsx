import type { Sequence } from '../types';
import type { UseTimerResult } from '../hooks/useTimer';
import { formatTime, totalDuration } from '../lib/time';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';

interface Props {
  sequence: Sequence | null;
  timer: UseTimerResult;
}

export function Timer({ sequence, timer }: Props): JSX.Element {
  const hasSteps = !!sequence && sequence.steps.length > 0;
  const current = hasSteps ? sequence.steps[timer.currentIndex] : null;

  return (
    <section className="pane pane-timer">
      <div className="timer-stage">
        {hasSteps && current ? (
          <Stage sequence={sequence} timer={timer} />
        ) : (
          <div className="empty">
            <Icon name="clock" size={26} className="empty-icon" />
            <div className="empty-title">Prêt à démarrer</div>
            <div className="empty-desc">
              Ajoute des étapes à ta séquence pour lancer le minuteur.
            </div>
          </div>
        )}
      </div>
      <div className="timer-controls">
        <button
          className="btn icon lg"
          onClick={timer.prev}
          disabled={!hasSteps || timer.currentIndex === 0}
          title="Précédent (←)"
          aria-label="Précédent"
        >
          <Icon name="skip-back" size={20} />
        </button>
        <button
          className="btn icon xl"
          onClick={timer.toggle}
          disabled={!hasSteps}
          title="Lecture/Pause (Espace)"
          aria-label={timer.running ? 'Pause' : 'Lecture'}
        >
          <Icon name={timer.running ? 'pause' : 'play'} size={26} />
        </button>
        <button
          className="btn icon lg"
          onClick={timer.next}
          disabled={!hasSteps || timer.currentIndex >= (sequence?.steps.length ?? 0) - 1}
          title="Suivant (→)"
          aria-label="Suivant"
        >
          <Icon name="skip-forward" size={20} />
        </button>
        <button
          className="btn icon lg"
          onClick={timer.reset}
          disabled={!hasSteps}
          title="Reset (R)"
          aria-label="Reset"
        >
          <Icon name="rotate" size={20} />
        </button>
      </div>
    </section>
  );
}

function Stage({ sequence, timer }: { sequence: Sequence; timer: UseTimerResult }): JSX.Element {
  const current = sequence.steps[timer.currentIndex];
  const displayTime = timer.remaining > 0 ? timer.remaining : current.duration;
  const ratio = displayTime / current.duration;

  let elapsedGlobal = 0;
  for (let i = 0; i < timer.currentIndex; i++) elapsedGlobal += sequence.steps[i].duration;
  elapsedGlobal += current.duration - displayTime;
  const total = totalDuration(sequence.steps);
  const globalRatio = total > 0 ? (elapsedGlobal / total) * 100 : 0;

  let timeClass = '';
  if ((timer.running || timer.remaining > 0) && timer.remaining > 0) {
    if (ratio < 0.15) timeClass = 'danger';
    else if (ratio < 0.4) timeClass = 'warning';
  }

  return (
    <>
      <div className="step-label">
        Étape {timer.currentIndex + 1} / {sequence.steps.length}
      </div>
      <div className="step-name-big">{current.name}</div>
      <div className={`time-big ${timeClass}`}>{formatTime(displayTime)}</div>
      <ProgressBar steps={sequence.steps} fillPercent={globalRatio} />
      <div className="global-info">
        <span>{formatTime(elapsedGlobal)} écoulées</span>
        <span className="sep" />
        <span>{formatTime(total - elapsedGlobal)} restantes</span>
        <span className="sep" />
        <span>{formatTime(total)} total</span>
      </div>
    </>
  );
}
