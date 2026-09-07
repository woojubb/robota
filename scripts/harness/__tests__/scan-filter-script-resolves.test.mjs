import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { filterScriptOccurrences } from '../lib/pnpm-invocation.mjs';
import {
  examinedFileCount,
  findFilterScriptFindings,
  hasAllowedReason,
  judgeText,
} from '../scan-filter-script-resolves.mjs';
import { makeTemp } from './make-temp.mjs';

// Fixture package names, never real ones: this test file is itself inside the corpus the scan
// walks, so a real name paired with a script it does not declare would make the scan report its
// own test as a finding.
const SCRIPTS = new Map([
  ['@fixture/tui', new Set(['test', 'test:pty', 'build'])],
  ['@fixture/core', new Set(['test', 'build'])],
]);

const judge = (text) => judgeText(text, 'fixture.md', SCRIPTS);

describe('filterScriptOccurrences', () => {
  it('pairs the filtered package with the script that follows it', () => {
    expect(filterScriptOccurrences('pnpm --filter @fixture/tui test:pty')).toEqual([
      { packages: ['@fixture/tui'], script: 'test:pty', line: 1 },
    ]);
  });

  it('reads the `--filter=<pkg>` form and options in between', () => {
    expect(filterScriptOccurrences('pnpm -r --silent --filter=@fixture/tui build')).toEqual([
      { packages: ['@fixture/tui'], script: 'build', line: 1 },
    ]);
  });

  it('reads `-F`, pnpm’s alias for `--filter`, before the generic option rule eats it', () => {
    expect(filterScriptOccurrences('pnpm -F @fixture/tui build')).toEqual([
      { packages: ['@fixture/tui'], script: 'build', line: 1 },
    ]);
  });

  it('collects every package one invocation selects, sharing its single script', () => {
    expect(
      filterScriptOccurrences('pnpm --filter @fixture/tui --filter @fixture/core test'),
    ).toEqual([{ packages: ['@fixture/tui', '@fixture/core'], script: 'test', line: 1 }]);
  });

  it('takes the token after `run` as the script, never `run` itself', () => {
    expect(filterScriptOccurrences('pnpm --filter @fixture/tui run build')).toEqual([
      { packages: ['@fixture/tui'], script: 'build', line: 1 },
    ]);
  });

  it('strips prose punctuation glued to the script by the sentence around it', () => {
    expect(filterScriptOccurrences('run `pnpm --filter @fixture/tui build`.')[0].script).toBe(
      'build',
    );
  });

  it('reports the line the command sits on', () => {
    expect(filterScriptOccurrences('a\nb\npnpm --filter @fixture/tui build')[0].line).toBe(3);
  });

  it('ignores a pnpm invocation with no filter at all', () => {
    expect(filterScriptOccurrences('pnpm build')).toEqual([]);
  });
});

