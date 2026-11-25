import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api, type PaymentDTO, type UserDTO } from '../api';
import { BenefitsSection } from '../components/BenefitsSection';
import { CopyButton } from '../components/CopyButton';
import { RechargeDialog } from '../components/RechargeDialog';
import { StatusBadge } from '../components/StatusBadge';
import { formatBRL, formatDateTime, formatMum, isTerminal, shortAddress } from '../format';
import { storage, useInterval } from '../hooks';
import { PopButton } from '../components/spell/pop-button';

const SELECTED_KEY = 'mumbuca.citizen.user';

type Balance = { state: 'loading' } | { state: 'ok'; units: string } | { state: 'error' };

export function CitizenView({ visitor }: { visitor?: UserDTO } = {}) {
  const selectId = useId();
  const [users, setUsers] = useState<UserDTO[] | null>(visitor ? [visitor] : null);
  const [usersError, setUsersError] = useState(false);
  const [userId, setUserId] = useState<string | null>(() => (visitor ? visitor.id : storage.get(SELECTED_KEY)));
  const [balance, setBalance] = useState<Balance>({ state: 'loading' });
  const [history, setHistory] = useState<PaymentDTO[] | null>(null);
  const [recharging, setRecharging] = useState(false);
  const [purchasesOpen, setPurchasesOpen] = useState(true);

  useEffect(() => {
    if (!visitor) return;
    let cancelled = false;
    api.publicStatus().then(
      (s) => !cancelled && setPurchasesOpen(s.visitorPurchasesOpen),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [visitor]);

  useEffect(() => {
    if (visitor) return;
    api
      .users()
      .then((list) => {
        setUsers(list);
        setUserId((current) => (current && list.some((u) => u.id === current) ? current : (list[0]?.id ?? null)));
      })
      .catch(() => setUsersError(true));
  }, []);

  const user = users?.find((u) => u.id === userId) ?? null;

  // Account whose data may be shown. Responses for any other account (a switch happened while
  // the request was in flight, or after unmount) are dropped, so one person's balance/history
  // can never appear under another person's name.
  const currentUserId = useRef<string | null>(null);
  useEffect(() => () => void (currentUserId.current = null), []);

  const refresh = useCallback(async (id: string) => {
    const [b, h] = await Promise.allSettled([api.balance(id), api.payments(id)]);
    if (currentUserId.current !== id) return;
    setBalance(b.status === 'fulfilled' ? { state: 'ok', units: b.value.balanceUnits } : { state: 'error' });
    if (h.status === 'fulfilled') setHistory(h.value);
  }, []);

  useEffect(() => {
    currentUserId.current = userId;
    if (!userId) return;
    if (!visitor) storage.set(SELECTED_KEY, userId);
    setBalance({ state: 'loading' });
    setHistory(null);
    void refresh(userId);
  }, [userId, refresh, visitor]);

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
      {!visitor && (
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
      )}

      {user && (
        <section className="balance-card" aria-labelledby="balance-title">
          <div className="balance-card__top">
            <p className="balance-card__greeting">Bem-vindo a Maricá, {user.displayName.split(' ')[0]}</p>
            <span className="chip chip-onchain">
              <span className="chip__dot" aria-hidden="true" />
              on-chain · Solana
            </span>
          </div>
          <h2 id="balance-title" className="balance-card__label">
            Seu saldo para gastar em Maricá
          </h2>
          <p className="balance-amount" aria-live="polite">
            {balance.state === 'ok' ? formatMum(balance.units) : balance.state === 'loading' ? '…' : 'Indisponível'}
          </p>
          <p className="balance-card__parity">1 Mum+ = R$ 1,00</p>
          {balance.state === 'error' && <p className="balance-card__note">Não conseguimos consultar a rede agora.</p>}
          <div className="balance-card__wallet">
            <span className="balance-card__wallet-label">Carteira Solana (Phantom)</span>
            <span className="balance-card__address">
              <code title={user.walletAddress}>{shortAddress(user.walletAddress)}</code>
              <CopyButton text={user.walletAddress} label="Copiar endereço" className="button button--on-brand button--sm" />
            </span>
          </div>
          <div className="balance-card__actions">
            {visitor ? (
              <PopButton type="button" color="marica" size="lg" disabled={!purchasesOpen} onClick={() => setRecharging(true)}>
                <span aria-hidden="true">＋</span> Comprar Mum+
              </PopButton>
            ) : (
              <button type="button" className="btn-primary button--lg" onClick={() => setRecharging(true)}>
                <span aria-hidden="true">＋</span> Comprar Mum+
              </button>
            )}
            <a
              className="btn-secondary button--lg"
              href={`https://explorer.solana.com/address/${encodeURIComponent(user.walletAddress)}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ver na rede <span aria-hidden="true">↗</span>
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          </div>
          {visitor && !purchasesOpen && (
            <p className="balance-card__note" role="status">
              Compras de demonstração pausadas no momento. Tente mais tarde.
            </p>
          )}
          {visitor && (
            <p className="balance-card__note">
              Seus Mum+ aparecem na Phantom quando ela está na rede de testes (Devnet).
            </p>
          )}
          <ul className="impact-chips" aria-label="Por que usar Mum+">
            <li className="chip chip--impact">
              <span aria-hidden="true">🎟️</span> Descontos e benefícios na rede de Maricá
            </li>
            <li className="chip chip--impact">
              <span aria-hidden="true">🎬</span> Parte do lucro financia cinema e cultura na cidade
            </li>
          </ul>
        </section>
      )}

      <BenefitsSection />

      <section className="card history-card" aria-labelledby="history-title">
        <h2 id="history-title" className="card__title">
          Histórico
        </h2>
        {history === null ? (
          <p className="muted" role="status">Carregando…</p>
        ) : history.length === 0 ? (
          <p className="muted">Nenhuma compra ainda. Toque em Comprar Mum+ para fazer a primeira.</p>
        ) : (
          <ul className="history">
            {history.map((p) => (
              <li key={p.id} className="history__item">
                <div className="history__main">
                  <span className="history__title">Compra de Mum+ via Pix</span>
                  <span className="history__date muted small">{formatDateTime(p.createdAt)}</span>
                </div>
                <div className="history__side">
                  <span className="history__amount">
                    {p.status === 'MINTED' && p.mintAmountUnits
                      ? `+ ${formatMum(p.mintAmountUnits)}`
                      : formatBRL(p.requestedAmountCents)}
                  </span>
                  <StatusBadge status={p.status} />
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
          provider={visitor ? 'simulated' : 'ozav'}
          audience={visitor ? 'visitor' : 'operator'}
          allowSimulate={!!visitor}
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
