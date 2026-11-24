import { useEffect, useState } from 'react';

/** Copies `text` to the clipboard and announces the result to screen readers. */
export function CopyButton({ text, label = 'Copiar', className = 'button button--ghost button--sm' }: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('error');
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={copy}>
        {state === 'copied' ? 'Copiado!' : label}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied' ? 'Copiado para a área de transferência' : state === 'error' ? 'Não foi possível copiar' : ''}
      </span>
    </>
  );
}
