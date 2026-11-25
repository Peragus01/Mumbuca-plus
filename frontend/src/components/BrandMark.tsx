type BrandMarkProps = {
  size?: number;
  /** Renders the "Mumbuca+" wordmark next to the mark, with the "+" in Mumbuca yellow. */
  wordmark?: boolean;
  /** With `wordmark`, also renders the "Moeda social de Maricá" subtitle. */
  subtitle?: boolean;
};

/** Official Mumbuca+ logo (petróleo version, MumbucaPlus_petroleo.svg, viewBox 0 0 612 326). */
const LOGO_PATH =
  'M8 126C8 57 53 12 111 12C195 12 235 124 310 124C372 124 433 43 506 43C572 43 604 91 604 171V251C604 286 575 314 539 314H441V146Q441 134 429 134H401Q392 134 385 142L310 224 233 142Q226 134 217 134H185Q171 134 171 148V314H75C38 314 8 285 8 249Z M249 314V248L310 305 370 248V314Z M505 79Q505 72 512 72H522Q529 72 529 79V99H549Q556 99 556 106V116Q556 123 549 123H529V143Q529 150 522 150H512Q505 150 505 143V123H485Q478 123 478 116V106Q478 99 485 99H505Z';
const LOGO_PETROLEO = '#075B57';
const LOGO_CREME = '#FFF6E8';

/**
 * Mumbuca+ logo mark (inline SVG, no external asset), optionally with the wordmark.
 * The petróleo logo sits on a cream tile (the pairing of the official preview) so it
 * stays legible on the dark theme.
 */
export function BrandMark({ size = 32, wordmark = false, subtitle = false }: BrandMarkProps) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="13" fill={LOGO_CREME} />
      {/* 612×326 logo scaled to 38 wide and centered in the 48×48 tile. */}
      <g transform="translate(5 13.9) scale(0.0621)">
        <path fill={LOGO_PETROLEO} fillRule="evenodd" d={LOGO_PATH} />
      </g>
    </svg>
  );

  if (!wordmark) return mark;

  return (
    <span className="brandmark">
      {mark}
      <span className="brandmark__text">
        <span className="brandmark__name" style={{ fontSize: `${Math.round(size * 0.5)}px` }}>
          Mumbuca<span className="brand-plus">+</span>
        </span>
        {subtitle && (
          <>
            <span className="sr-only">, </span>
            <span className="brandmark__subtitle">Moeda social de Maricá</span>
          </>
        )}
      </span>
    </span>
  );
}
