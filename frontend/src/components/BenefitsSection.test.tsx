import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BenefitsSection } from './BenefitsSection';

afterEach(cleanup);

describe('BenefitsSection', () => {
  it('caps cashback at 5% and never advertises a bigger percentage', () => {
    const { container } = render(<BenefitsSection />);
    expect(screen.getAllByText('cashback de 5%').length).toBeGreaterThanOrEqual(1);
    const percents = [...(container.textContent ?? '').matchAll(/(\d+)\s*%/g)].map((m) => Number(m[1]));
    expect(percents.length).toBeGreaterThan(0);
    expect(Math.max(...percents)).toBe(5);
  });
});
