import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedListener, type Role } from './api';
import { BrandMark } from './components/BrandMark';
import { CitizenView } from './pages/CitizenView';
import { Entry } from './pages/Entry';
import { OperatorView } from './pages/OperatorView';
import { VisitorApp } from './VisitorApp';

type View = 'carteira' | 'operador';

function viewFromHash(): View {
  return window.location.hash === '#/operador' ? 'operador' : 'carteira';
}

export function App() {
  const [auth, setAuth] = useState<'checking' | 'out' | Role>('checking');
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    setUnauthorizedListener(() => setAuth('out'));
    api.session().then(
      (s) => setAuth(s.authenticated && s.role ? s.role : 'out'),
      () => setAuth('out'),
    );
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      setUnauthorizedListener(null);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  const refreshSession = useCallback(() => {
    api.session().then(
      (s) => setAuth(s.authenticated && s.role ? s.role : 'out'),
      () => setAuth('out'),
    );
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setAuth('out');
    }
  }, []);

  if (auth === 'checking') {
    return (
      <div className="splash" role="status">
        <BrandMark size={48} />
        <span className="sr-only">Carregando</span>
      </div>
    );
  }
  if (auth === 'out') return <Entry onSignedIn={refreshSession} />;
  if (auth === 'visitor') return <VisitorApp onLogout={() => setAuth('out')} />;

  return (
    <div className="app">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <a className="brand" href="#/carteira" aria-label="Mumbuca+, início">
            <BrandMark size={32} wordmark />
          </a>
          <nav className="tabs" aria-label="Seções">
            <a className="tabs__item" href="#/carteira" aria-current={view === 'carteira' ? 'page' : undefined}>
              Minha carteira
            </a>
            <a className="tabs__item" href="#/operador" aria-current={view === 'operador' ? 'page' : undefined}>
              Operador
            </a>
          </nav>
          <button type="button" className="button button--ghost button--sm" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className={`content${view === 'operador' ? ' content--wide' : ''}`} tabIndex={-1}>
        {view === 'operador' ? <OperatorView /> : <CitizenView />}
      </main>
      <footer className="footer muted small">Mumbuca+ · moeda social de Maricá · 1 Mum+ = R$ 1,00 · rede Solana</footer>
    </div>
  );
}
