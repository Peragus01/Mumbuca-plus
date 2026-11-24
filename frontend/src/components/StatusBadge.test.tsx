import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders the pt-BR label for MINTED', () => {
    render(<StatusBadge status="MINTED" />);
    expect(screen.getByText('Emitido')).toBeTruthy();
    expect(screen.queryByText('SIMULADO')).toBeNull();
  });

  it('flags simulated payments', () => {
    render(<StatusBadge status="AWAITING_PAYMENT" origin="SIMULADO" />);
    expect(screen.getByText('Aguardando Pix')).toBeTruthy();
    expect(screen.getByText('SIMULADO')).toBeTruthy();
  });

  it('does not flag OZAV payments', () => {
    render(<StatusBadge status="FAILED" origin="OZAV sandbox" />);
    expect(screen.getByText('Falhou')).toBeTruthy();
    expect(screen.queryByText('SIMULADO')).toBeNull();
  });
});
