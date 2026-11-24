import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { ApiError, api, type OpsStatus, type PaymentDTO, type ProviderName, type UserDTO } from '../api';
import { CopyButton } from '../components/CopyButton';
import { RechargeDialog } from '../components/RechargeDialog';
import { OriginBadge, StatusBadge } from '../components/StatusBadge';
import { formatBRL, formatDateTime, formatMum, formatSol, isTerminal, shortAddress } from '../format';
import { useInterval } from '../hooks';

const CONFIG_ISSUE_TEXT: Record<string, string> = {
  minter_mismatch: 'config.minter não é a carteira emissora do servidor',
  max_mint_per_tx_below_max_recharge: 'max_mint_per_tx do programa é menor que a recarga máxima',
  program_paused: 'programa pausado',
};

type Ops = { state: 'loading' } | { state: 'ok'; data: OpsStatus } | { state: 'error' };

function OpsPanel({ ops }: { ops: Ops }) {
  if (ops.state === 'loading') return <p className="muted" role="status">Consultando a rede…</p>;
  if (ops.state === 'error') {
    return (
      <p className="alert alert--danger" role="alert">
        Rede Solana indisponível: não foi possível ler o estado do programa e da carteira emissora.
      </p>
    );
  }
  const o = ops.data;
  return (
    <div className="stack">
      {o.paused && (
        <p className="alert alert--danger" role="alert">
          <strong>Emissão pausada.</strong> O programa está pausado: nenhuma recarga será emitida até ser retomado.
        </p>
      )}
      {o.configOk === false && (
        <p className="alert alert--danger" role="alert">
          <strong>Configuração on-chain divergente.</strong> As emissões não vão acontecer até corrigir:{' '}
          {(o.configIssues ?? []).map((i) => CONFIG_ISSUE_TEXT[i] ?? i).join('; ')}. Pagamentos aprovados aguardam e
          serão emitidos depois da correção.
        </p>
      )}
      {o.lowSol && (
        <p className="alert alert--warning" role="alert">
          <strong>SOL baixo na carteira emissora.</strong> Saldo atual {formatSol(o.minterLamports)}. Abasteça para não
          interromper as emissões.
        </p>
      )}
      <dl className="stats">
        <div className="stat">
          <dt>Rede</dt>
          <dd>Solana {o.cluster}</dd>
        </div>
        <div className="stat">
          <dt>Provedor Pix</dt>
          <dd>OZAV {o.providerEnv}</dd>
        </div>
        <div className="stat">
          <dt>Programa</dt>
          <dd>
            <span className={`dot ${o.paused ? 'dot--danger' : 'dot--success'}`} aria-hidden="true" />
            {o.paused ? 'Pausado' : 'Ativo'}
          </dd>
        </div>
        <div className="stat">
          <dt>SOL da carteira emissora</dt>
          <dd className={o.lowSol ? 'text-warning' : undefined}>{formatSol(o.minterLamports)}</dd>
        </div>
        <div className="stat">
          <dt>ID do programa</dt>
          <dd className="mono">
            <span title={o.programId}>{shortAddress(o.programId)}</span>
            <CopyButton text={o.programId} label="Copiar" className="button button--ghost button--xs" />
          </dd>
        </div>
        <div className="stat">
          <dt>Mint Mum+</dt>
          <dd className="mono">
            <span title={o.mintAddress}>{shortAddress(o.mintAddress)}</span>
            <CopyButton text={o.mintAddress} label="Copiar" className="button button--ghost button--xs" />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function NewUserForm({ onCreated }: { onCreated: (u: UserDTO) => void }) {
  const ids = { name: useId(), handle: useId(), wallet: useId() };
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!displayName.trim() || !handle.trim() || !walletAddress.trim()) {
      setMsg({ kind: 'error', text: 'Preencha nome, apelido e endereço da carteira.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const u = await api.createUser({
        displayName: displayName.trim(),
        handle: handle.trim().replace(/^@/, ''),
        walletAddress: walletAddress.trim(),
      });
      setDisplayName('');
      setHandle('');
      setWalletAddress('');
      setMsg({ kind: 'ok', text: `${u.displayName} cadastrado(a).` });
      onCreated(u);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      setMsg({
        kind: 'error',
        text:
          code === 'invalid_wallet_address'
            ? 'Endereço Solana inválido.'
            : code === 'duplicate_user'
              ? 'Já existe um usuário com esse apelido ou carteira.'
              : 'Não foi possível cadastrar agora.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="grid-2">
        <div className="field">
          <label htmlFor={ids.name}>Nome</label>
          <input id={ids.name} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={120} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor={ids.handle}>Apelido</label>
          <input id={ids.handle} value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={64} autoComplete="off" placeholder="maria" />
        </div>
      </div>
      <div className="field">
        <label htmlFor={ids.wallet}>Endereço da carteira Solana (Phantom)</label>
        <input
          id={ids.wallet}
          className="mono"
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {msg && (
        <p className={`alert ${msg.kind === 'ok' ? 'alert--success' : 'alert--danger'}`} role={msg.kind === 'ok' ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Cadastrando…' : 'Cadastrar usuário'}
        </button>
      </div>
    </form>
  );
}

function Flags({ p }: { p: PaymentDTO }) {
  if (!p.amountMismatch && !p.needsReview) return null;
  return (
    <span className="flags">
      {p.amountMismatch && (
        <span className="flag flag--warning" title="Valor recebido diferente do solicitado">
          <span aria-hidden="true">≠</span>
          <span className="sr-only">Valor recebido diferente do solicitado</span>
        </span>
      )}
      {p.needsReview && (
        <span className="flag flag--danger" title="Requer revisão manual">
          <span aria-hidden="true">!</span>
          <span className="sr-only">Requer revisão manual</span>
        </span>
      )}
    </span>
  );
}

export function OperatorView() {
  const ids = { user: useId(), provider: useId() };
  const [ops, setOps] = useState<Ops>({ state: 'loading' });
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [payments, setPayments] = useState<PaymentDTO[] | null>(null);
  const [paymentsError, setPaymentsError] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [rechargeUser, setRechargeUser] = useState('');
  const [rechargeProvider, setRechargeProvider] = useState<ProviderName>('simulated');
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadOps = useCallback(() => {
    api.opsStatus().then(
      (data) => setOps({ state: 'ok', data }),
      () => setOps({ state: 'error' }),
    );
  }, []);
  const loadPayments = useCallback(() => {
    api.payments().then(
      (list) => {
        setPayments(list);
        setPaymentsError(false);
      },
      () => setPaymentsError(true),
    );
  }, []);
  const loadUsers = useCallback(() => {
    api.users().then(
      (list) => {
        setUsers(list);
        setRechargeUser((cur) => (cur && list.some((u) => u.id === cur) ? cur : (list[0]?.id ?? '')));
      },
      () => undefined,
    );
  }, []);

  useEffect(() => {
    loadOps();
    loadPayments();
    loadUsers();
  }, [loadOps, loadPayments, loadUsers]);

  useInterval(loadPayments, 5000, !dialogOpen);
  useInterval(loadOps, 30000);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  async function act(p: PaymentDTO, kind: 'simulate' | 'reprocess') {
    setBusy((b) => ({ ...b, [p.id]: true }));
    setActionError(null);
    try {
      const updated = await (kind === 'simulate' ? api.simulate(p.id) : api.reprocess(p.id));
      setPayments((list) => list?.map((x) => (x.id === updated.id ? updated : x)) ?? list);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'erro';
      setActionError(`Falha ao ${kind === 'simulate' ? 'simular pagamento' : 'reprocessar'} (${code}).`);
    } finally {
      setBusy((b) => ({ ...b, [p.id]: false }));
      setTimeout(loadPayments, 1500);
    }
  }

  return (
    <div className="stack stack--lg">
      <section className="card" aria-labelledby="ops-title">
        <div className="card__head">
          <h2 id="ops-title" className="card__title">
            Operação
          </h2>
          <button type="button" className="btn-secondary button--sm" onClick={loadOps}>
            Atualizar
          </button>
        </div>
        <OpsPanel ops={ops} />
      </section>

      <section className="card" aria-labelledby="recharge-title">
        <h2 id="recharge-title" className="card__title">
          Nova recarga
        </h2>
        {users.length === 0 ? (
          <p className="muted">Cadastre um usuário abaixo para criar recargas.</p>
        ) : (
          <div className="toolbar">
            <div className="field">
              <label htmlFor={ids.user}>Usuário</label>
              <select id={ids.user} value={rechargeUser} onChange={(e) => setRechargeUser(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} (@{u.handle})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.provider}>Provedor</label>
              <select
                id={ids.provider}
                value={rechargeProvider}
                onChange={(e) => setRechargeProvider(e.target.value as ProviderName)}
              >
                <option value="ozav">OZAV (Pix)</option>
                <option value="simulated">Simulado</option>
              </select>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={!rechargeUser}
              onClick={() => setDialogOpen(true)}
            >
              Criar recarga
            </button>
          </div>
        )}
      </section>

      <section className="card card--flush" aria-labelledby="payments-title">
        <div className="card__head card__head--padded">
          <h2 id="payments-title" className="card__title">
            Pagamentos
          </h2>
          <button type="button" className="btn-secondary button--sm" onClick={loadPayments}>
            Atualizar
          </button>
        </div>
        {actionError && (
          <p className="alert alert--danger inset" role="alert">
            {actionError}
          </p>
        )}
        {paymentsError && (
          <p className="alert alert--danger inset" role="alert">
            Não foi possível carregar os pagamentos.
          </p>
        )}
        {payments === null ? (
          <p className="muted inset" role="status">Carregando…</p>
        ) : payments.length === 0 ? (
          <p className="muted inset">Nenhum pagamento ainda.</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Tabela de pagamentos">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Data</th>
                  <th scope="col">Usuário</th>
                  <th scope="col">Origem</th>
                  <th scope="col" className="num">Solicitado</th>
                  <th scope="col" className="num">Recebido</th>
                  <th scope="col" className="num">Mum+ emitidos</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Assinatura</th>
                  <th scope="col">Detalhe</th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const u = userById.get(p.userId);
                  const canSimulate =
                    p.status === 'AWAITING_PAYMENT' && (p.origin === 'OZAV sandbox' || p.origin === 'SIMULADO');
                  const canReprocess = !isTerminal(p.status);
                  return (
                    <tr key={p.id}>
                      <td className="nowrap">{formatDateTime(p.createdAt)}</td>
                      <td>{u ? u.displayName : <span className="mono">{p.userId.slice(0, 8)}</span>}</td>
                      <td>
                        <OriginBadge origin={p.origin} />
                      </td>
                      <td className="num">{formatBRL(p.requestedAmountCents)}</td>
                      <td className="num">{p.receivedAmountCents ? formatBRL(p.receivedAmountCents) : '—'}</td>
                      <td className="num">{p.mintAmountUnits ? formatMum(p.mintAmountUnits) : '—'}</td>
                      <td>
                        <span className="cell-status">
                          <StatusBadge status={p.status} />
                          <Flags p={p} />
                        </span>
                      </td>
                      <td className="mono">
                        {p.txSignature && p.explorerUrl ? (
                          <a className="link" href={p.explorerUrl} target="_blank" rel="noopener noreferrer" title={p.txSignature}>
                            {shortAddress(p.txSignature)} ↗
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mono small">
                        {p.failureReason || p.lastError ? (
                          <span className="codes">
                            {p.failureReason && <span className="code-chip code-chip--danger">{p.failureReason}</span>}
                            {p.lastError && p.lastError !== p.failureReason && <span className="code-chip">{p.lastError}</span>}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="actions-cell">
                        <div className="actions-cell__inner">
                        {canSimulate && (
                          <button
                            type="button"
                            className="btn-primary button--xs"
                            disabled={busy[p.id]}
                            onClick={() => act(p, 'simulate')}
                          >
                            Simular pagamento
                          </button>
                        )}
                        {canReprocess && (
                          <button
                            type="button"
                            className="btn-secondary button--xs"
                            disabled={busy[p.id]}
                            onClick={() => act(p, 'reprocess')}
                          >
                            Reprocessar
                          </button>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="users-title">
        <h2 id="users-title" className="card__title">
          Cadastrar usuário
        </h2>
        <NewUserForm
          onCreated={(u) => {
            setUsers((list) => [...list, u]);
            setRechargeUser(u.id);
          }}
        />
        {users.length > 0 && (
          <ul className="user-list">
            {users.map((u) => (
              <li key={u.id}>
                <span>
                  <strong>{u.displayName}</strong> <span className="muted">@{u.handle}</span>
                </span>
                <span className="mono small" title={u.walletAddress}>
                  {shortAddress(u.walletAddress)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialogOpen && rechargeUser && (
        <RechargeDialog
          userId={rechargeUser}
          provider={rechargeProvider}
          allowSimulate
          title="Recarregar Mum+"
          onClose={() => {
            setDialogOpen(false);
            loadPayments();
          }}
          onCompleted={loadPayments}
        />
      )}
    </div>
  );
}
