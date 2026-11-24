import { useCallback, useEffect, useId, useState } from 'react';
import { api, type PaymentDTO, type UserDTO } from '../api';
import { CopyButton } from '../components/CopyButton';
import { RechargeDialog } from '../components/RechargeDialog';
import { StatusBadge } from '../components/StatusBadge';
import { formatBRL, formatDateTime, formatMum, isTerminal, shortAddress } from '../format';
import { storage, useInterval } from '../hooks';

const SELECTED_KEY = 'mumbuca.citizen.user';

type Balance = { state: 'loading' } | { state: 'ok'; units: string } | { state: 'error' };

export function CitizenView() {
  const selectId = useId();
  const [users, setUsers] = useState<UserDTO[] | null>(null);
  const [usersError, setUsersError] = useState(false);
  const [userId, setUserId] = useState<string | null>(() => storage.get(SELECTED_KEY));
  const [balance, setBalance] = useState<Balance>({ state: 'loading' });
  const [history, setHistory] = useState<PaymentDTO[] | null>(null);
  const [recharging, setRecharging] = useState(false);

  useEffect(() => {
    api
      .users()
      .then((list) => {
        setUsers(list);
        setUserId((current) => (current && list.some((u) => u.id === current) ? current : (list[0]?.id ?? null)));
      })
      .catch(() => setUsersError(true));
  }, []);

  const user = users?.find((u) => u.id === userId) ?? null;

  const refresh = useCallback(async (id: string) => {
    const [b, h] = await Promise.allSettled([api.balance(id), api.payments(id)]);
    setBalance(b.status === 'fulfilled' ? { state: 'ok', units: b.value.balanceUnits } : { state: 'error' });
    if (h.status === 'fulfilled') setHistory(h.value);
  }, []);

  useEffect(() => {
    if (!userId) return;
    storage.set(SELECTED_KEY, userId);
    setBalance({ state: 'loading' });
    setHistory(null);
    void refresh(userId);
  }, [userId, refresh]);

  // Keep pending recharges moving in the history while the dialog is closed.
  const hasOpen = history?.some((p) => !isTerminal(p.status)) ?? false;
  useInterval(() => userId && void refresh(userId), 5000, hasOpen && !recharging);

  if (usersError) {
    return <p className="alert alert--danger" role="alert">Não foi possível carregar as contas. Recarregue a página.</p>;
  }
  if (!users) return <p className="muted" role="status">Carregando…</p>;
  if (users.length === 0) {
    return (
      <section className="card empty">
        <h2>Nenhuma conta cadastrada</h2>
        <p className="muted">Peça ao operador para cadastrar sua carteira Solana para começar a usar Mum+.</p>
      </section>
    );
  }

  return (
    <div className="stack stack--lg">
      <div className="account-picker">
        <label htmlFor={selectId}>Conta</label>
        <select id={selectId} value={userId ?? ''} onChange={(e) => setUserId(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} (@{u.handle})
            </option>
          ))}
        </select>
      </div>

      {user && (
        <section className="balance-card" aria-labelledby="balance-title">
          <p className="balance-card__greeting">Olá, {user.displayName.split(' ')[0]}</p>
          <h2 id="balance-title" className="balance-card__label">
            Saldo disponível
          </h2>
          <p className="balance-card__value" aria-live="polite">
            {balance.state === 'ok' ? formatMum(balance.units) : balance.state === 'loading' ? '…' : 'Indisponível'}
          </p>
          {balance.state === 'error' && <p className="balance-card__note">Não conseguimos consultar a rede agora.</p>}
          <div className="balance-card__wallet">
            <span className="balance-card__wallet-label">Carteira Solana (Phantom)</span>
            <span className="balance-card__address">
              <code title={user.walletAddress}>{shortAddress(user.walletAddress)}</code>
              <CopyButton text={user.walletAddress} label="Copiar endereço" className="button button--on-brand button--sm" />
            </span>
          </div>
          <button type="button" className="button button--accent button--lg" onClick={() => setRecharging(true)}>
            Recarregar
          </button>
        </section>
      )}

      <section className="card" aria-labelledby="history-title">
        <h2 id="history-title" className="card__title">
          Histórico
        </h2>
        {history === null ? (
          <p className="muted" role="status">Carregando…</p>
        ) : history.length === 0 ? (
          <p className="muted">Nenhuma recarga ainda. Toque em Recarregar para fazer a primeira.</p>
        ) : (
          <ul className="history">
            {history.map((p) => (
              <li key={p.id} className="history__item">
                <div className="history__main">
                  <span className="history__title">Recarga via Pix</span>
                  <span className="history__date muted small">{formatDateTime(p.createdAt)}</span>
                </div>
                <div className="history__side">
                  <span className="history__amount">
                    {p.status === 'MINTED' && p.mintAmountUnits
                      ? `+ ${formatMum(p.mintAmountUnits)}`
                      : formatBRL(p.requestedAmountCents)}
                  </span>
                  <StatusBadge status={p.status} origin={p.origin} />
                  {p.explorerUrl && (
                    <a className="link small" href={p.explorerUrl} target="_blank" rel="noopener noreferrer">
                      ver na rede ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recharging && user && (
        <RechargeDialog
          userId={user.id}
          provider="ozav"
          onClose={() => {
            setRecharging(false);
            void refresh(user.id);
          }}
          onCompleted={() => void refresh(user.id)}
        />
      )}
    </div>
  );
}
