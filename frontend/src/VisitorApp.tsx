import { useEffect, useState } from 'react';
import { api, type UserDTO } from './api';
import { BrandMark } from './components/BrandMark';
import { MaricaGradient } from './components/MaricaGradient';
import { CitizenView } from './pages/CitizenView';
import { getPhantom } from './phantom';

/** Visitor app: brand, greeting, logout and the wallet. No tabs, no operator surface. */
export function VisitorApp({ onLogout }: { onLogout: () => void }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api.me().then(
      (m) => (m.role === 'visitor' ? setUser(m.user) : setFailed(true)),
      () => setFailed(true),
    );
  }, []);

  async function logout() {
    try {
      await api.logout();
      await getPhantom()?.disconnect?.();
    } catch {
      /* best effort: leave the session either way */
    } finally {
      onLogout();
    }
  }

  return (
    <div className="app visitor-app">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <div className="visitor-app__bg" aria-hidden="true">
        <MaricaGradient />
      </div>
      <header className="topbar">
        <div className="topbar__inner">
          <span className="brand">
            <BrandMark size={32} wordmark />
          </span>
          {user && <span className="muted">Olá, {user.displayName}</span>}
          <button type="button" className="button button--ghost button--sm" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="content" tabIndex={-1}>
        {user ? (
          <CitizenView visitor={user} />
        ) : failed ? (
          <p className="alert alert--danger" role="alert">
            Não foi possível carregar sua carteira. Recarregue a página.
          </p>
        ) : (
          <p className="muted" role="status">Carregando…</p>
        )}
      </main>
    </div>
  );
}
