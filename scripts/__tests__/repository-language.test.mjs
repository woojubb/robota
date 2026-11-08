import { describe, expect, it } from 'vitest';

import {
  findLanguageViolations,
  findTrackerReferences,
  isLocalizationData,
} from '../harness/check-repository-language.mjs';

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

// Built from parts so this test file itself carries no tracker reference.
const BACKLOG = ['ARCH', '-040'].join('');
const ISSUE = ['issue', ' #', '3679'].join('');
const STAGE = ['Stage', ' D'].join('');
const PR_NUMBER = ['(#', '3693)'].join('');

describe('tracker reference check', () => {
  it('flags a backlog ID, an issue or PR number and a stage label, with the line', () => {
    const files = {
      'packages/a/src/index.ts': `export const ok = 1;\n// ${BACKLOG}: why this exists\n`,
      'packages/a/src/a.test.ts': `it('keeps the root (${ISSUE})', () => {});\n`,
      'scripts/b.mjs': `// ${STAGE} of the move ${PR_NUMBER}\n`,
      '.github/workflows/ci.yml': `# see ${ISSUE}\n`,
    };
    const violations = findTrackerReferences(Object.keys(files), (file) => files[file]);
    expect(violations.map(({ file, line }) => `${file}:${line}`)).toEqual([
      'packages/a/src/index.ts:2',
      'packages/a/src/a.test.ts:1',
      'scripts/b.mjs:1',
      '.github/workflows/ci.yml:1',
    ]);
  });

  it.each([
    'Hashed with SHA-256 and HMAC-SHA-256, timestamps in ISO-8601, UTF-16 text',
    'Derivation per SLIP-0010; see CWE-377 and ECMA-48, signed with ECDSA-P256',
    'A task file named CLI-BL-001 is user content the test writes',
    'colors #333, #0002 and a hex #1a2b3c; ids a-12 and v3-13 are not backlog IDs',
  ])('allows standards, user content and colors: %s', (line) => {
    expect(findTrackerReferences(['packages/a/src/x.ts'], () => line)).toEqual([]);
  });

  it.each([
    'packages/a/CHANGELOG.md',
    'packages/a/examples/scenarios/run.record.json',
    'packages/a/logs/session.jsonl',
    'scripts/release/__tests__/generate-release-notes.test.mjs',
    'docs/guide.md',
    'ARCHITECTURE.md',
  ])('does not check %s', (file) => {
    expect(findTrackerReferences([file], () => `${BACKLOG} ${ISSUE}`)).toEqual([]);
  });

  it('skips files that are not text', () => {
    expect(findTrackerReferences(['packages/a/font.otf'], () => undefined)).toEqual([]);
  });
});
