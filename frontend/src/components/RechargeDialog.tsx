import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type PaymentDTO, type PaymentStatus, type ProviderName } from '../api';
import { formatBRL, formatMum, isResumable, isTerminal, parseReaisToCents } from '../format';
import { CopyButton } from './CopyButton';
import { Modal } from './Modal';
import { PopButton } from './spell/pop-button';

export interface RechargeDialogProps {
  userId: string;
  provider: ProviderName;
  onClose: () => void;
  /** Called once when the payment reaches a terminal state (MINTED or FAILED). */
  onCompleted?: (p: PaymentDTO) => void;
  /** Operator mode: lets the operator mark a sandbox/simulated charge as paid from the dialog. */
  allowSimulate?: boolean;
  pollIntervalMs?: number;
  /** Dialog title before the charge exists. Defaults to "Comprar Mum+ via Pix" (visitor) or "Recarregar Mum+" (operator mode). */
  title?: string;
  /** Wording/styling audience. Defaults to 'operator' when `allowSimulate`, else 'visitor'. */
  audience?: 'operator' | 'visitor';
  /** Resume an existing charge: the dialog opens on its pending step (QR, polling, pay button). */
  initialPayment?: PaymentDTO;
}

/** The visitor's open purchase (newest resumable charge), or null when it cannot be loaded. */
async function findOpenPayment(userId: string): Promise<PaymentDTO | null> {
  try {
    const list = await api.payments(userId);
    const open = list.filter((p) => isResumable(p));
    open.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return open[0] ?? null;
  } catch {
    return null;
  }
}

const PURCHASES_CLOSED = 'Compras de demonstração pausadas no momento. Tente mais tarde.';

/** Errors only visitors can hit (purchase limits, pause switch, expiry). */
function visitorErrorMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'daily_limit') return 'Você atingiu o limite de compras de hoje.';
  if (e.code === 'open_payment') return 'Você já tem uma compra aguardando pagamento.';
  if (e.code === 'purchases_closed') return PURCHASES_CLOSED;
  if (e.code === 'payment_expired') return 'Esta compra expirou. Comece uma nova compra.';
  return null;
}

function createErrorMessage(e: unknown): string {
  const visitorMsg = visitorErrorMessage(e);
  if (visitorMsg) return visitorMsg;
  if (e instanceof ApiError) {
    if (e.code === 'amount_out_of_range' && typeof e.body.minCents === 'string' && typeof e.body.maxCents === 'string') {
      return `Valor fora do limite. Valor mínimo ${formatBRL(e.body.minCents)} e máximo ${formatBRL(e.body.maxCents)}.`;
    }
    if (e.code === 'provider_not_enabled') return 'Este meio de pagamento não está disponível no momento.';
    if (e.code === 'provider_unavailable') return 'Não conseguimos gerar o Pix agora. Tente novamente em instantes.';
    if (e.code === 'user_not_found') return 'Conta não encontrada.';
    if (e.code === 'rate_limited') return 'Muitas tentativas. Aguarde um instante.';
  }
  return 'Algo deu errado. Tente novamente.';
}

/** Visitor mode speaks of a purchase ("compra"); operator mode keeps the "recarga" wording. */
const COPY = {
  visitor: {
    title: 'Comprar Mum+ via Pix',
    amountLabel: 'Valor da compra (R$)',
    chargeTitle: 'Compra de',
    done: 'Compra concluída',
    progress: 'Andamento da compra',
    failed: 'Não foi possível concluir a compra',
  },
  operator: {
    title: 'Recarregar Mum+',
    amountLabel: 'Valor da recarga (R$)',
    chargeTitle: 'Recarga de',
    done: 'Recarga concluída',
    progress: 'Andamento da recarga',
    failed: 'Não foi possível concluir a recarga',
  },
} as const;
type Copy = (typeof COPY)[keyof typeof COPY];

/** How many timeline steps are complete for a status (out of 4). */
const PROGRESS: Record<PaymentStatus, number> = {
  AWAITING_PAYMENT: 1,
  VALIDATING: 1,
  RECEIVED: 2,
  APPROVED: 2,
  MINT_PENDING: 2,
  MINTED: 4,
  FAILED: 0,
};

