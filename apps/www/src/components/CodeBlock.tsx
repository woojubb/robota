'use client';

import { useState } from 'react';

export function CodeBlock({
  code,
  label,
  copyLabel,
  copiedLabel,
  failureLabel,
}: {
  code: string;
  label: string;
  copyLabel: string;
  copiedLabel: string;
  failureLabel: string;
}) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="home-code">
      <div className="home-code-bar">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-label={`${copyLabel}: ${label}`}>
          {status === 'copied' ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre tabIndex={0} aria-label={label}>
        <code>{code}</code>
      </pre>
      <span className="sr-only" role="status">
        {status === 'failed' ? failureLabel : status === 'copied' ? copiedLabel : ''}
      </span>
    </div>
  );
}
