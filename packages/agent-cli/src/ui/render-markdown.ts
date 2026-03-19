/**
 * Convert markdown text to terminal-formatted ANSI string.
 * Uses marked + marked-terminal for rendering.
 */

import { marked } from 'marked';
// @ts-expect-error — marked-terminal has no type declarations
import TerminalRenderer from 'marked-terminal';

// Configure marked once at module load
marked.setOptions({
  renderer: new TerminalRenderer(),
});

/**
 * Render markdown to a terminal-formatted string with colors, bold, etc.
 * Returns the rendered string (may include ANSI escape codes).
 */
export function renderMarkdown(md: string): string {
  const result = marked.parse(md);
  return typeof result === 'string' ? result.trimEnd() : md;
}
