import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentDTO, UserDTO } from '../api';
import { CitizenView } from './CitizenView';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

const users: UserDTO[] = [
  { id: A, handle: 'ana', displayName: 'Ana Souza', walletAddress: 'AnaWa11et1111111111111111111111111111111111', createdAt: '2026-11-24T12:00:00.000Z' },
  { id: B, handle: 'bia', displayName: 'Bia Lima', walletAddress: 'BiaWa11et2222222222222222222222222222222222', createdAt: '2026-11-24T12:00:00.000Z' },
];

function payment(userId: string, over: Partial<PaymentDTO> = {}): PaymentDTO {
  return {
    id: `${userId.slice(0, 8)}-1111-4111-8111-111111111111`,
    userId,
    provider: 'simulated',
    providerEnv: 'local',
    origin: 'SIMULADO',
    status: 'MINTED',
    requestedAmountCents: '5000',
    receivedAmountCents: '5000',
    mintAmountUnits: '5000',
    pixBrCode: null,
    pixExpiresAt: null,
    txSignature: 'sig',
    explorerUrl: 'https://explorer.solana.com/tx/sig?cluster=devnet',
    slot: '1',
    needsReview: false,
    amountMismatch: false,
    failureReason: null,
    lastError: null,
    createdAt: '2026-11-24T12:00:00.000Z',
    updatedAt: '2026-11-24T12:00:00.000Z',
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function deferred() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CitizenView', () => {
  it('never shows the payment origin (SIMULADO) to the citizen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/users') return json(users);
        if (url.endsWith('/balance')) return json({ balanceUnits: '5000' });
        if (url.startsWith('/api/payments')) return json([payment(A)]);
        return json({ error: 'not_found' }, 404);
      }),
    );
    render(<CitizenView />);

    expect(await screen.findByText('ver na rede ↗')).toBeTruthy();
    expect(screen.getByText('Emitido')).toBeTruthy();
    expect(screen.queryByText(/SIMULADO/)).toBeNull();
  });

  it("ignores a late response for the previous account after switching (no cross-account leak)", async () => {
    const lateBalanceA = deferred();
    const lateHistoryA = deferred();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/users') return json(users);
        if (url === `/api/users/${A}/balance`) return lateBalanceA.promise;
        if (url === `/api/payments?userId=${A}`) return lateHistoryA.promise;
        if (url === `/api/users/${B}/balance`) return json({ balanceUnits: '2500' });
        if (url === `/api/payments?userId=${B}`) return json([payment(B, { mintAmountUnits: '2500' })]);
        return json({ error: 'not_found' }, 404);
      }),
    );
    render(<CitizenView />);

    // A is selected first and its requests are still in flight; the user switches to B.
    const select = (await screen.findByLabelText('Conta')) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: B } });
    expect(await screen.findByText('25,00 Mum+')).toBeTruthy();
    expect(await screen.findByText('+ 25,00 Mum+')).toBeTruthy();

    // A's responses arrive late: they must not overwrite B's data.
    lateBalanceA.resolve(json({ balanceUnits: '999900' }));
    lateHistoryA.resolve(json([payment(A, { mintAmountUnits: '999900' })]));
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.getByText(/Bem-vindo a Maricá,\s*Bia/)).toBeTruthy();
    expect(screen.getByText('25,00 Mum+')).toBeTruthy();
    expect(screen.getByText('+ 25,00 Mum+')).toBeTruthy();
    expect(screen.queryByText(/9\.999,00 Mum\+/)).toBeNull();
  });
  describe('C2 visitor wallet', () => {
    function stubDefault() {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url === '/api/users') return json(users);
          if (url.endsWith('/balance')) return json({ balanceUnits: '5000' });
          if (url.startsWith('/api/payments')) return json([]);
          return json({ error: 'not_found' }, 404);
        }),
      );
    }

    it('shows the on-chain chip and parity', async () => {
      stubDefault();
      render(<CitizenView />);
      expect(await screen.findByText('on-chain · Solana')).toBeTruthy();
      expect(screen.getByText('1 Mum+ = R$ 1,00')).toBeTruthy();
    });

    it('wallet link opens the address on Solana Explorer devnet', async () => {
      stubDefault();
      render(<CitizenView />);
      const link = (await screen.findByRole('link', { name: /^Ver na rede/ })) as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe(`https://explorer.solana.com/address/${users[0]!.walletAddress}?cluster=devnet`);
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.textContent).toContain('(abre em nova aba)');
      expect(screen.getByRole('link', { name: /Ver na rede.*\(abre em nova aba\)/ })).toBe(link);
      expect(link.getAttribute('rel') ?? '').toContain('noopener');
    });

    it('shows visitor copy and impact chips', async () => {
      stubDefault();
      render(<CitizenView />);
      expect(await screen.findByText(/Bem-vindo a Maricá/)).toBeTruthy();
      expect(screen.getByText('Seu saldo para gastar em Maricá')).toBeTruthy();
      expect(screen.getByText(/Descontos e benefícios na rede de Maricá/)).toBeTruthy();
      expect(screen.getByText(/Parte do lucro financia cinema e cultura na cidade/)).toBeTruthy();
      expect(screen.queryByText(/Comércio local fortalecido/)).toBeNull();
    });

    it('shows the Benefícios em Maricá section', async () => {
      stubDefault();
      render(<CitizenView />);
      expect(await screen.findByRole('heading', { name: 'Benefícios em Maricá' })).toBeTruthy();
      for (const title of ['Gastronomia', 'Hospedagem', 'Cultura e cinema', 'Comércio local']) {
        expect(screen.getByText(title)).toBeTruthy();
      }
      expect(screen.getAllByText('exemplo').length).toBeGreaterThanOrEqual(4);
      expect(screen.getByText('Benefícios ilustrativos da proposta Mumbuca+.')).toBeTruthy();
    });

    it('primary button reads Comprar Mum+', async () => {
      stubDefault();
      render(<CitizenView />);
      expect(await screen.findByRole('button', { name: /Comprar Mum\+/ })).toBeTruthy();
    });
  });
  describe('visitor mode', () => {
    function stubVisitor(open = true) {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === '/api/users') return json(users);
        if (url === '/api/public/status') return json({ visitorPurchasesOpen: open });
        if (url.endsWith('/balance')) return json({ balanceUnits: '5000' });
        if (url.startsWith('/api/payments')) return json([]);
        return json({ error: 'not_found' }, 404);
      });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('does not fetch users nor render the account selector', async () => {
      const fetchMock = stubVisitor();
      const { container } = render(<CitizenView visitor={users[0]} />);
      expect(await screen.findByText(/Bem-vindo a Maricá/)).toBeTruthy();
      expect(container.querySelector('select')).toBeNull();
      expect(fetchMock.mock.calls.some((c) => c[0] === '/api/users')).toBe(false);
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes(`/api/users/${A}/balance`) || String(c[0]).includes(A))).toBe(true);
    });

    it('shows the Devnet hint', async () => {
      stubVisitor();
      render(<CitizenView visitor={users[0]} />);
      expect(await screen.findByText(/Seus Mum\+ aparecem na Phantom quando ela está na rede de testes \(Devnet\)/)).toBeTruthy();
    });

    it('disables buying and explains when demo purchases are paused', async () => {
      stubVisitor(false);
      render(<CitizenView visitor={users[0]} />);
      expect(await screen.findByText('Compras de demonstração pausadas no momento. Tente mais tarde.')).toBeTruthy();
      expect((screen.getByRole('button', { name: /Comprar Mum\+/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('enables buying when open', async () => {
      stubVisitor(true);
      render(<CitizenView visitor={users[0]} />);
      await screen.findByText(/Bem-vindo a Maricá/);
      await waitFor(() => expect((screen.getByRole('button', { name: /Comprar Mum\+/ }) as HTMLButtonElement).disabled).toBe(false));
      expect(screen.queryByText(/pausadas/)).toBeNull();
    });
  });
});
