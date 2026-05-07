import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../render-markdown.js';

const ANSI_RED = '\u001b[31m';
const ANSI_GREEN = '\u001b[32m';
const ANSI_DARK_RED_BACKGROUND = '\u001b[48;5;52m';
const ANSI_DARK_GREEN_BACKGROUND = '\u001b[48;5;22m';
const ANSI_RESET = '\u001b[0m';
const CODE_BLOCK_INDENT = '    ';

describe('renderMarkdown', () => {
  it('renders diff fenced code blocks with addition and removal colors', () => {
    const output = renderMarkdown(
      ['Before', '', '```diff', '- const oldValue = true;', '+ const newValue = true;', '```'].join(
        '\n',
      ),
      { color: true },
    );

    expect(output).toContain(`${ANSI_DARK_RED_BACKGROUND}${ANSI_RED}`);
    expect(output).toContain(`${CODE_BLOCK_INDENT}- const oldValue = true;`);
    expect(output).toContain(`${ANSI_DARK_GREEN_BACKGROUND}${ANSI_GREEN}`);
    expect(output).toContain(`${CODE_BLOCK_INDENT}+ const newValue = true;`);
  });

  it('pads added and removed diff rows before applying background colors', () => {
    const codeBlockWidth = 24;
    const removedRow = `${CODE_BLOCK_INDENT}- removed`.padEnd(codeBlockWidth);
    const addedRow = `${CODE_BLOCK_INDENT}+ added`.padEnd(codeBlockWidth);
    const output = renderMarkdown(['```diff', '- removed', '+ added', '```'].join('\n'), {
      color: true,
      codeBlockWidth,
    });

    expect(output).toContain(`${ANSI_DARK_RED_BACKGROUND}${ANSI_RED}${removedRow}${ANSI_RESET}`);
    expect(output).toContain(`${ANSI_DARK_GREEN_BACKGROUND}${ANSI_GREEN}${addedRow}${ANSI_RESET}`);
  });

  it('keeps diff fenced code block content readable when color is disabled', () => {
    const output = renderMarkdown(
      ['```diff', '- removed line', '+ added line', ' unchanged line', '```'].join('\n'),
      { color: false },
    );

    expect(output).toContain('- removed line');
    expect(output).toContain('+ added line');
    expect(output).toContain(' unchanged line');
    expect(output).not.toContain(ANSI_RED);
    expect(output).not.toContain(ANSI_GREEN);
    expect(output).not.toContain(ANSI_DARK_RED_BACKGROUND);
    expect(output).not.toContain(ANSI_DARK_GREEN_BACKGROUND);
  });

  it('keeps regular fenced code blocks as code output', () => {
    const output = renderMarkdown(['```ts', 'const value: string = "ok";', '```'].join('\n'), {
      color: false,
    });

    expect(output).toContain('const value: string = "ok";');
  });

  it('keeps inline markdown formatting readable', () => {
    const output = renderMarkdown('Use **bold** and `code` here.', { color: false });

    expect(output).toContain('bold');
    expect(output).toContain('code');
  });
});
