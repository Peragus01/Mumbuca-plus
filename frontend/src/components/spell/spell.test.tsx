import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AnimatedGradient from './animated-gradient';
import { PopButton } from './pop-button';

describe('Spell UI', () => {
  beforeEach(() => {
    // jsdom has no WebGL; keep its "not implemented" noise out of the output.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('PopButton marica variant uses the yellow classes', () => {
    render(<PopButton color="marica">Entrar</PopButton>);
    const cls = screen.getByRole('button', { name: 'Entrar' }).className;
    expect(cls).toContain('bg-[#ffd23f]');
    expect(cls).toContain('border-b-4');
  });

  it('AnimatedGradient renders a canvas without WebGL2', () => {
    const { container } = render(
      <AnimatedGradient config={{ preset: 'custom', color1: '#06150f', color2: '#3dffa8', color3: '#ffd23f' }} />,
    );
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
