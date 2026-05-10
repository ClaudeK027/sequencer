import { useCallback, useEffect, useState } from 'react';

export interface ParsedRoute {
  /** 'home' | 'live-list' | 'live-session' */
  name: 'home' | 'live-list' | 'live-session';
  /** Pour 'live-session' : l'ID de la session */
  sessionId?: string;
}

function parse(pathname: string): ParsedRoute {
  if (pathname === '/' || pathname === '') return { name: 'home' };
  const live = pathname.match(/^\/live\/?$/);
  if (live) return { name: 'live-list' };
  const session = pathname.match(/^\/live\/([^/]+)\/?$/);
  if (session) return { name: 'live-session', sessionId: session[1] };
  return { name: 'home' };
}

export function useRoute(): {
  route: ParsedRoute;
  navigate: (to: string) => void;
  /** Va à la page précédente du navigateur. Si l'historique est vide
   *  (utilisateur arrivé directement via deep link), va à `fallback`. */
  goBack: (fallback: string) => void;
} {
  const [route, setRoute] = useState<ParsedRoute>(() => parse(window.location.pathname));

  useEffect(() => {
    const onPop = (): void => setRoute(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    // Marqueur pour savoir si on a navigué dans l'app (utile pour goBack)
    sessionStorage.setItem('app-navigated', '1');
    // Dispatch popstate pour que TOUTES les instances de useRoute se mettent
    // à jour (sinon l'instance qui appelle navigate est seule au courant).
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const goBack = useCallback((fallback: string) => {
    // Si on a navigué au moins une fois dans l'app, le back ramène à l'état
    // précédent (URL + popstate restaure les state hooks).
    if (sessionStorage.getItem('app-navigated')) {
      window.history.back();
    } else {
      navigate(fallback);
    }
  }, [navigate]);

  return { route, navigate, goBack };
}
