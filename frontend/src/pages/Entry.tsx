import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, api } from '../api';
import { BrandMark } from '../components/BrandMark';
import AnimatedGradient from '../components/spell/animated-gradient';
import { PopButton } from '../components/spell/pop-button';
import { connectAndSign, getPhantom, isUserRejection } from '../phantom';
import { CreateAccount } from './CreateAccount';

type Stage = { name: 'home' } | { name: 'nophantom' } | { name: 'create'; wallet: string };

const GRADIENT = { preset: 'custom', color1: '#06150f', color2: '#3dffa8', color3: '#ffd23f' } as const;

export function EntryShell({ soft, children }: { soft?: boolean; children: ReactNode }) {
  return (
    <main className="entry">
      <div className={`entry__bg${soft ? ' entry__bg--soft' : ''}`} aria-hidden="true">
        <AnimatedGradient config={GRADIENT} />
      </div>
      {soft && <div className="entry__veil" aria-hidden="true" />}
      <div className="entry__body">{children}</div>
    </main>
  );
}

function phantomErrorMessage(err: unknown): string {
  if (isUserRejection(err)) return 'Você cancelou na Phantom. Tente de novo quando quiser.';
  if (err instanceof ApiError && err.code === 'signin_disabled') return 'O acesso de visitantes está pausado no momento.';
  return 'Não conseguimos entrar agora. Tente de novo.';
}

export function Entry({ onSignedIn }: { onSignedIn: () => void }) {
  const pwId = useId();
  const errId = useId();
  const [stage, setStage] = useState<Stage>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [operator, setOperator] = useState(false);
  const [password, setPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  async function enterWithPhantom() {
    setError(null);
    if (!getPhantom()) {
      setStage({ name: 'nophantom' });
      return;
    }
    setBusy(true);
    try {
      let nonce = '';
      const { wallet, signatureB58 } = await connectAndSign(async (w) => {
        const c = await api.phantomChallenge(w);
        nonce = c.nonce;
        return c.message;
      });
      const res = await api.phantomVerify({ walletAddress: wallet, nonce, signature: signatureB58 });
      if (res.status === 'needs_signup') setStage({ name: 'create', wallet });
      else onSignedIn();
    } catch (err) {
      setError(phantomErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (!password) {
      setPwError('Informe a senha de acesso.');
      return;
    }
    setPwBusy(true);
    setPwError(null);
    try {
      await api.login(password);
      onSignedIn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setPwError('Senha incorreta.');
      else if (err instanceof ApiError && err.status === 429) setPwError('Muitas tentativas. Aguarde um minuto e tente de novo.');
      else setPwError('Não foi possível entrar agora. Tente novamente.');
    } finally {
      setPwBusy(false);
    }
  }

  if (stage.name === 'create') {
    return (
      <CreateAccount
        wallet={stage.wallet}
        onSignedIn={onSignedIn}
        onExpired={() => {
          setStage({ name: 'home' });
          setError('Sua sessão expirou, entre de novo.');
        }}
      />
    );
  }

  if (stage.name === 'nophantom') {
    return (
      <EntryShell soft>
        <div className="entry__card">
          <h1 className="entry__title">
            Falta só <em>a Phantom</em>
          </h1>
          <ol className="entry__steps">
            <li>1. Instale a carteira Phantom</li>
            <li>2. Em Configurações, ative a rede de testes (Devnet)</li>
            <li>3. Volte aqui e toque em Entrar</li>
          </ol>
          <PopButton color="marica" className="no-underline" asChild>
            <a href="https://phantom.app/download" target="_blank" rel="noopener noreferrer">
              Instalar Phantom ↗
            </a>
          </PopButton>
          <PopButton color="default" onClick={() => setStage({ name: 'home' })}>
            Voltar
          </PopButton>
          <p className="entry__note muted small">No celular, abra este site pelo navegador da Phantom.</p>
        </div>
      </EntryShell>
    );
  }

  return (
    <EntryShell>
      <div className="entry__card">
        <BrandMark size={44} wordmark />
        <h1 className="entry__title">
          Gaste em Maricá <em>com vantagens</em>
        </h1>
        <p className="entry__lead">Compre Mum+ e ganhe descontos em restaurantes, hospedagem, cultura e comércio local.</p>
        <PopButton color="marica" size="lg" onClick={enterWithPhantom} disabled={busy}>
          Entrar com Phantom
        </PopButton>
        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}
        <p className="entry__note muted small">Rede de testes Solana · nenhum dinheiro real é cobrado</p>
        {operator ? (
          <form className="stack entry__operator" onSubmit={submitPassword} noValidate>
            <div className="field">
              <label htmlFor={pwId}>Senha de acesso</label>
              <input
                id={pwId}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={pwError ? true : undefined}
                aria-describedby={pwError ? errId : undefined}
                autoFocus
              />
            </div>
            {pwError && (
              <p id={errId} className="alert alert--danger" role="alert">
                {pwError}
              </p>
            )}
            <PopButton color="default" type="submit" disabled={pwBusy}>
              {pwBusy ? 'Entrando…' : 'Entrar'}
            </PopButton>
          </form>
        ) : (
          <button type="button" className="entry__link" onClick={() => setOperator(true)}>
            Sou operador
          </button>
        )}
      </div>
    </EntryShell>
  );
}
