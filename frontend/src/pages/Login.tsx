import { useId, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { BrandMark } from '../components/BrandMark';

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const pwId = useId();
  const errId = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setError('Informe a senha de acesso.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Senha incorreta.');
      else if (err instanceof ApiError && err.status === 429) setError('Muitas tentativas. Aguarde um minuto e tente de novo.');
      else setError('Não foi possível entrar agora. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__brand">
          <h1 className="login__title">
            <BrandMark size={56} wordmark subtitle />
          </h1>
          <p className="muted">Entre para acessar sua carteira digital de Mum+.</p>
        </div>
        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={pwId}>Senha de acesso</label>
            <input
              id={pwId}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              autoFocus
            />
          </div>
          {error && (
            <p id={errId} className="alert alert--danger" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button btn-primary button--block button--lg" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
      <p className="login__footer muted small">
        <span className="chip chip-onchain">
          <span className="chip__dot" aria-hidden="true" />
          on-chain · Solana
        </span>
        <span>Mum+ é emitido na rede Solana, 1 Mum+ = R$ 1,00.</span>
      </p>
    </main>
  );
}
