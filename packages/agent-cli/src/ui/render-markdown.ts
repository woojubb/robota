import { marked } from 'marked';
import type { Renderer } from 'marked';
// @ts-expect-error — marked-terminal has no type declarations
import TerminalRenderer from 'marked-terminal';

const ANSI_RED = '\u001b[31m';
const ANSI_GREEN = '\u001b[32m';
const ANSI_CYAN = '\u001b[36m';
const ANSI_DIM = '\u001b[2m';
const ANSI_RESET = '\u001b[0m';
const CODE_BLOCK_INDENT = '    ';
const ZERO_COLOR = '0';

interface IRenderMarkdownOptions {
  color?: boolean;
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

function colorizeDiffLine(line: string, color: boolean): string {
  if (!color) {
    return line;
  }
  if (line.startsWith('+')) {
    return `${ANSI_GREEN}${line}${ANSI_RESET}`;
  }
  if (line.startsWith('-')) {
    return `${ANSI_RED}${line}${ANSI_RESET}`;
  }
  if (line.startsWith('@@')) {
    return `${ANSI_CYAN}${line}${ANSI_RESET}`;
  }
  if (line.startsWith('diff ') || line.startsWith('index ')) {
    return `${ANSI_DIM}${line}${ANSI_RESET}`;
  }
  return line;
}

function renderDiffCodeBlock(code: string, color: boolean): string {
  const body = code
    .split('\n')
    .map((line) => `${CODE_BLOCK_INDENT}${colorizeDiffLine(line, color)}`)
    .join('\n');
  return `${body}\n\n`;
}

function createTerminalRenderer(color: boolean): Renderer {
  const renderer = new TerminalRendererConstructor(undefined, { ignoreIllegals: true });
  const renderCode = renderer.code.bind(renderer);

  renderer.code = (code: string, language: string | undefined, escaped: boolean): string => {
    if (isDiffLanguage(language)) {
      return renderDiffCodeBlock(code, color);
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
    renderer: createTerminalRenderer(shouldUseColor(options.color)),
  });
  return typeof result === 'string' ? result.trimEnd() : md;
}
