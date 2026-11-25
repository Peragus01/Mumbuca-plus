import { useId, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { PopButton } from '../components/spell/pop-button';
import { EntryShell } from './Entry';

export function shortWallet(w: string): string {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w;
}

export function CreateAccount({
  wallet,
  onSignedIn,
  onExpired,
}: {
  wallet: string;
  onSignedIn: () => void;
  onExpired: () => void;
}) {
  const nameId = useId();
  const errId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.signup(name.trim());
      onSignedIn();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      if (code === 'signup_expired') {
        onExpired();
        return;
      }
      if (code === 'invalid_display_name') setError('Use de 2 a 40 caracteres.');
      else if (code === 'signin_disabled') setError('O acesso de visitantes está pausado no momento.');
      else if (code === 'rate_limited') setError('Muitas tentativas. Tente mais tarde.');
      else setError('Não conseguimos entrar agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <EntryShell soft>
      <form className="entry__card" onSubmit={submit} noValidate>
        <h1 className="entry__title">
          Bem-vindo! <em>Vamos criar sua conta</em>
        </h1>
        <div className="entry__wallet">
          <span className="muted small">Sua carteira</span>
          <strong>{shortWallet(wallet)}</strong>
          <span className="entry__ok small">✓ conectada</span>
        </div>
        <div className="field">
          <label htmlFor={nameId}>Como quer ser chamado?</label>
          <input
            id={nameId}
            type="text"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
        <PopButton color="marica" size="lg" type="submit" disabled={busy}>
          Criar conta
        </PopButton>
      </form>
    </EntryShell>
  );
}
