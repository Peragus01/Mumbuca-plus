import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MaricaGradient } from './MaricaGradient';

beforeEach(() => {
  // jsdom has no WebGL: getContext returns null, like a browser with WebGL2 disabled.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(cleanup);

describe('MaricaGradient', () => {
  it('falls back to the animated CSS gradient when WebGL2 is unavailable', () => {
    const { container } = render(<MaricaGradient />);
    expect(container.querySelector('.gradient-fallback')).not.toBeNull();
    expect(container.querySelectorAll('.gradient-fallback__blob')).toHaveLength(3);
    expect(container.querySelector('canvas')).toBeNull();
  });

  it('uses the Spell UI WebGL gradient when WebGL2 is available', () => {
    const { container } = render(<MaricaGradient supportsWebGL2 />);
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('.gradient-fallback')).toBeNull();
  });
});
