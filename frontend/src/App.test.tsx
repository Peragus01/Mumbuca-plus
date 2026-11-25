import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const visitor = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  handle: 'ana',
  displayName: 'Ana Souza',
  walletAddress: 'AnaWa11et1111111111111111111111111111111111',
  createdAt: '2026-11-24T12:00:00.000Z',
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the visitor wallet without the operator tab and never lists users', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/session') return json({ authenticated: true, role: 'visitor' });
      if (url === '/api/me') return json({ role: 'visitor', user: visitor });
      if (url === '/api/public/status') return json({ visitorPurchasesOpen: true });
      if (url.endsWith('/balance')) return json({ balanceUnits: '0' });
      if (url.startsWith('/api/payments')) return json([]);
      return json({ error: 'not_found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);

    expect(await screen.findByText('Olá, Ana Souza')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Comprar Mum\+/ })).toBeTruthy();
    expect(screen.queryByText('Operador')).toBeNull();
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/users')).toBe(false);
  });
});
