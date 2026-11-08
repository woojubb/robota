import { renderMarkdown } from '../render-markdown.js';
import { useScreenReader } from '../screen-reader-context.js';
import { useSyntaxHighlighting, useTheme } from '../theme/index.js';

import type { IRenderMarkdownOptions } from '../render-markdown.js';

/** What a call site still decides. The three appearance inputs are no longer among them. */
export type TRenderMarkdownExtras = Omit<
  IRenderMarkdownOptions,
  'theme' | 'syntaxHighlighting' | 'screenReader'
>;

/**
 * SCREEN-2002 — markdown rendered with this surface's resolved appearance.
 *
 * The three inputs every render site needs — the theme, the syntax-highlighting setting and
 * screen-reader mode — are bound here instead of at each call. That is a deliberate removal of an
 * obligation rather than a convenience.
 *
 * The obligation was forgotten once and guarded four times. `/theme syntax off` shipped persisting
 * a setting no call site passed, so the command reported success and changed nothing; each guard
 * written afterwards measured a PROXY for "every call site passes it" — the prop appears in the
 * file, the file matched the regex, the identifier occurs N times — and each held for exactly one
 * review round. A binding removes the thing being proxied: there is no per-call-site argument left
 * to forget, and the floor collapses to a single-consumer ratchet (nothing outside this module
 * imports `renderMarkdown`), which is a property rather than a proxy for one.
 *
 * Screen-reader mode is bound too, uniformly. `StreamingIndicator` previously omitted it, which was
 * correct but only incidentally: it returns its collapsed line before reaching any markdown, so the
 * flag never applied. Binding it removes that coincidence as something a reader has to reconstruct.
 */
export function useRenderMarkdown(): (md: string, extras?: TRenderMarkdownExtras) => string {
  const theme = useTheme();
  const syntaxHighlighting = useSyntaxHighlighting();
  const screenReader = useScreenReader();
  return (md, extras = {}) =>
    renderMarkdown(md, { ...extras, theme, syntaxHighlighting, screenReader });
}
