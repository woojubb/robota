import { describe, expect, it } from 'vitest';

import {
  DEFERS_TO_MIRROR_MAP,
  judgeContexts,
  resolvesCommand,
  scanRequiredCheckLocalReachability,
} from '../scan-required-check-local-reachability.mjs';

const WORLD = {
  scripts: { 'harness:verify:release': 'pnpm build:deps && …', 'harness:scan': 'node …' },
  fileExists: (relative) => relative === 'scripts/harness/scan-promotion-ancestry.mjs',
  excusedByMirrorMap: new Set(['windows-shell']),
};

const judge = (contexts, branch = 'develop') =>
  judgeContexts({ [branch]: contexts }, WORLD).findings;

describe('a named entry point must resolve', () => {
  it('accepts a package script that exists and a file that exists', () => {
    expect(resolvesCommand('pnpm harness:verify:release', WORLD)).toBe(true);
    expect(resolvesCommand('node scripts/harness/scan-promotion-ancestry.mjs', WORLD)).toBe(true);
  });

  it('refuses a plausible name for a script nobody declared', () => {
    // The mistake catalogue once named a scan that EXISTED and was the wrong one, and passed,
    // because only existence was checked. Existence is the weaker property and also the decidable
    // one — but a name that resolves to nothing at all is not even that.
    expect(resolvesCommand('pnpm harness:verify:the-one-i-meant', WORLD)).toBe(false);
    expect(resolvesCommand('node scripts/harness/scan-imaginary.mjs', WORLD)).toBe(false);
  });

  it('refuses a shape it cannot check, rather than passing it', () => {
    // Unknown is not runnable. A command this cannot decide is a command nobody decided.
    expect(resolvesCommand('make verify', WORLD)).toBe(false);
    expect(resolvesCommand('', WORLD)).toBe(false);
  });
});

describe('every required context answers', () => {
  it('refuses a context that declares nothing', () => {
    const findings = judge([{ context: 'quality' }]);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('no-answer');
  });

  it('refuses a context that answers both ways at once', () => {
    const findings = judge([
      {
        context: 'quality',
        local: { entryPoint: 'pnpm harness:scan', notRunnable: 'needs a Windows runner' },
      },
    ]);

    expect(findings[0].kind).toBe('answers-both-ways');
  });

  it('accepts an excuse WITH a reason, because that is an answer', () => {
    // The point of the field. A recorded "no local run can produce this verdict" is a decision; the
    // same state unrecorded is indistinguishable from nobody having looked.
    expect(
      judge([
        {
          context: 'main PR source guard',
          local: {
            notRunnable: 'reads the pull request head ref from GitHub; there is none locally.',
          },
        },
      ]),
    ).toEqual([]);
  });

  it('refuses an excuse with no reason behind it', () => {
    const findings = judge([{ context: 'review-gate', local: { notRunnable: '   ' } }]);

    expect(findings[0].kind).toBe('excused-without-a-reason');
  });

  it('refuses a reason that is not a reason, rather than crashing on it', () => {
    // `true` reads as "yes, not runnable" to a human writing JSON, and it carries no reason at all.
    // Before this it threw on `.trim()`: loud, but a crash is not a verdict, and a scan whose whole
    // subject is telling "I could not check" from "I checked" must not answer with a stack trace.
    for (const value of [true, 1, {}, null]) {
      const findings = judge([{ context: 'review-gate', local: { notRunnable: value } }]);

      expect(findings, `\`${JSON.stringify(value)}\` passed as a reason`).not.toEqual([]);
    }
  });
});

describe('the excuse has one owner, and the two sources must agree', () => {
  it('accepts deferring to the mirror map for a context the mirror map excuses', () => {
    expect(
      judge([{ context: 'windows-shell', local: { notRunnable: DEFERS_TO_MIRROR_MAP } }]),
    ).toEqual([]);
  });

  it('refuses deferring to an owner that carries no entry for it', () => {
    // A pointer at nothing is worse than no pointer: it reads as though a reason was written down
    // somewhere, and the reader who goes looking finds an empty place where one should be.
    const findings = judge([{ context: 'quality', local: { notRunnable: DEFERS_TO_MIRROR_MAP } }]);

    expect(findings[0].kind).toBe('defers-to-an-owner-that-does-not-own-it');
  });

  it('refuses a context the two sources disagree about', () => {
    const findings = judge([
      { context: 'windows-shell', local: { entryPoint: 'pnpm harness:scan' } },
    ]);

    expect(findings.map((f) => f.kind)).toContain('disagrees-with-the-mirror-map');
  });

  it('does not apply the mirror map to a branch it does not speak for', () => {
    // `NOT_MIRRORED` is develop's. Reading it as authority over `main` would refuse a correct
    // declaration — a guard firing on correct work, which is the shape that gets guards suppressed.
    expect(
      judge([{ context: 'windows-shell', local: { entryPoint: 'pnpm harness:scan' } }], 'main'),
    ).toEqual([]);
  });
});

describe('over the declaration this repository actually ships', () => {
  it('finds every required context answered', () => {
    const { findings, examined } = scanRequiredCheckLocalReachability();

    console.log(`::examined:: ${examined} declared required contexts`);
    expect(findings, JSON.stringify(findings, null, 2)).toEqual([]);
    // Fail closed: a declaration this read as empty would satisfy the assertion above vacuously.
    expect(examined).toBeGreaterThan(0);
  });
});
