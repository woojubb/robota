/**
 * `SafeText` — the ONE way a string reaches the terminal from this package (#2222).
 *
 * SEC-019 fixed every render site that was found to put untrusted text — model output, tool stdout,
 * file contents, plugin-supplied names — on the terminal through Ink's `<Text>`. Six review rounds
 * found three sites nobody had covered, because "sanitized" was a property of individual lines of
 * code, and a site added later by someone who never read SEC-019 is covered by nothing.
 *
 * This component makes the boundary structural: every string child is passed through
 * `sanitizeTerminalText` before Ink sees it, and the `tui-safe-text-boundary` scan refuses any other
 * module in this package that imports `Text` from `ink` — plain, aliased, or through a namespace.
 * A render site therefore CANNOT put a string on the terminal without passing through here. For the
 * many constant labels this is a no-op; that is the point — the boundary is not "the sites judged
 * to carry untrusted text", because that judgement is what already failed twice.
 *
 * This module is the only permitted importer of Ink's `Text`.
 */

import { Text as InkText } from 'ink';
import React from 'react';

import { sanitizeTerminalText } from './sanitize-terminal-text.js';

import type { ReactNode } from 'react';

type TInkTextProps = React.ComponentProps<typeof InkText>;

function sanitizeChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return sanitizeTerminalText(children);
  if (typeof children === 'number' || typeof children === 'boolean') return children;
  if (children === null || children === undefined) return children;
  if (Array.isArray(children)) return children.map((child) => sanitizeChildren(child));
  // A nested element (another <Text>, a <Box>) sanitizes its own string children on its own render.
  return children;
}

/** Ink's `Text`, with every string child sanitized for the terminal. Same props, same output shape. */
export function SafeText(props: TInkTextProps): React.JSX.Element {
  const { children, ...rest } = props;
  return <InkText {...rest}>{sanitizeChildren(children)}</InkText>;
}

/** Call sites keep writing `<Text>`; the name resolves to the boundary rather than to Ink. */
export { SafeText as Text };
