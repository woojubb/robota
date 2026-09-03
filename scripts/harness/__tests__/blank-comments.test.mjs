import { describe, expect, it } from 'vitest';

import { stripComments } from '../check-functional-coverage.mjs';
import { blankComments } from '../lib/blank-comments.mjs';

describe('lib/blank-comments — one offset-preserving owner (issue #2258)', () => {
  it('replaces every comment byte with a space and keeps newlines, so offsets survive', () => {
    const src = 'const a = 1; // trailing\n/* block\n  spanning */ const b = 2;\n';
    const out = blankComments(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.indexOf('const b')).toBe(src.indexOf('const b'));
    expect(out).not.toContain('trailing');
    expect(out).not.toContain('spanning');
  });

  it('leaves a `//` inside a string or regex literal alone', () => {
    const src = "const u = 'http://x'; const r = /\\/dist\\//; // gone\n";
    const out = blankComments(src);
    expect(out).toContain("'http://x'");
    expect(out).toContain('/\\/dist\\//');
    expect(out).not.toContain('gone');
  });

  it('stripComments delegates, so prose about a marker no longer vouches for it', () => {
    const src = '// scriptedSession( is mentioned here only\nconst x = 1;\n';
    const out = stripComments(src);
    expect(out).not.toContain('scriptedSession');
    expect(out.length).toBe(src.length);
    expect(out).toContain('const x = 1;');
  });
});
