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
          <BrandMark size={48} />
          <h1>Mumbuca+</h1>
          <p className="muted">A moeda social de Maricá, agora na sua carteira digital.</p>
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
          <button type="submit" className="button button--primary button--block" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
      <p className="login__footer muted small">Mum+ é emitido na rede Solana, 1 Mum+ = R$ 1,00.</p>
    </main>
  );
}