describe('judgeText', () => {
  it('reports a resolved package that does not declare the script', () => {
    expect(judge('pnpm --filter @fixture/core test:pty')).toEqual([
      {
        file: 'fixture.md',
        line: 1,
        package: '@fixture/core',
        script: 'test:pty',
        detail: '@fixture/core declares no `test:pty` script.',
      },
    ]);
  });

  it('accepts a script the package declares', () => {
    expect(judge('pnpm --filter @fixture/tui test:pty')).toEqual([]);
  });

  it('judges every package a multi-filter invocation selects', () => {
    const findings = judge('pnpm --filter @fixture/tui --filter @fixture/core test:pty');
    expect(findings.map((finding) => finding.package)).toEqual(['@fixture/core']);
  });

  it('validates `test` as a script rather than skipping it as a sub-command', () => {
    expect(judge('pnpm --filter @fixture/tui test')).toEqual([]);
    expect(judge('pnpm --filter @fixture/absent test')).toEqual([]);
    const scripts = new Map([['@fixture/notests', new Set(['build'])]]);
    expect(judgeText('pnpm --filter @fixture/notests test', 'f.md', scripts)).toHaveLength(1);
  });

  it('skips pnpm sub-commands that are not package scripts', () => {
    for (const sub of ['exec tsx x.ts', 'add zod', 'install', 'publish', 'dlx tsx']) {
      expect(judge(`pnpm --filter @fixture/core ${sub}`)).toEqual([]);
    }
  });

  it('skips a command token that is not script-shaped', () => {
    expect(judge('pnpm --filter @fixture/core build/test')).toEqual([]);
    expect(judge('pnpm --filter @fixture/core build:bun:${os}')).toEqual([]);
    expect(judge('pnpm --filter @fixture/core \\\n  build')).toEqual([]);
  });

  it('leaves an unresolvable filter token to the two guards that own that question', () => {
    expect(judge('pnpm --filter @fixture/never-existed test:pty')).toEqual([]);
    expect(judge('pnpm --filter <pkg> test:pty')).toEqual([]);
  });

  it('skips selectors, which name a set rather than a package', () => {
    for (const selector of ['!@fixture/core', './packages/**', '@fixture/*', '@fixture/core...']) {
      expect(judge(`pnpm --filter ${selector} test:pty`)).toEqual([]);
    }
  });
});

describe('the escape hatch', () => {
  it('exempts the occurrence when the line carries a reason', () => {
    expect(
      judge(
        'pnpm --filter @fixture/core test:pty <!-- allow-undeclared-script: quoting the defect -->',
      ),
    ).toEqual([]);
  });

  it('exempts nothing when the marker carries no reason', () => {
    expect(judge('pnpm --filter @fixture/core test:pty <!-- allow-undeclared-script: -->')).toEqual(
      [
        {
          file: 'fixture.md',
          line: 1,
          package: '@fixture/core',
          script: 'test:pty',
          detail: '@fixture/core declares no `test:pty` script.',
        },
      ],
    );
  });

  it('reads the reason on the marker’s own line, never across the newline', () => {
    expect(hasAllowedReason('allow-undeclared-script:')).toBe(false);
    expect(hasAllowedReason('allow-undeclared-script: because the record is history')).toBe(true);
    expect(hasAllowedReason('nothing here')).toBe(false);
  });
});

describe('findFilterScriptFindings', () => {
  const seed = () => {
    const root = makeTemp('robota-2660-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    mkdirSync(path.join(root, 'packages/core'), { recursive: true });
    writeFileSync(
      path.join(root, 'packages/core/package.json'),
      JSON.stringify({ name: '@fixture/core', scripts: { build: 'x' } }),
    );
    return root;
  };

  it('reports a live document and counts what it read', () => {
    const root = seed();
    writeFileSync(path.join(root, 'guide.md'), 'pnpm --filter @fixture/core test:pty\n');
    const findings = findFilterScriptFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'guide.md', package: '@fixture/core' });
    expect(examinedFileCount()).toBe(1);
  });

  it('excludes immutable historical records, on the predicate ghost-package-refs owns', () => {
    const root = seed();
    mkdirSync(path.join(root, '.agents/spec-docs/done'), { recursive: true });
    writeFileSync(
      path.join(root, '.agents/spec-docs/done/old.md'),
      'pnpm --filter @fixture/core test:pty\n',
    );
    expect(findFilterScriptFindings(root)).toEqual([]);
    expect(examinedFileCount()).toBe(0);
  });

  it('resets the examined counter per run rather than accumulating across runs', () => {
    const root = seed();
    writeFileSync(path.join(root, 'a.md'), 'nothing\n');
    findFilterScriptFindings(root);
    expect(examinedFileCount()).toBe(1);
    findFilterScriptFindings(root);
    expect(examinedFileCount()).toBe(1);
  });

  it('throws on a root without the workspace instead of certifying an empty pass', () => {
    const root = makeTemp('robota-2660-bare-');
    execFileSync('git', ['init', '-q'], { cwd: root });
    expect(() => findFilterScriptFindings(root)).toThrow(/packages/);
  });
});
