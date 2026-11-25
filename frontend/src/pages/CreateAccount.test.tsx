import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../api';
import { CreateAccount } from './CreateAccount';
import { Entry } from './Entry';

const WALLET = 'So11111111111111111111111111111111111111112';

describe('CreateAccount', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (window as unknown as { phantom?: unknown }).phantom;
  });

  it('shows the short wallet and signs up', async () => {
    const signup = vi.spyOn(api, 'signup').mockResolvedValue({ status: 'signed_in' });
    const onSignedIn = vi.fn();
    render(<CreateAccount wallet={WALLET} onSignedIn={onSignedIn} onExpired={() => {}} />);
    expect(screen.getByText('So11…1112')).toBeTruthy();
    expect(screen.getByText('✓ conectada')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Como quer ser chamado?'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    expect(signup).toHaveBeenCalledWith('Ana');
  });

  it('keeps the typed text on invalid_display_name', async () => {
    vi.spyOn(api, 'signup').mockRejectedValue(new ApiError(400, 'invalid_display_name', {}));
    render(<CreateAccount wallet={WALLET} onSignedIn={() => {}} onExpired={() => {}} />);
    const input = screen.getByLabelText('Como quer ser chamado?') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Use de 2 a 40 caracteres.')).toBeTruthy();
    expect(input.value).toBe('A');
  });

  it('maps rate_limited (429) to a try-later message', async () => {
    vi.spyOn(api, 'signup').mockRejectedValue(new ApiError(429, 'rate_limited', {}));
    render(<CreateAccount wallet={WALLET} onSignedIn={() => {}} onExpired={() => {}} />);
    fireEvent.change(screen.getByLabelText('Como quer ser chamado?'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Muitas tentativas. Tente mais tarde.')).toBeTruthy();
  });

  it('returns to Entry with a message on signup_expired', async () => {
    (window as unknown as { phantom?: unknown }).phantom = {
      solana: {
        isPhantom: true,
        connect: vi.fn().mockResolvedValue({ publicKey: { toString: () => WALLET } }),
        signMessage: vi.fn().mockResolvedValue({ signature: new Uint8Array([1]) }),
      },
    };
    vi.spyOn(api, 'phantomChallenge').mockResolvedValue({ nonce: 'n', message: 'm' });
    vi.spyOn(api, 'phantomVerify').mockResolvedValue({ status: 'needs_signup' });
    vi.spyOn(api, 'signup').mockRejectedValue(new ApiError(401, 'signup_expired', {}));
    render(<Entry onSignedIn={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Entrar com Phantom' }));
    await screen.findByText(/Vamos criar sua conta/);
    fireEvent.change(screen.getByLabelText('Como quer ser chamado?'), { target: { value: 'Ana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(await screen.findByText('Sua sessão expirou, entre de novo.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Entrar com Phantom' })).toBeTruthy();
  });
});
