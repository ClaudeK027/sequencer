import { useCallback, useEffect, useState } from 'react';
import { useActiveSequence, useStore } from './store';
import { useTimer } from './hooks/useTimer';
import { useRoute } from './hooks/useRoute';
import { useSequencesSync } from './hooks/useSequencesSync';
import { TopBar } from './components/TopBar';
import { Library } from './components/Library';
import { Editor } from './components/Editor';
import { Timer } from './components/Timer';
import { MobileNav, type MobileTab } from './components/MobileNav';
import { ToastProvider, useToast } from './components/Toast';
import { GoLiveModal } from './components/GoLiveModal';
import { LiveListPage } from './components/LiveListPage';
import { LiveSessionPage } from './components/LiveSessionPage';
import './App.css';

function HomeScreen({ onGoLive }: { onGoLive: () => void }): JSX.Element {
  const active = useActiveSequence();
  const activeId = useStore((s) => s.activeId);
  const soundEnabled = useStore((s) => s.soundEnabled);
  const toast = useToast();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('timer');

  const onFinish = useCallback(() => toast.show('Séquence terminée'), [toast]);
  const timer = useTimer({ sequence: active, soundEnabled, onFinish });

  useEffect(() => {
    if (mobileTab === 'library') setMobileTab('editor');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((v) => !v);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onFs = (): void => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.matches('input, textarea, select')) return;
      if (e.code === 'Space') { e.preventDefault(); timer.toggle(); }
      else if (e.code === 'ArrowRight') timer.next();
      else if (e.code === 'ArrowLeft') timer.prev();
      else if (e.key === 'r' || e.key === 'R') timer.reset();
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [timer, toggleFullscreen]);

  useEffect(() => {
    document.body.classList.toggle('fullscreen', isFullscreen);
  }, [isFullscreen]);

  useEffect(() => {
    document.body.dataset.mobileTab = mobileTab;
    return () => { delete document.body.dataset.mobileTab; };
  }, [mobileTab]);

  return (
    <div className="app">
      <TopBar onToggleFullscreen={toggleFullscreen} onGoLive={onGoLive} />
      <div className="main">
        <Library />
        {active ? (
          <Editor
            sequence={active}
            currentIndex={timer.currentIndex}
            running={timer.running}
            remaining={timer.remaining}
          />
        ) : (
          <section className="pane pane-editor" />
        )}
        <Timer sequence={active} timer={timer} />
      </div>
      <MobileNav active={mobileTab} onChange={setMobileTab} />
    </div>
  );
}

function AppInner(): JSX.Element {
  const { route, navigate } = useRoute();
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const error = useStore((s) => s.error);

  // Sync séquences ↔ Supabase (fetch initial + Realtime)
  useSequencesSync();

  // Banner d'erreur Supabase
  useEffect(() => {
    if (error) console.error('[Supabase]', error);
  }, [error]);

  // Reset le data-mobile-tab quand on quitte la home
  useEffect(() => {
    if (route.name !== 'home') {
      delete document.body.dataset.mobileTab;
      document.body.classList.remove('fullscreen');
    }
  }, [route.name]);

  if (route.name === 'live-list') {
    return <LiveListPage />;
  }
  if (route.name === 'live-session' && route.sessionId) {
    return <LiveSessionPage sessionId={route.sessionId} />;
  }

  return (
    <>
      {error && (
        <div className="error-banner">
          ⚠ Connexion Supabase impossible : {error}
        </div>
      )}
      <HomeScreen onGoLive={() => setGoLiveOpen(true)} />
      <GoLiveModal
        open={goLiveOpen}
        onClose={() => setGoLiveOpen(false)}
        onCreated={(id) => navigate(`/live/${id}`)}
      />
    </>
  );
}

export default function App(): JSX.Element {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
