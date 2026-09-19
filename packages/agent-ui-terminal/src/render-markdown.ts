import { marked } from 'marked';
// @ts-expect-error — marked-terminal has no type declarations
import TerminalRenderer from 'marked-terminal';

import { sanitizeTerminalText } from './sanitize-terminal-text.js';
import { isInteractiveColorTerminal } from './terminal-capabilities.js';
import {
  DARK_THEME,
  diffRowStyles,
  markdownRendererOptions,
  syntaxHighlightTheme,
} from './theme/index.js';

import type { IDiffRowStyles, ITuiTheme } from './theme/index.js';
import type { Renderer } from 'marked';

const CODE_BLOCK_INDENT = '    ';

interface IRenderMarkdownOptions {
  color?: boolean;
  codeBlockWidth?: number;
  /**
   * SCREEN-2002: the resolved theme. Absent ⇒ the `dark` built-in, which is byte-identical to what
   * this renderer produced before themes existed.
   */
  theme?: ITuiTheme;
  /** SCREEN-2002: `false` renders code blocks as plain indented text, with no highlight SGR. */
  syntaxHighlighting?: boolean;
  /**
   * CLI-2004: flatten tables to `Header: value` sentences. A box-drawn grid is unreadable aloud —
   * a reader announces the rules, not the relationship between a heading and its cell.
   */
  screenReader?: boolean;
}

interface ITerminalRendererOptions {
  code?: (text: string) => string;
}

interface IHighlightOptions {
  ignoreIllegals?: boolean;
  /** The cli-highlight theme marked-terminal forwards; absent ⇒ its red/green defaults. */
  theme?: Record<string, (text: string) => string>;
}

type TTerminalRendererConstructor = new (
  options?: ITerminalRendererOptions | Record<string, (text: string) => string>,
  highlightOptions?: IHighlightOptions,
) => Renderer;

const TerminalRendererConstructor = TerminalRenderer as TTerminalRendererConstructor;

function shouldUseColor(option: boolean | undefined): boolean {
  if (option !== undefined) {
    return option;
  }
  return isInteractiveColorTerminal();
}

function isDiffLanguage(language: string | undefined): boolean {
  return language?.trim().toLowerCase() === 'diff';
}

function styleAddedOrRemovedDiffRow(
  line: string,
  rowWidth: number,
  color: boolean,
  styles: IDiffRowStyles,
): string {
  const row = `${CODE_BLOCK_INDENT}${line}`.padEnd(rowWidth);
  if (!color) {
    return row.trimEnd();
  }
  if (line.startsWith('+')) return styles.added(row);
  if (line.startsWith('-')) return styles.removed(row);
  return row.trimEnd();
}

function colorizeDiffLine(
  line: string,
  color: boolean,
  rowWidth: number,
  styles: IDiffRowStyles,
): string {
  if (line.startsWith('+') || line.startsWith('-')) {
    return styleAddedOrRemovedDiffRow(line, rowWidth, color, styles);
  }
  const row = `${CODE_BLOCK_INDENT}${line}`;
  if (!color) {
    return row;
  }
  if (line.startsWith('@@')) return styles.hunk(row);
  if (line.startsWith('diff ') || line.startsWith('index ')) return styles.meta(row);
  return row;
}

function resolveDiffRowWidth(lines: readonly string[], requestedWidth: number | undefined): number {
  const minimumWidth = lines.reduce(
    (maxWidth, line) => Math.max(maxWidth, CODE_BLOCK_INDENT.length + line.length),
    0,
  );
  if (requestedWidth === undefined) {
    return minimumWidth;
  }
  return Math.max(minimumWidth, requestedWidth);
}

function renderDiffCodeBlock(
  code: string,
  color: boolean,
  codeBlockWidth: number | undefined,
  styles: IDiffRowStyles,
): string {
  const lines = code.split('\n');
  const rowWidth = resolveDiffRowWidth(lines, codeBlockWidth);
  const body = lines.map((line) => colorizeDiffLine(line, color, rowWidth, styles)).join('\n');
  return `${body}\n\n`;
}

