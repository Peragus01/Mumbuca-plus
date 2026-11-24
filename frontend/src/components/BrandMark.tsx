/** Mumbuca+ logo mark (inline SVG, no external asset). */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="14" fill="var(--brand)" />
      <path
        d="M12 33V16.5c0-.9 1.1-1.3 1.7-.6L24 27.5l10.3-11.6c.6-.7 1.7-.3 1.7.6V33"
        fill="none"
        stroke="#fff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="37" cy="11" r="6" fill="var(--accent)" />
      <path d="M37 8.2v5.6M34.2 11h5.6" stroke="var(--brand-ink)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
