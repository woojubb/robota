import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../render-markdown.js';

const ANSI_RED = '\u001b[31m';
const ANSI_GREEN = '\u001b[32m';

describe('renderMarkdown', () => {
  it('renders diff fenced code blocks with addition and removal colors', () => {
    const output = renderMarkdown(
      ['Before', '', '```diff', '- const oldValue = true;', '+ const newValue = true;', '```'].join(
        '\n',
      ),
      { color: true },
    );

    expect(output).toContain(`${ANSI_RED}- const oldValue = true;`);
    expect(output).toContain(`${ANSI_GREEN}+ const newValue = true;`);
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
