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
    <div className="relative mb-6">
      <pre ref={preRef} className={className ? `${className} m-0` : 'm-0'}>
        {children}
      </pre>
      <button
        onClick={handleCopy}
        aria-label="Copy code"
        className={`absolute right-2 top-2 cursor-pointer rounded border border-[#252540] bg-[rgba(255,255,255,0.08)] px-[0.6rem] py-1 [font-family:inherit] text-[0.75rem] leading-normal transition-[color,background] duration-150 ${
          copied ? 'text-[#22c55e]' : 'text-[#7b7a95]'
        }`}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}