function Timeline({ status, copy }: { status: PaymentStatus; copy: Copy }) {
  const steps = [
    'Pix gerado',
    status === 'AWAITING_PAYMENT'
      ? 'Aguardando pagamento'
      : status === 'VALIDATING'
        ? 'Confirmando pagamento'
        : 'Pagamento confirmado',
    'Emitindo Mum+',
    copy.done,
  ];
  const done = PROGRESS[status];
  return (
    <ol className="timeline" aria-label={copy.progress}>
      {steps.map((label, i) => {
        const state = i < done ? 'done' : i === done ? 'active' : 'todo';
        return (
          <li key={label} className={`timeline__step timeline__step--${state}`} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="timeline__marker" aria-hidden="true">
              {state === 'done' ? '✓' : ''}
            </span>
            <span className="timeline__label">{label}</span>
            {state === 'active' && <span className="sr-only"> (em andamento)</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function RechargeDialog({
  userId,
  provider,
  onClose,
  onCompleted,
  allowSimulate = false,
  pollIntervalMs = 2000,
  title,
  audience = allowSimulate ? 'operator' : 'visitor',
  initialPayment,
}: RechargeDialogProps) {
  const copy = COPY[audience];
  const pop = audience === 'visitor' && allowSimulate;
  const amountId = useId();
  const codeId = useId();
  const errorId = useId();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payment, setPayment] = useState<PaymentDTO | null>(initialPayment ?? null);
  const [simulating, setSimulating] = useState(false);
  const mounted = useRef(true);
  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;
  const notified = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Poll the payment every `pollIntervalMs` until MINTED/FAILED; stops on unmount.
  const paymentId = payment?.id ?? null;
  const terminal = payment ? isTerminal(payment.status) : false;
  useEffect(() => {
    if (!paymentId || terminal) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const p = await api.payment(paymentId);
        if (cancelled) return;
        setPayment(p);
        if (isTerminal(p.status)) return;
      } catch (e) {
        if (cancelled) return;
        // Session gone or payment unknown: nothing more to wait for. Other errors are transient.
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) return;
      }
      timer = setTimeout(tick, pollIntervalMs);
    };
    timer = setTimeout(tick, pollIntervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paymentId, terminal, pollIntervalMs]);

  useEffect(() => {
    if (payment && terminal && !notified.current) {
      notified.current = true;
      completedRef.current?.(payment);
    }
  }, [payment, terminal]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseReaisToCents(amount);
    if (!cents) {
      setError('Informe um valor válido, por exemplo 50,00.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const p = await api.createPayment({ userId, amountCents: cents, provider });
      if (mounted.current) setPayment(p);
    } catch (err) {
      // A purchase is already open: pick it up instead of only reporting the error.
      const open = err instanceof ApiError && err.code === 'open_payment' ? await findOpenPayment(userId) : null;
      if (!mounted.current) return;
      if (open) setPayment(open);
      else setError(createErrorMessage(err));
    } finally {
      if (mounted.current) setSubmitting(false);
    }
  }

  async function simulate() {
    if (!payment) return;
    setSimulating(true);
    setError(null);
    try {
      const p = await api.simulate(payment.id);
      if (mounted.current) setPayment(p);
    } catch (err) {
      if (mounted.current) setError(visitorErrorMessage(err) ?? 'Não foi possível simular o pagamento agora.');
    } finally {
      if (mounted.current) setSimulating(false);
    }
  }

  if (!payment) {
    return (
      <Modal title={title ?? copy.title} onClose={onClose}>
        <form className="stack" onSubmit={submit} noValidate>
          <p className="muted">
            Você paga em reais via Pix e recebe o mesmo valor em Mum+ na sua carteira. R$ 1,00 = 1,00 Mum+.
          </p>
          <div className="field">
            <label htmlFor={amountId}>{copy.amountLabel}</label>
            <div className="money-input">
              <span aria-hidden="true">R$</span>
              <input
                id={amountId}
                inputMode="decimal"
                autoComplete="off"
                placeholder="50,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </div>
          </div>
          {error && (
            <p id={errorId} className="alert alert--danger" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            {pop ? (
              <>
                <PopButton type="button" color="default" onClick={onClose}>
                  Cancelar
                </PopButton>
                <PopButton type="submit" color="marica" disabled={submitting}>
                  {submitting ? 'Gerando…' : 'Gerar Pix'}
                </PopButton>
              </>
            ) : (
              <>
                <button type="button" className="button button--ghost" onClick={onClose}>
                  Cancelar
                </button>
                <button type="submit" className="button button--primary" disabled={submitting}>
                  {submitting ? 'Gerando…' : 'Gerar Pix'}
                </button>
              </>
            )}
          </div>
        </form>
      </Modal>
    );
  }

  const status = payment.status;
  const received = payment.receivedAmountCents ?? payment.requestedAmountCents;
  const canSimulate = allowSimulate && status === 'AWAITING_PAYMENT' && payment.origin !== 'OZAV live';

  return (
    <Modal title={`${copy.chargeTitle} ${formatBRL(payment.requestedAmountCents)}`} onClose={onClose}>
      <div className="stack">
        {status !== 'FAILED' && <Timeline status={status} copy={copy} />}

        {status === 'AWAITING_PAYMENT' && payment.pixBrCode && (
          <div className="pix">
            <div className="pix__qr qr-frame">
              <QRCodeSVG value={payment.pixBrCode} size={192} level="M" marginSize={2} role="img" aria-label="QR Code do Pix" />
            </div>
            <p className="muted center">Abra o app do seu banco, escolha Pix e escaneie o código ou use o copia e cola.</p>
            <div className="field">
              <label htmlFor={codeId}>Pix copia e cola</label>
              <textarea id={codeId} className="code" readOnly rows={3} value={payment.pixBrCode} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <CopyButton text={payment.pixBrCode} label="Copiar código Pix" className="button button--primary button--block" />
            {payment.pixExpiresAt && (
              <p className="muted small center">
                Válido até {new Date(payment.pixExpiresAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}

        {status === 'AWAITING_PAYMENT' && !payment.pixBrCode && (
          <p className="muted center" role="status">
            Cobrança criada. Aguardando a confirmação do pagamento.
          </p>
        )}

        {canSimulate && (
          pop ? (
            <PopButton type="button" color="marica" className="w-full" onClick={simulate} disabled={simulating}>
              {simulating ? 'Pagando…' : 'Pagar agora (demonstração)'}
            </PopButton>
          ) : (
            <button type="button" className="button button--ghost button--block" onClick={simulate} disabled={simulating}>
              {simulating ? 'Simulando…' : 'Simular pagamento'}
            </button>
          )
        )}

        {!terminal && status !== 'AWAITING_PAYMENT' && (
          <p className="muted center" role="status">
            Pagamento recebido. Estamos emitindo seus Mum+, isso leva poucos segundos.
          </p>
        )}

        {status === 'MINTED' && (
          <div className="result result--success" role="status">
            <p className="result__title">{copy.done}</p>
            <p>
              <strong>{formatMum(payment.mintAmountUnits ?? received)}</strong> creditados na sua carteira.
            </p>
            {payment.explorerUrl && (
              <a className="button button--ghost" href={payment.explorerUrl} target="_blank" rel="noopener noreferrer">
                Ver no Solana Explorer ↗
              </a>
            )}
          </div>
        )}

        {status === 'FAILED' && (
          <div className="result result--danger" role="alert">
            <p className="result__title">{copy.failed}</p>
            <p>Se o valor foi debitado, ele será analisado pela nossa equipe. Nenhuma ação é necessária agora.</p>
          </div>
        )}

        {error && (
          <p className="alert alert--danger" role="alert">
            {error}
          </p>
        )}

        <div className="actions">
          {pop ? (
            <PopButton type="button" color={terminal ? 'marica' : 'default'} onClick={onClose}>
              {terminal ? 'Concluir' : 'Fechar'}
            </PopButton>
          ) : (
            <button type="button" className={terminal ? 'button button--primary' : 'button button--ghost'} onClick={onClose}>
              {terminal ? 'Concluir' : 'Fechar'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
