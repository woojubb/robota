'use client';

import React, { useState } from 'react';

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

// #3288 review SHOULD 3: the server already caps each diff side at 500 lines — this is a second,
// independent fold so a diff that size never renders into the DOM at once either.
const DIFF_FOLD_LINES = 40;
const DIFF_EXPANDED_CAP_LINES = 500;

function DiffLine({ line }: { line: IDiffLine }): React.ReactElement {
  return (
    <div className={`whitespace-pre ${DIFF_LINE_STYLE[line.type]}`}>
      {`${DIFF_LINE_PREFIX[line.type]}${line.text}`}
    </div>
  );
}

export function DiffLines({ diffLines }: { diffLines: readonly IDiffLine[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  if (diffLines.length <= DIFF_FOLD_LINES) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed">
        {diffLines.map((line, index) => (
          // A diff's line order IS its identity — index is a stable, correct key here.
          <DiffLine key={index} line={line} />
        ))}
      </pre>
    );
  }

  const capped = diffLines.slice(0, DIFF_EXPANDED_CAP_LINES);
  const shown = open ? capped : diffLines.slice(0, DIFF_FOLD_LINES);
  return (
    <div className="flex flex-col gap-1">
      <pre className="overflow-x-auto rounded-lg bg-sidebar px-3 py-2 font-mono text-[12.5px] leading-relaxed">
        {shown.map((line, index) => (
          // A diff's line order IS its identity — index is a stable, correct key here.
          <DiffLine key={index} line={line} />
        ))}
      </pre>
      {open && diffLines.length > DIFF_EXPANDED_CAP_LINES && (
        <p className="text-[12px] text-subtle">
          {diffLines.length - DIFF_EXPANDED_CAP_LINES} more lines
        </p>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="self-start text-[12.5px] text-accent hover:underline"
      >
        {open ? 'Show less' : `Show more (${diffLines.length - DIFF_FOLD_LINES} more lines)`}
      </button>
    </div>
  );
}