/**
 * CLI-2004 — flatten a table to `Header: value` lines.
 *
 * The cell and row hooks tag their output with separators marked's own renderers never emit, so the
 * table hook can recover the grid it was given. Reconstructing it from the RENDERED strings is the
 * alternative, and those already carry the SGR the inline renderers added.
 */
const CELL_MARK = '\u0000';
const ROW_MARK = '\u0001';

function splitTableCells(row: string): string[] {
  const cells = row.split(ROW_MARK).join('').split(CELL_MARK);
  // The trailing separator leaves one empty tail entry; the cells themselves may legitimately be ''.
  return cells.slice(0, -1);
}

function installTableFlattening(renderer: Renderer): void {
  renderer.tablecell = (content: string): string => `${content}${CELL_MARK}`;
  renderer.tablerow = (content: string): string => `${content}${ROW_MARK}`;
  renderer.table = (header: string, body: string): string => {
    const headers = splitTableCells(header);
    const rows = body
      .split(ROW_MARK)
      .filter((row) => row.length > 0)
      .map((row) => splitTableCells(`${row}${ROW_MARK}`));
    if (headers.length === 0 || rows.length === 0) return '';
    const blocks = rows.map((cells) =>
      headers.map((head, index) => `${head}: ${cells[index] ?? ''}`).join('\n'),
    );
    // A blank line between rows: the row boundary is the only structure left to hear.
    return `${blocks.join('\n\n')}\n\n`;
  };
}

function createTerminalRenderer(
  color: boolean,
  codeBlockWidth: number | undefined,
  screenReader: boolean,
  theme: ITuiTheme,
  syntaxHighlighting: boolean,
): Renderer {
  // SCREEN-2002: both dependencies are told what to colour with. Left to their own defaults, a
  // daltonized theme would still get green/red code blocks from cli-highlight's own theme.
  const renderer = new TerminalRendererConstructor(markdownRendererOptions(theme.markdown), {
    ignoreIllegals: true,
    theme: syntaxHighlightTheme(theme.syntax),
  });
  const renderCode = renderer.code.bind(renderer);
  const styles = diffRowStyles(theme);

  renderer.code = (code: string, language: string | undefined, escaped: boolean): string => {
    if (isDiffLanguage(language)) {
      return renderDiffCodeBlock(code, color, codeBlockWidth, styles);
    }
    // Highlighting off: the block renders as plain indented text, the shape the diff path uses.
    if (!syntaxHighlighting) {
      return `${code
        .split('\n')
        .map((line) => `${CODE_BLOCK_INDENT}${line}`)
        .join('\n')}\n\n`;
    }
    return renderCode(code, language, escaped);
  };

  if (screenReader) installTableFlattening(renderer);

  return renderer;
}

/**
 * Render markdown to a terminal-formatted string with colors, bold, etc.
 * Returns the rendered string (may include ANSI escape codes).
 */
export function renderMarkdown(md: string, options: IRenderMarkdownOptions = {}): string {
  // SEC-019 (issue #2022): the untrusted string is sanitized BEFORE parsing, never after. The
  // renderer ADDS ANSI — colours, bold, code-block framing — so filtering its output would strip the
  // repository's own presentation along with the attacker's. Filtering its input removes what
  // arrived from outside and leaves what is generated after.
  //
  // This is the choke point every render path shares (MessageList, StreamingIndicator,
  // ToolDiffBlock), which is why it is here rather than at each of the three.
  const safe = sanitizeTerminalText(md);
  const result = marked.parse(safe, {
    renderer: createTerminalRenderer(
      shouldUseColor(options.color),
      options.codeBlockWidth,
      options.screenReader === true,
      options.theme ?? DARK_THEME,
      options.syntaxHighlighting !== false,
    ),
  });
  return typeof result === 'string' ? result.trimEnd() : safe;
}
