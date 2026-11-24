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

  it('renders the Maricá subtitle when asked', () => {
    render(<BrandMark wordmark subtitle />);
    expect(screen.getByText('Moeda social de Maricá')).toBeTruthy();
  });
});
