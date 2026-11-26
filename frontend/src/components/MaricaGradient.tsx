import { useMemo } from 'react';
import AnimatedGradient from './spell/animated-gradient';

const COLORS = { color1: '#06150f', color2: '#3dffa8', color3: '#ffd23f' } as const;

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let webgl2Cache: boolean | null = null;
/** True when the browser can create a WebGL2 context (off when hardware acceleration is disabled). */
function detectWebGL2(): boolean {
  if (webgl2Cache !== null) return webgl2Cache;
  try {
    webgl2Cache = document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    webgl2Cache = false;
  }
  return webgl2Cache;
}

/**
 * Maricá background gradient: the Spell UI WebGL shader when WebGL2 is available, otherwise an
 * animated CSS gradient in the same colors (e.g. a browser with hardware acceleration off).
 * Both respect prefers-reduced-motion.
 */
export function MaricaGradient({ supportsWebGL2 }: { supportsWebGL2?: boolean }) {
  const webgl = supportsWebGL2 ?? detectWebGL2();
  const config = useMemo(
    () => ({ preset: 'custom' as const, ...COLORS, ...(prefersReducedMotion() ? { speed: 0 } : {}) }),
    [],
  );

  if (webgl) return <AnimatedGradient config={config} />;
  return (
    <div className="gradient-fallback" aria-hidden="true">
      <span className="gradient-fallback__blob" />
      <span className="gradient-fallback__blob" />
      <span className="gradient-fallback__blob" />
    </div>
  );
}
