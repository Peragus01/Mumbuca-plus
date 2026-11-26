import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';
import { base58Encode } from '../phantom';
import { Entry } from './Entry';

const WALLET = 'So11111111111111111111111111111111111111112';

function mockPhantom(over: Record<string, unknown> = {}) {
  const signMessage = vi.fn().mockResolvedValue({ signature: new Uint8Array([0, 0, 1, 2, 255]) });
  const connect = vi.fn().mockResolvedValue({ publicKey: { toString: () => WALLET } });
  (window as unknown as { phantom?: unknown }).phantom = { solana: { isPhantom: true, connect, signMessage, ...over } };
  return { signMessage, connect };
}

describe('Entry', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as { phantom?: unknown }).phantom;
  });

  it('shows the no-Phantom screen when the wallet is missing', () => {
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(screen.getByText(/Falta só/)).toBeTruthy();
    const link = screen.getByRole('link', { name: /Instalar Phantom/ });
    expect(link.getAttribute('href')).toBe('https://phantom.app/download');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('signs the challenge and verifies with a base58 signature', async () => {
    const { signMessage } = mockPhantom();
    const challenge = vi.spyOn(api, 'phantomChallenge').mockResolvedValue({ nonce: 'n1', message: 'hello' });
    const verify = vi.spyOn(api, 'phantomVerify').mockResolvedValue({ status: 'signed_in' });
    const onSignedIn = vi.fn();
    render(<Entry onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(challenge).toHaveBeenCalledWith(WALLET);
    expect(signMessage.mock.calls[0]![0]).toEqual(new TextEncoder().encode('hello'));
    expect(verify).toHaveBeenCalledWith({
      walletAddress: WALLET,
      nonce: 'n1',
      signature: base58Encode(new Uint8Array([0, 0, 1, 2, 255])),
    });
  });

  it('base58 encodes known vectors', () => {
    expect(base58Encode(new Uint8Array([0, 0, 1]))).toBe('112');
    expect(base58Encode(new TextEncoder().encode('hello'))).toBe('Cn8eVZg');
  });

  it('goes to account creation on needs_signup', async () => {
    mockPhantom();
    vi.spyOn(api, 'phantomChallenge').mockResolvedValue({ nonce: 'n1', message: 'hello' });
    vi.spyOn(api, 'phantomVerify').mockResolvedValue({ status: 'needs_signup' });
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(await screen.findByText(/Vamos criar sua conta/)).toBeTruthy();
  });

  it('shows a cancel message when the user rejects in Phantom', async () => {
    mockPhantom({ signMessage: vi.fn().mockRejectedValue({ code: 4001 }) });
    vi.spyOn(api, 'phantomChallenge').mockResolvedValue({ nonce: 'n1', message: 'hello' });
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(await screen.findByText('Você cancelou na Phantom. Tente de novo quando quiser.')).toBeTruthy();
  });

  it('maps signin_disabled and generic errors', async () => {
    mockPhantom();
    const challenge = vi.spyOn(api, 'phantomChallenge').mockRejectedValue(new ApiError(403, 'signin_disabled', {}));
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(await screen.findByText('O acesso de visitantes está pausado no momento.')).toBeTruthy();
    challenge.mockRejectedValue(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(await screen.findByText('Não conseguimos entrar agora. Tente de novo.')).toBeTruthy();
  });

  it('maps rate_limited (429) to a try-later message', async () => {
    mockPhantom();
    vi.spyOn(api, 'phantomChallenge').mockRejectedValue(new ApiError(429, 'rate_limited', {}));
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    expect(await screen.findByText('Muitas tentativas. Tente mais tarde.')).toBeTruthy();
  });

  it('the public entry has no operator link nor password field', () => {
    render(<Entry onSignedIn={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Sou operador' })).toBeNull();
    expect(screen.queryByText(/operador/i)).toBeNull();
    expect(screen.queryByLabelText('Senha de acesso')).toBeNull();
  });

  it('operator access (/operador) shows only the password form and calls api.login', async () => {
    const login = vi.spyOn(api, 'login').mockResolvedValue(undefined);
    const onSignedIn = vi.fn();
    render(<Entry onSignedIn={onSignedIn} operatorAccess />);
    expect(screen.queryByRole('button', { name: 'Entrar com Phantom' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Acesso do operador' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByText('Informe a senha de acesso.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Senha de acesso'), { target: { value: 'segredo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('segredo'));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });
});
