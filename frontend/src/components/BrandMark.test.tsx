import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

afterEach(cleanup);

describe('BrandMark', () => {
  it('renders Mumbuca with yellow plus', () => {
    const { container } = render(<BrandMark wordmark />);
    const plus = container.querySelector('.brand-plus');
    expect(plus).not.toBeNull();
    expect(plus?.textContent).toBe('+');
    expect(container.textContent).toContain('Mumbuca+');
  });

  it('uses the official Mumbuca+ logo in petróleo on a cream tile', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#FFF6E8');
    const logo = container.querySelector('path');
    expect(logo?.getAttribute('fill')).toBe('#075B57');
    expect(logo?.getAttribute('d')).toMatch(/^M8 126C8 57 53 12 111 12/);
  });

  it('renders the Maricá subtitle when asked', () => {
    render(<BrandMark wordmark subtitle />);
    expect(screen.getByText('Moeda social de Maricá')).toBeTruthy();
  });
});
