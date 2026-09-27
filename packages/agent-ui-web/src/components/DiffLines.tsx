'use client';

import React from 'react';

import type { IDiffLine } from '@robota-sdk/agent-interface-session';

/**
 * #3288: renders a unified diff already built server-side (the ONE diff builder, in
 * `interactive-session-streaming.ts`) — a tool row's expanded result and the Edit/Write permission
 * prompt both show the SAME diff through this, so approving a change and reviewing it afterwards
 * look identical. This component never computes a diff itself, only displays one.
 */

const DIFF_LINE_STYLE: Record<IDiffLine['type'], string> = {
  add: 'bg-accent/10 text-foreground',
  remove: 'bg-destructive/10 text-foreground',
  context: 'text-muted-foreground',
  hunk: 'text-subtle',
};
const DIFF_LINE_PREFIX: Record<IDiffLine['type'], string> = {
  add: '+ ',
  remove: '- ',
  context: '  ',
  hunk: '',
};

export function DiffLines({ diffLines }: { diffLines: readonly IDiffLine[] }): React.ReactElement {
  return (
    <pre className="overflow-x-auto rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed">
      {diffLines.map((line, index) => (
        // A diff's line order IS its identity — index is a stable, correct key here.
        <div key={index} className={`whitespace-pre ${DIFF_LINE_STYLE[line.type]}`}>
          {`${DIFF_LINE_PREFIX[line.type]}${line.text}`}
        </div>
      ))}
    </pre>
  );
}
