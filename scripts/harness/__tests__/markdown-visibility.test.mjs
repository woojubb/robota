import { describe, expect, it } from 'vitest';

import { visibleMarkdown } from '../markdown-visibility.mjs';

describe('markdown visibility projection', () => {
  it('excludes raw HTML blocks, preserves code-span literals, and maps visible lines to raw offsets', () => {
    const source = [
      '<pre>',
      '## Hidden',
      '</pre>',
      '',
      '`<!--` is literal code',
      '## Visible',
      'body  ',
    ].join('\n');

    const projection = visibleMarkdown(source, true);
    const headingIndex = projection.lines.indexOf('## Visible');

    expect(projection.lines).not.toContain('## Hidden');
    expect(projection.lines).toContain('`<!--` is literal code');
    expect(projection.source).toBe(source);
    expect(
      source.slice(
        projection.lineStarts[projection.rawIndices[headingIndex]],
        projection.lineStarts[projection.rawIndices[headingIndex + 1]],
      ),
    ).toBe('## Visible\n');
  });
});
