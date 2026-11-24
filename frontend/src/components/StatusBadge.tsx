import type { PaymentOrigin, PaymentStatus } from '../api';
import { statusLabel } from '../format';

const TONE: Record<PaymentStatus, string> = {
  AWAITING_PAYMENT: 'pending',
  RECEIVED: 'info',
  VALIDATING: 'info',
  APPROVED: 'info',
  MINT_PENDING: 'info',
  MINTED: 'success',
  FAILED: 'danger',
};

export function OriginBadge({ origin }: { origin: PaymentOrigin }) {
  return (
    <span className={`badge badge--origin${origin === 'SIMULADO' ? ' badge--simulated' : ''}`}>{origin}</span>
  );
}

export function StatusBadge({ status, origin }: { status: PaymentStatus; origin?: PaymentOrigin }) {
  return (
    <span className="badge-group">
      <span className={`badge badge--${TONE[status] ?? 'pending'}`}>
        <span className="badge__dot" aria-hidden="true" />
        {statusLabel(status)}
      </span>
      {origin === 'SIMULADO' && <OriginBadge origin={origin} />}
    </span>
  );
}
