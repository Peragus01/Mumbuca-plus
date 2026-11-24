import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PaymentDTO } from '../api';
import { RechargeDialog } from './RechargeDialog';

const USER_ID = '6f1c2b1e-8a0e-4c8e-9a51-0d3f3d1f2a10';
const PAYMENT_ID = '0b7e5f7c-3e8d-4c51-a1a2-9f7d6c5b4a30';
const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';
const BR_CODE = '00020126580014br.gov.bcb.pix0136a1b2c3d4-e5f6-7a8b-9c0d-e1f2a3b4c5d65204000053039865406500.005802BR6304ABCD';

function payment(over: Partial<PaymentDTO> = {}): PaymentDTO {
  return {
    id: PAYMENT_ID,
    userId: USER_ID,
    provider: 'simulated',
    providerEnv: 'local',
    origin: 'SIMULADO',
    status: 'AWAITING_PAYMENT',
    requestedAmountCents: '5000',
    receivedAmountCents: null,
    mintAmountUnits: null,
    pixBrCode: BR_CODE,
    pixExpiresAt: null,
    txSignature: null,
    explorerUrl: null,
    slot: null,
    needsReview: false,
    amountMismatch: false,
    failureReason: null,
    lastError: null,
    createdAt: '2026-11-24T12:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
    ...over,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillAndSubmit(value: string) {
  fireEvent.change(screen.getByLabelText(/Valor da recarga/i), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: /Gerar Pix/i }));
}

describe('RechargeDialog', () => {
  it('shows the allowed range when the backend answers 422', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(422, { error: 'amount_out_of_range', minCents: '1100', maxCents: '100000' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RechargeDialog userId={USER_ID} provider="ozav" onClose={() => {}} />);

    fillAndSubmit('5');

    expect(await screen.findByText(/Valor mínimo R\$ 11,00/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/payments');
    expect(JSON.parse(String(init?.body))).toEqual({ userId: USER_ID, amountCents: '500', provider: 'ozav' });
  });

  it('shows the Pix copy-and-paste code and, once MINTED, the Solana Explorer link', async () => {
    const minted = payment({
      status: 'MINTED',
      receivedAmountCents: '5000',
      mintAmountUnits: '5000',
      txSignature: SIG,
      explorerUrl: `https://explorer.solana.com/tx/${SIG}?cluster=devnet`,
      slot: '123',
    });
    const polls = [payment({ status: 'VALIDATING' }), minted];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return json(201, payment());
      expect(url).toBe(`/api/payments/${PAYMENT_ID}`);
      return json(200, polls.shift() ?? minted);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onCompleted = vi.fn();
    render(
      <RechargeDialog
        userId={USER_ID}
        provider="simulated"
        onClose={() => {}}
        onCompleted={onCompleted}
        pollIntervalMs={5}
      />,
    );

    fillAndSubmit('50');

    const code = (await screen.findByLabelText(/Pix copia e cola/i)) as HTMLTextAreaElement;
    expect(code.value).toBe(BR_CODE);

    const link = (await screen.findByRole('link', { name: /Solana Explorer/i })) as HTMLAnchorElement;
    expect(link.href).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
    expect(screen.getByText(/50,00 Mum\+/)).toBeTruthy();
    expect(onCompleted).toHaveBeenCalledTimes(1);

    // Polling stops at the terminal state.
    const calls = fetchMock.mock.calls.length;
    await sleep(40);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('never shows raw failure codes to the citizen', async () => {
    const failed = payment({ status: 'FAILED', failureReason: 'amount_below_minimum', lastError: 'token_paused' });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(201, payment()) : json(200, failed),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RechargeDialog userId={USER_ID} provider="ozav" onClose={() => {}} pollIntervalMs={5} />);

    fillAndSubmit('50');

    expect(await screen.findByText(/Não foi possível concluir a recarga/)).toBeTruthy();
    expect(screen.queryByText(/amount_below_minimum|token_paused/)).toBeNull();

    const calls = fetchMock.mock.calls.length;
    await sleep(40);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('stops polling when unmounted', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(201, payment()) : json(200, payment()),
    );
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<RechargeDialog userId={USER_ID} provider="ozav" onClose={() => {}} pollIntervalMs={5} />);

    fillAndSubmit('50');
    await screen.findByLabelText(/Pix copia e cola/i);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(2));

    view.unmount();
    const calls = fetchMock.mock.calls.length;
    await sleep(40);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
  it('renders the QR inside a light frame', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json(201, payment()) : json(200, payment()),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<RechargeDialog userId={USER_ID} provider="ozav" onClose={() => {}} pollIntervalMs={1000} />);

    fillAndSubmit('50');

    const qr = await screen.findByLabelText('QR Code do Pix');
    expect(qr.closest('.qr-frame')).not.toBeNull();
  });
});
