import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  examinedDocumentCount,
  examinedSourceFileCount,
  findConflictMarkerFindings,
} from '../scan-conflict-markers.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-conflict-markers.mjs', import.meta.url));

const GREEN_AGENTS_MD = '# AGENTS\n\nAll guidance here is rule-conforming.\n';
const GREEN_RULE_MD = '# Rule\n\nUse strict types everywhere.\n';

async function createFixture(files = {}) {
  const root = makeTemp('robota-conflict-markers-');
  // HARNESS-052: the scan now also looks for LITERAL git conflict debris in the source trees, and
  // fails closed when one is absent — so a fixture must provide them, empty, to represent a clean
  // tree. Their absence means "could not read", which is deliberately not the same as "clean".
  for (const dir of ['packages', 'apps', 'scripts']) mkdirSync(path.join(root, dir));
  const defaults = {
    'AGENTS.md': GREEN_AGENTS_MD,
    '.agents/rules/example.md': GREEN_RULE_MD,
    '.agents/skills/example/SKILL.md': '# Skill\n\nDo the work properly.\n',
  };
  for (const [relativePath, content] of Object.entries({ ...defaults, ...files })) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

/**
 * HARNESS-052. This scan is registered as `conflict-markers` and checked only for contradictory
 * GUIDANCE in three markdown trees. Falsified 2026-07-26: a literal `<<<<<<< HEAD` / `=======` /
 * `>>>>>>> develop` block appended to `packages/agent-core/src/index.ts` left it printing
 * `conflict marker scan passed.`, and no other harness scan detected it either — a `✓
 * conflict-markers` line in the merge-gate summary was evidence for a check nobody performed.
 */
describe('literal git conflict debris', () => {
  it.each(['<<<<<<< HEAD', '=======', '>>>>>>> develop'])('flags %s in source', async (marker) => {
    const root = await createFixture();
    writeFileSync(path.join(root, 'packages', 'a.ts'), `const x = 1;\n${marker}\n`, 'utf8');
    const findings = findConflictMarkerFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ line: 2 });
  });

  it('does not flag a markdown rule of seven equals signs used as a heading underline', async () => {
    const root = await createFixture();
    // A real conflict marker occupies the whole line; `======= text` after it is not one.
    writeFileSync(path.join(root, 'packages', 'a.ts'), 'const sep = "=======x";\n', 'utf8');
    expect(findConflictMarkerFindings(root)).toEqual([]);
  });

  it('FAILS CLOSED when a governed source tree is absent', async () => {
    const root = makeTemp('robota-conflict-bare-');
    expect(() => findConflictMarkerFindings(root)).toThrow(/governed tree\(s\) absent/);
  });
});

describe('findConflictMarkerFindings', () => {
  it('passes a clean harness-prose fixture', async () => {
    const root = await createFixture();
    expect(findConflictMarkerFindings(root)).toEqual([]);
  });

  it('flags fallback/workaround advocacy prose (RED, pattern class 1)', async () => {
    const root = await createFixture({
      '.agents/rules/example.md': '# Rule\n\nOn error, fallback to the default value.\n',
    });

    const findings = findConflictMarkerFindings(root);
    expect(findings).toEqual([
      {
        file: '.agents/rules/example.md',
        line: 3,
        text: 'On error, fallback to the default value.',
      },
    ]);
  });

  it('flags hierarchy-implying agent naming (RED, pattern class 2)', async () => {
    const root = await createFixture({
      '.agents/skills/example/SKILL.md': '# Skill\n\nAsk the sub-agent to finish the task.\n',
    });

    const findings = findConflictMarkerFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.agents/skills/example/SKILL.md');
  });

  it('flags a violating AGENTS.md line (RED, root file target)', async () => {
    const root = await createFixture({
      'AGENTS.md': '# AGENTS\n\nUse a temporary workaround for now.\n',
    });
    expect(findConflictMarkerFindings(root)).toHaveLength(1);
  });

  it('skips allowlisted definitional/prohibitional lines', async () => {
    const root = await createFixture({
      '.agents/rules/example.md':
        '# Rule\n\nProhibited: main agent, sub-agent (hierarchy naming).\n' +
        'rg -n "any/unknown may|fallback to|temporary workaround" .agents\n',
    });
    expect(findConflictMarkerFindings(root)).toEqual([]);
  });

  it('ignores non-markdown files and untargeted directories', async () => {
    const root = await createFixture({
      '.agents/rules/notes.txt': 'fallback to the default\n',
      'docs/guide.md': 'fallback to the default\n',
    });
    expect(findConflictMarkerFindings(root)).toEqual([]);
  });
});

