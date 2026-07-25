'use client';

import { useEffect, useRef, useState } from 'react';

interface MermaidDiagramProps {
  chart: string;
}

let mermaidInitialized = false;

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!ref.current) return;
      try {
        const mermaid = (await import('mermaid')).default;

        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: 'dark',
            // Mermaid resolves themeVariables at config time into the generated SVG and
            // does not read CSS custom properties, so these must be literal colors. They
            // intentionally mirror the brand design tokens (--background/--accent/etc.);
            // keep them in sync if the palette changes (WEB-015 exception).
            themeVariables: {
              background: '#0a0a0f',
              primaryColor: '#2dd4a7',
              primaryTextColor: '#e8e6f0',
              primaryBorderColor: '#252540',
              lineColor: '#7b7a95',
              secondaryColor: '#1a1a2e',
              tertiaryColor: '#131320',
            },
          });
          mermaidInitialized = true;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);

        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <pre className="mb-6 whitespace-pre-wrap rounded-[0.5rem] border border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.08)] p-4 text-[0.875rem] text-[#ef4444]">
        Mermaid error: {error}
      </pre>
    );
  }

  return (
    <div
      ref={ref}
      role="img"
      aria-label="Mermaid diagram"
      className="mb-6 overflow-x-auto rounded-[0.5rem] border border-[#252540] bg-[#131320] p-4 text-center"
    />
  );
}
