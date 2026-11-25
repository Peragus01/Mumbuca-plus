import { useEffect, useState } from 'react';
import { api } from './api';
import { BrandMark } from './components/BrandMark';

/** Minimal visitor shell. Task 8 replaces the body with the real wallet. */
export function VisitorApp({ onLogout }: { onLogout: () => void }) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    api.me().then(
      (m) => setName(m.role === 'visitor' ? m.user.displayName : null),
      () => setName(null),
    );
  }, []);

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__inner">
          <span className="brand">
            <BrandMark size={32} wordmark />
          </span>
          {name && <span className="muted">Olá, {name}</span>}
          <button type="button" className="button button--ghost button--sm" onClick={logout}>
            Sair
          </button>
        </div>
      </header>
      <main id="conteudo" className="content" tabIndex={-1}>
        <p>Sua carteira</p>
      </main>
    </div>
  );
}
