import { describe, expect, it } from 'vitest';

import { extractLocalLinks } from '../check-llms-txt.mjs';

describe('extractLocalLinks', () => {
  it('extracts repo-relative markdown link targets', () => {
    const markdown =
      '- [core](packages/agent-core/README.md): x\n- [guide](content/guide/providers.md)';
    expect(extractLocalLinks(markdown)).toEqual([
      'packages/agent-core/README.md',
      'content/guide/providers.md',
    ]);
  });

  it('ignores http(s) links and pure anchors', () => {
    const markdown = '[npm](https://npmjs.com/x) [sec](#section) [ok](llms.txt)';
    expect(extractLocalLinks(markdown)).toEqual(['llms.txt']);
  });

  it('strips anchor fragments from local targets', () => {
    expect(extractLocalLinks('[spec](packages/agent-core/docs/SPEC.md#run-concurrency)')).toEqual([
      'packages/agent-core/docs/SPEC.md',
    ]);
  });

  it('returns an empty list when there are no links', () => {
    expect(extractLocalLinks('# no links here')).toEqual([]);
  });
});