describe('scan-conflict-markers CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files = {}) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-conflict-markers.mjs');
    mkdirSync(path.dirname(scriptCopy), { recursive: true });
    copyFileSync(SCAN_SCRIPT, scriptCopy);
    // The root resolver is the shared owner (issue #2413); the copy needs it and what it imports.
    for (const shared of [
      'shared.mjs',
      'git-base-ref-resolution.mjs',
      'manifest-change-classification.mjs',
    ]) {
      copyFileSync(
        fileURLToPath(new URL(`../${shared}`, import.meta.url)),
        path.join(path.dirname(scriptCopy), shared),
      );
    }
    return { root, scriptCopy };
  }

  function runScan(scriptCopy, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [scriptCopy], { cwd, encoding: 'utf8' });
      return { status: 0, stdout };
    } catch (error) {
      return { status: error.status, stdout: `${error.stdout ?? ''}` };
    }
  }

  it('exits 0 with a pass message on a clean fixture', async () => {
    const { root, scriptCopy } = await createCliFixture();
    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('conflict marker scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a violating fixture (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/rules/example.md': '# Rule\n\nJust fallback to the old behavior.\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('conflict marker scan failed:');
    expect(result.stdout).toContain('.agents/rules/example.md:3');
  });
});

describe('the examined-size counters measure BOTH walks, and only this run (HARNESS-057)', () => {
  /**
   * This scan has two subjects of very different sizes — source across `packages`/`apps`/`scripts`,
   * and the governance markdown — and the first version of the `::examined::` line reported the
   * smaller one as the whole subject (154 against 3898 on the real tree). Review caught it; nothing
   * mechanical would have. These cases are that mechanism. (#1684 review)
   */
  it('counts each walk against its own subject, not one against both', async () => {
    const root = await createFixture({
      // The SOURCE walk: three files it reads, one it must skip by extension, one by directory.
      'packages/foo/index.ts': 'export const a = 1;\n',
      'packages/foo/data.json': '{}\n',
      'apps/bar/main.mjs': 'export const b = 2;\n',
      'packages/foo/logo.png': 'not source\n',
      'packages/foo/node_modules/dep/index.ts': 'export const skipped = true;\n',
      // The DOCUMENT walk: one more beside the three the fixture always writes.
      '.agents/rules/second.md': '# Second\n\nMore guidance.\n',
    });

    findConflictMarkerFindings(root);

    expect(examinedSourceFileCount(), 'the source walk was miscounted').toBe(3);
    expect(examinedDocumentCount(), 'the document walk was miscounted').toBe(4);
  });

  it('RESETS both counters between runs', async () => {
    // A holder that is not reset reports the largest run it ever saw, and the smaller run is where
    // an inherited number would be believed.
    const big = await createFixture({
      'packages/foo/a.ts': 'export const a = 1;\n',
      'packages/foo/b.ts': 'export const b = 2;\n',
      '.agents/rules/extra.md': '# Extra\n\nText.\n',
    });
    const small = await createFixture({});

    findConflictMarkerFindings(big);
    expect(examinedSourceFileCount()).toBe(2);
    expect(examinedDocumentCount()).toBe(4);

    findConflictMarkerFindings(small);

    expect(examinedSourceFileCount(), 'the source count carried over').toBe(0);
    expect(examinedDocumentCount(), 'the document count carried over').toBe(3);
  });
});
