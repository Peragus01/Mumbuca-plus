import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { OriginBadge, StatusBadge } from './StatusBadge';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders the pt-BR label for MINTED', () => {
    render(<StatusBadge status="MINTED" />);
    expect(screen.getByText('Emitido')).toBeTruthy();
  });

  it('renders only the status: origin is an operator-only concern (ruling R10)', () => {
    const { container } = render(<StatusBadge status="AWAITING_PAYMENT" />);
    expect(container.textContent).toBe('Aguardando Pix');
  });
});

describe('OriginBadge (operator view only)', () => {
  it('highlights simulated payments', () => {
    render(<OriginBadge origin="SIMULADO" />);
    expect(screen.getByText('SIMULADO').className).toContain('badge--simulated');
  });

  it('does not highlight OZAV payments', () => {
    render(<OriginBadge origin="OZAV sandbox" />);
    expect(screen.getByText('OZAV sandbox').className).not.toContain('badge--simulated');
  });
});
