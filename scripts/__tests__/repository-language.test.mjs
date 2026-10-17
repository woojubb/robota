import { describe, expect, it } from 'vitest';

import { findLanguageViolations, isLocalizationData } from '../harness/check-repository-language.mjs';

// Built from code points so this test file itself stays free of Hangul.
const HANGUL_WORD = String.fromCodePoint(0xd55c, 0xae00);
const HANGUL_JAMO = String.fromCodePoint(0x3131);

describe('repository language check', () => {
  it('flags Hangul in code, comments and documentation, with the line', () => {
    const files = {
      'packages/a/src/index.ts': `const label = 'ok';\nconst greeting = '${HANGUL_WORD}';\n`,
      'packages/a/src/note.ts': `// ${HANGUL_JAMO} comment\n`,
      'docs/guide.md': `# Guide\n\n${HANGUL_WORD}\n`,
    };
    const violations = findLanguageViolations(Object.keys(files), (file) => files[file]);
    expect(violations.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'packages/a/src/index.ts:2',
      'packages/a/src/note.ts:1',
      'docs/guide.md:3',
    ]);
  });

  it.each([
    'apps/www/src/messages/ko.json',
    'apps/www/src/messages/home/ko.json',
    'packages/agent-framework/src/memory/locales/ko.json',
    'content/ko/getting-started/README.md',
    'apps/blog/src/content/blog/ko/post.md',
    'packages/agent-cli/docs/README-KO.md',
    'packages/agent-ui-terminal/src/__tests__/__fixtures__/korean-text.json',
  ])('allows Korean in localization data: %s', (file) => {
    expect(isLocalizationData(file)).toBe(true);
    expect(findLanguageViolations([file], () => HANGUL_WORD)).toEqual([]);
  });

  it.each([
    'apps/www/src/components/homeCopy.ts',
    'apps/www/src/messages/ko.ts',
    'packages/agent-ui-terminal/src/__tests__/__fixtures__/korean-text.ts',
    'research/notes/ko.md',
    'README.md',
  ])('treats %s as code or documentation, not localization data', (file) => {
    expect(isLocalizationData(file)).toBe(false);
  });

  it('skips files that are not text', () => {
    expect(findLanguageViolations(['assets/font.otf'], () => undefined)).toEqual([]);
  });
});
