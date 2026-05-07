import { marked } from 'marked';
import type { Renderer } from 'marked';
// @ts-expect-error — marked-terminal has no type declarations
import TerminalRenderer from 'marked-terminal';

const ANSI_LIGHT_RED = '\u001b[38;5;210m';
const ANSI_LIGHT_GREEN = '\u001b[38;5;120m';
const ANSI_CYAN = '\u001b[36m';
const ANSI_DIM = '\u001b[2m';
const ANSI_DARK_RED_BACKGROUND = '\u001b[48;5;52m';
const ANSI_DARK_GREEN_BACKGROUND = '\u001b[48;5;22m';
const ANSI_RESET = '\u001b[0m';
const CODE_BLOCK_INDENT = '    ';
const ZERO_COLOR = '0';

interface IRenderMarkdownOptions {
  color?: boolean;
  codeBlockWidth?: number;
}

interface ITerminalRendererOptions {
  code?: (text: string) => string;
}

interface IHighlightOptions {
  ignoreIllegals?: boolean;
}

type TTerminalRendererConstructor = new (
  options?: ITerminalRendererOptions,
  highlightOptions?: IHighlightOptions,
) => Renderer;

const TerminalRendererConstructor = TerminalRenderer as TTerminalRendererConstructor;

function shouldUseColor(option: boolean | undefined): boolean {
  if (option !== undefined) {
    return option;
  }
  if (process.env.NO_COLOR || process.env.FORCE_COLOR === ZERO_COLOR) {
    return false;
  }
  if (process.env.FORCE_COLOR) {
    return true;
  }
  return Boolean(process.stdout.isTTY);
}

function isDiffLanguage(language: string | undefined): boolean {
  return language?.trim().toLowerCase() === 'diff';
}

function styleAddedOrRemovedDiffRow(line: string, rowWidth: number, color: boolean): string {
  const row = `${CODE_BLOCK_INDENT}${line}`.padEnd(rowWidth);
  if (!color) {
    return row.trimEnd();
  }
  if (line.startsWith('+')) {
    return `${ANSI_DARK_GREEN_BACKGROUND}${ANSI_LIGHT_GREEN}${row}${ANSI_RESET}`;
  }
  if (line.startsWith('-')) {
    return `${ANSI_DARK_RED_BACKGROUND}${ANSI_LIGHT_RED}${row}${ANSI_RESET}`;
  }
  return row.trimEnd();
}

function colorizeDiffLine(line: string, color: boolean, rowWidth: number): string {
  if (line.startsWith('+') || line.startsWith('-')) {
    return styleAddedOrRemovedDiffRow(line, rowWidth, color);
  }
  const row = `${CODE_BLOCK_INDENT}${line}`;
  if (!color) {
    return row;
  }
  if (line.startsWith('@@')) {
    return `${ANSI_CYAN}${row}${ANSI_RESET}`;
  }
  if (line.startsWith('diff ') || line.startsWith('index ')) {
    return `${ANSI_DIM}${row}${ANSI_RESET}`;
  }
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
): string {
  const lines = code.split('\n');
  const rowWidth = resolveDiffRowWidth(lines, codeBlockWidth);
  const body = lines.map((line) => colorizeDiffLine(line, color, rowWidth)).join('\n');
  return `${body}\n\n`;
}

function createTerminalRenderer(color: boolean, codeBlockWidth: number | undefined): Renderer {
  const renderer = new TerminalRendererConstructor(undefined, { ignoreIllegals: true });
  const renderCode = renderer.code.bind(renderer);

  renderer.code = (code: string, language: string | undefined, escaped: boolean): string => {
    if (isDiffLanguage(language)) {
      return renderDiffCodeBlock(code, color, codeBlockWidth);
    }
    return renderCode(code, language, escaped);
  };

  return renderer;
}

/**
 * Render markdown to a terminal-formatted string with colors, bold, etc.
 * Returns the rendered string (may include ANSI escape codes).
 */
export function renderMarkdown(md: string, options: IRenderMarkdownOptions = {}): string {
  const result = marked.parse(md, {
    renderer: createTerminalRenderer(shouldUseColor(options.color), options.codeBlockWidth),
  });
  return typeof result === 'string' ? result.trimEnd() : md;
}
