import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectMemoryMirrorFindings, examinedFactFileCount } from '../scan-memory-mirror.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-memory-mirror.mjs', import.meta.url));
// HARNESS-052: the scan under test now fails closed on an absent governed tree, so the copy needs
// the shared `requireGovernedTree` helper alongside it.
const GOVERNED_TREE_MODULE = fileURLToPath(new URL('../governed-tree.mjs', import.meta.url));

async function createFixture(files = {}) {
  const root = makeTemp('robota-memory-mirror-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

const GREEN_INDEX = '# Memory Index\n\n- [Fact one](fact-one.md) — the first fact\n';

describe('collectMemoryMirrorFindings', () => {
  /**
   * HARNESS-052. This asserted "passes when no in-repo memory exists yet" — the audited defect
   * written down as a requirement. `memory-mirroring.md` makes the in-repo corpus MANDATORY in this
   * repository, so an absent `.agents/memory/` is a broken checkout, not a repository that has not
   * started one, and "the index and the fact files agree" over no corpus is a claim about nothing.
   */
  it('throws when there is no in-repo memory corpus at all', async () => {
    const root = await createFixture();
    expect(() => collectMemoryMirrorFindings(root)).toThrow(/\.agents\/memory/);
  });

  it('has no branch that treats an absent corpus as clean', async () => {
    // A `if (!existsSync(memDir)) return findings;` sat below the governed-tree check, saying "no
    // in-repo memory yet is allowed" — the same contradiction this change removed from `main()`,
    // left behind in the finder as unreachable code. Unreachable is not harmless: it is a second,
    // opposite answer in one file, and the next reader has no way to know which one binds.
    //
    // This pins the property rather than the absence of the lines: an absent corpus must THROW, and
    // must never come back as an empty finding list, which is what that branch returned.
    const root = await createFixture();
    let returned;
    try {
      returned = collectMemoryMirrorFindings(root);
    } catch {
      returned = undefined;
    }

    expect(
      returned,
      'an absent corpus came back as "no findings" instead of throwing',
    ).toBeUndefined();
  });

  it('passes a consistent index + fact-file pair', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
    });
    expect(collectMemoryMirrorFindings(root)).toEqual([]);
  });

  it('flags a memory dir without a MEMORY.md index (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/fact-one.md': '# Fact one\n',
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual([
      '.agents/memory/ exists but has no MEMORY.md index (every clone needs the index to find facts).',
    ]);
  });

  it('flags a dangling index link to a missing fact file (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual(['MEMORY.md links a missing memory file: fact-one.md']);
  });

  it('flags an orphan fact file the index never links (RED)', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
      '.agents/memory/orphan.md': '# Orphan fact\n',
    });

    const findings = collectMemoryMirrorFindings(root);
    expect(findings).toEqual([
      'memory file not indexed in MEMORY.md (orphan — invisible to other clones): orphan.md',
    ]);
  });

  it('ignores links that point outside the memory dir', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md':
        GREEN_INDEX + '\nSee also [rule](../rules/memory-mirroring.md).\n',
      '.agents/memory/fact-one.md': '# Fact one\n',
    });
    expect(collectMemoryMirrorFindings(root)).toEqual([]);
  });
});

describe('scan-memory-mirror CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-memory-mirror.mjs');
    mkdirSync(path.dirname(scriptCopy), { recursive: true });
    copyFileSync(SCAN_SCRIPT, scriptCopy);
    copyFileSync(GOVERNED_TREE_MODULE, path.join(path.dirname(scriptCopy), 'governed-tree.mjs'));
    return { root, scriptCopy };
  }

  function runScan(scriptCopy, cwd) {
    try {
      const stdout = execFileSync(process.execPath, [scriptCopy], { cwd, encoding: 'utf8' });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      return {
        status: error.status,
        stdout: `${error.stdout ?? ''}`,
        stderr: `${error.stderr ?? ''}`,
      };
    }
  }

  it('fails instead of exiting 0 over a memory tree that is not there', async () => {
    // `main()` carried an early return calling an absent corpus acceptable, contradicting this
    // file's own finder. It exited 0 without reaching the throw, and without printing the examined
    // line every other path prints.
    //
    // The first version of this case copied the script to the FIXTURE ROOT. The script anchors its
    // workspace at `<script dir>/../..`, so from there it judged two directories ABOVE the fixture
    // and passed only because that place has no `.agents/memory` either — an accidental green over
    // a tree it never opened, and the same mistake this pull request had just fixed in the sibling
    // suite. `createCliFixture` already places the copy correctly; using it is the whole fix.
    const { root, scriptCopy } = await createCliFixture({ 'placeholder.txt': 'x\n' });

    const result = runScan(scriptCopy, root);

    expect(result.status, 'the CLI exited 0 over a memory tree it never read').not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/\.agents\/memory/);
  });

  it('exits 0 with a pass message on a consistent fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('memory-mirror scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 and lists findings on a drifting index (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('memory-mirror scan: FINDINGS');
    expect(result.stderr).toContain('MEMORY.md links a missing memory file: fact-one.md');
  });
});

describe('what the mirror scan says it examined', () => {
  it('declares the fact files it walked', async () => {
    const root = await createFixture({
      '.agents/memory/MEMORY.md': GREEN_INDEX,
      '.agents/memory/fact-one.md': '# Fact one\n',
    });

    collectMemoryMirrorFindings(root);

    expect(examinedFactFileCount()).toBe(1);
  });

  it("reports zero after a run that returned early, not the previous run's count", () => {
    // The same correction the sibling scan needed in this change: a holder reset late reports the
    // previous number for a run that examined nothing, and the early returns are exactly those runs.
    return (async () => {
      const withFacts = await createFixture({
        '.agents/memory/MEMORY.md': GREEN_INDEX,
        '.agents/memory/fact-one.md': '# Fact one\n',
      });
      // A root whose memory directory exists but carries NO index: the governed-tree check passes,
      // the missing-index branch returns immediately, and nothing walks a fact file. The first
      // version of this case used an index with no facts beside it, which reaches the walk and sets
      // the count to 0 on its own — it passed with the reset removed, and proved nothing.
      const noIndex = await createFixture({ '.agents/memory/placeholder.txt': 'x\n' });

      collectMemoryMirrorFindings(withFacts);
      collectMemoryMirrorFindings(noIndex);

      expect(
        examinedFactFileCount(),
        'a run that walked no fact file kept the previous count',
      ).toBe(0);
    })();
  });

  it('treats an index with no fact files as clean, which is why the zero must be declared', async () => {
    // The scan itself calls this state correct, so an UNDECLARED zero would redden the whole suite
    // for a tree the scan has no complaint about. That is why `main` attaches a reason.
    const root = await createFixture({ '.agents/memory/MEMORY.md': '# Memory Index\n' });

    expect(collectMemoryMirrorFindings(root)).toEqual([]);
    expect(examinedFactFileCount()).toBe(0);
  });
});
