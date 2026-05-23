'use client';

import { useRef, useState, type ReactNode } from 'react';

interface CodeBlockProps {
  children: ReactNode;
  className?: string;
}

export function CodeBlock({ children, className }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = preRef.current?.textContent ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
      <pre ref={preRef} className={className} style={{ margin: 0 }}>
        {children}
      </pre>
      <button
        onClick={handleCopy}
        aria-label="Copy code"
        style={{
          position: 'absolute',
          top: '0.5rem',
          right: '0.5rem',
          padding: '0.25rem 0.6rem',
          fontSize: '0.75rem',
          fontFamily: 'inherit',
          background: 'rgba(255,255,255,0.08)',
          color: copied ? '#22c55e' : '#7b7a95',
          border: '1px solid #252540',
          borderRadius: '0.25rem',
          cursor: 'pointer',
          transition: 'color 0.15s, background 0.15s',
          lineHeight: 1.5,
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
