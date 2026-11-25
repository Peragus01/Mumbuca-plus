/** Typed client for the backend HTTP contract (backend/src/http). Same-origin; session cookie. */

export type PaymentStatus =
  | 'AWAITING_PAYMENT'
  | 'RECEIVED'
  | 'VALIDATING'
  | 'APPROVED'
  | 'MINT_PENDING'
  | 'MINTED'
  | 'FAILED';

export type ProviderName = 'ozav' | 'simulated' | 'mercadopago';
export type PaymentOrigin = 'OZAV live' | 'OZAV sandbox' | 'SIMULADO';

export interface PaymentDTO {
  id: string;
  userId: string;
  provider: ProviderName;
  providerEnv: 'sandbox' | 'live' | 'local';
  origin: PaymentOrigin;
  status: PaymentStatus;
  requestedAmountCents: string;
  receivedAmountCents: string | null;
  mintAmountUnits: string | null;
  pixBrCode: string | null;
  pixExpiresAt: string | null;
  txSignature: string | null;
  explorerUrl: string | null;
  slot: string | null;
  needsReview: boolean;
  amountMismatch: boolean;
  failureReason: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserDTO {
  id: string;
  handle: string;
  displayName: string;
  walletAddress: string;
  createdAt: string;
}

export type Role = 'operator' | 'visitor';

export interface OpsStatus {
  providerEnv: 'sandbox' | 'live';
  programId: string;
  mintAddress: string;
  cluster: string;
  paused: boolean;
  minterLamports: string;
  lowSol: boolean;
  /** On-chain deployment check (minter, max_mint_per_tx, pause). Absent on older backends. */
  configOk?: boolean;
  configIssues?: string[];
}

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(`HTTP ${status}: ${code}`);
  }
}

type UnauthorizedListener = () => void;
let onUnauthorized: UnauthorizedListener | null = null;
/** Called on any 401 from an authenticated route (session expired). */
export function setUnauthorizedListener(fn: UnauthorizedListener | null): void {
  onUnauthorized = fn;
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: { accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const code = typeof obj.error === 'string' ? obj.error : 'http_error';
    if (res.status === 401 && path !== '/api/login' && !path.startsWith('/api/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, code, obj);
  }
  return data as T;
}

export const api = {
  session: () => request<{ authenticated: boolean; role: Role | null }>('GET', '/api/session'),
  me: () => request<{ role: 'operator' } | { role: 'visitor'; user: UserDTO }>('GET', '/api/me'),
  publicStatus: () => request<{ visitorPurchasesOpen: boolean }>('GET', '/api/public/status'),
  phantomChallenge: (walletAddress: string) =>
    request<{ nonce: string; message: string }>('POST', '/api/auth/phantom/challenge', { walletAddress }),
  phantomVerify: (v: { walletAddress: string; nonce: string; signature: string }) =>
    request<{ status: 'signed_in' | 'needs_signup' }>('POST', '/api/auth/phantom/verify', v),
  signup: (displayName: string) =>
    request<{ status: 'signed_in' }>('POST', '/api/auth/signup', { displayName }),
  login: (password: string) => request<void>('POST', '/api/login', { password }),
  logout: () => request<void>('POST', '/api/logout'),

  users: () => request<UserDTO[]>('GET', '/api/users'),
  createUser: (u: { handle: string; displayName: string; walletAddress: string }) =>
    request<UserDTO>('POST', '/api/users', u),
  balance: (userId: string) =>
    request<{ balanceUnits: string }>('GET', `/api/users/${encodeURIComponent(userId)}/balance`),

  payments: (userId?: string) =>
    request<PaymentDTO[]>('GET', userId ? `/api/payments?userId=${encodeURIComponent(userId)}` : '/api/payments'),
  payment: (id: string) => request<PaymentDTO>('GET', `/api/payments/${encodeURIComponent(id)}`),
  createPayment: (p: { userId: string; amountCents: string; provider: ProviderName }) =>
    request<PaymentDTO>('POST', '/api/payments', p),
  simulate: (id: string) => request<PaymentDTO>('POST', `/api/payments/${encodeURIComponent(id)}/simulate`),
  reprocess: (id: string) => request<PaymentDTO>('POST', `/api/payments/${encodeURIComponent(id)}/reprocess`),

  opsStatus: () => request<OpsStatus>('GET', '/api/ops/status'),
};
