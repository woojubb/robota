import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { collectOrchestrationMapFindings, dispatchedAgents } from '../scan-orchestration-map.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-orchestration-map.mjs', import.meta.url));
// HARNESS-052: the scan under test now fails closed on an absent governed tree, so the copy needs
// the shared `requireGovernedTree` helper alongside it.
const GOVERNED_TREE_MODULE = fileURLToPath(new URL('../governed-tree.mjs', import.meta.url));
const FRONTMATTER_MODULE = fileURLToPath(new URL('../frontmatter.mjs', import.meta.url));

const GREEN_MAP = `# Orchestration Map

| Agent | Role |
| ----- | ---- |
| fixture-worker | worker |
`;

const GREEN_AGENT = `---
name: fixture-worker
---

Worker agent.
`;

async function createFixture(files = {}) {
  const root = makeTemp('robota-orchestration-map-');
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, 'utf8');
  }
  return root;
}

describe('collectOrchestrationMapFindings', () => {
  it('passes when every agent is listed in the map', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
    });

    expect(collectOrchestrationMapFindings(root)).toEqual({ mapMissing: false, findings: [] });
  });

  it('reports a missing map (RED)', async () => {
    const root = await createFixture({
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
    });

    expect(collectOrchestrationMapFindings(root)).toEqual({ mapMissing: true, findings: [] });
  });

  it('flags an agent absent from the map (RED)', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
      '.claude/agents/unlisted-agent.md': '---\nname: unlisted-agent\n---\n\nNew agent.\n',
    });

    const { mapMissing, findings } = collectOrchestrationMapFindings(root);
    expect(mapMissing).toBe(false);
    expect(findings).toEqual([
      'agent "unlisted-agent" (.claude/agents/unlisted-agent.md) has no row in the Orchestration Map — add one (role, signal, pipeline). A mention in prose or inside a diagram is not a listing.',
    ]);
  });

  /**
   * HARNESS-052 sub-shape A. "Listed in the Orchestration Map" was proved by `mapText.includes(name)`
   * — satisfied by the name in prose, inside a fenced mermaid diagram, in a footnote, or as a
   * SUBSTRING of another agent's name. Each case below is a map where the agent is genuinely absent
   * from every registry table while the old rule reported it listed.
   */
  it('does not accept a mention in prose or inside a diagram as a listing', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md':
        `${GREEN_MAP}\nThe fixture-guardian agent runs after the worker.\n\n` +
        '```mermaid\ngraph TD\n  W[fixture-worker] --> G[fixture-guardian]\n```\n',
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
      '.claude/agents/fixture-guardian.md': '---\nname: fixture-guardian\n---\n\nGuardian.\n',
    });

    const { findings } = collectOrchestrationMapFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('fixture-guardian');
  });

  it('does not accept another agent’s row satisfying a name that is its substring', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
      // `fixture-work` is a substring of the listed `fixture-worker`.
      '.claude/agents/fixture-work.md': '---\nname: fixture-work\n---\n\nAnother agent.\n',
    });

    const { findings } = collectOrchestrationMapFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('fixture-work"');
  });

  it('accepts a row whether the name is backticked, bolded or bare', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md':
        '# Map\n\n| Agent | Role |\n| ----- | ---- |\n| `a-one` | worker |\n' +
        '| **a-two** | guardian |\n| a-three | orchestrator |\n',
      '.claude/agents/a-one.md': '---\nname: a-one\n---\n',
      '.claude/agents/a-two.md': '---\nname: a-two\n---\n',
      '.claude/agents/a-three.md': '---\nname: a-three\n---\n',
    });

    expect(collectOrchestrationMapFindings(root).findings).toEqual([]);
  });

  it('falls back to the filename when the agent has no name frontmatter (RED)', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/nameless.md': 'An agent definition without frontmatter.\n',
    });

    const { findings } = collectOrchestrationMapFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('agent "nameless"');
  });

  /**
   * HARNESS-046 — the agent name must come from the FRONTMATTER block, not from the first `^name:`
   * line anywhere in the file. The forked `/^name:\s*(\S+)$/m` regex was unanchored to the block, so
   * a `name:` inside a body example (agent definitions routinely quote frontmatter samples) silently
   * became the identity the map is checked against.
   */
  it('ignores a `name:` line that lives in the BODY, not the frontmatter', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/body-name.md': [
        'An agent definition whose frontmatter is absent.',
        '',
        'Its body shows a sample block:',
        '',
        'name: impostor-agent',
        '',
      ].join('\n'),
    });

    const { findings } = collectOrchestrationMapFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain('agent "body-name"');
    expect(findings[0]).not.toContain('impostor-agent');
  });

  it('reads a quoted frontmatter name', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/fixture-worker.md': '---\nname: "fixture-worker"\n---\n\nWorker agent.\n',
    });

    expect(collectOrchestrationMapFindings(root)).toEqual({ mapMissing: false, findings: [] });
  });

  /**
   * HARNESS-052. This case used to assert the opposite — "passes when there is no agents directory
   * at all" — which is the audited defect written down as a requirement. The map is checked AGAINST
   * the agent definitions, so with none there is nothing to check and "every agent is listed" is
   * true of the empty set. The missing MAP was already an error; the missing SUBJECT was not.
   */
  it('throws when there is no agents directory at all', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
    });

    expect(() => collectOrchestrationMapFindings(root)).toThrow(/\.claude\/agents/);
  });
});

describe('scan-orchestration-map CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script — and the frontmatter parser it imports — into the fixture's
  // scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-orchestration-map.mjs');
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
    copyFileSync(GOVERNED_TREE_MODULE, path.join(path.dirname(scriptCopy), 'governed-tree.mjs'));
    copyFileSync(FRONTMATTER_MODULE, path.join(path.dirname(scriptCopy), 'frontmatter.mjs'));
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

  it('exits 0 with a pass message on a green fixture', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
    });

    const result = runScan(scriptCopy, root);
    expect(result.stdout).toContain('orchestration-map scan passed.');
    expect(result.status).toBe(0);
  });

  it('exits 1 when an agent is missing from the map (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
      '.claude/agents/unlisted-agent.md': '---\nname: unlisted-agent\n---\n\nNew agent.\n',
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('orchestration-map scan: FINDINGS');
    expect(result.stderr).toContain('agent "unlisted-agent"');
  });

  it('exits 1 with the dedicated message when the map itself is missing (RED)', async () => {
    const { root, scriptCopy } = await createCliFixture({
      '.claude/agents/fixture-worker.md': GREEN_AGENT,
    });

    const result = runScan(scriptCopy, root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'orchestration-map scan: .agents/specs/orchestration-map.md is missing.',
    );
  });
});

describe('the registry must agree with the wiring it records', () => {
  // The scan asked only whether each AGENT has a row — never whether the pipeline USING one names
  // it. So a dispatch could be added and the map left describing the world before it, which is the
  // drift a registry whose stated purpose is "mechanically kept current" is most likely to suffer.
  // Measured twice on 2026-08-01 in #1546. This shipped once with no regression case, and its own
  // review said so; these are that case.
  const AGENTS = ['finding-depth-triager', 'proposal-reviewer'];

  it('reads an imperative dispatch, in the shapes the skills are written in', () => {
    expect(dispatchedAgents('Dispatch `finding-depth-triager` on the findings.', AGENTS)).toEqual([
      'finding-depth-triager',
    ]);
    // Bold, and a sentence ending in emphasis — the shape that glued two sentences together and hid
    // the dispatch behind the NEXT sentence's exclusion.
    expect(
      dispatchedAgents(
        '**Also dispatch `finding-depth-triager` on the problem statement, before the recommendation is formed.** The depth verdict asks whether the problem is the real one.',
        AGENTS,
      ),
    ).toEqual(['finding-depth-triager']);
    // Wrapped across lines, as these documents are written.
    expect(
      dispatchedAgents('hand the finding to\n`proposal-reviewer` for a verdict.', AGENTS),
    ).toEqual(['proposal-reviewer']);
  });

  it('survives an agent name carrying regex metacharacters', () => {
    // The name is interpolated into a pattern. Unescaped, a stray `(` throws — and it would take
    // down the scan for EVERY skill, not just that agent, because one throw ends the run. The
    // convention guard checks only that `name` is present, never that it is a safe charset, so this
    // is reachable from an ordinary typo in frontmatter.
    expect(() => dispatchedAgents('Dispatch `a(b` now.', ['a(b'])).not.toThrow();
    expect(dispatchedAgents('Dispatch `a(b` now.', ['a(b'])).toEqual(['a(b']);
    // And a metacharacter must not silently widen the match either.
    expect(dispatchedAgents('Dispatch `axb` now.', ['a.b'])).toEqual([]);
  });

  it('does not read a reference, or a word that merely contains a verb', () => {
    // A guard that demands a map edit for prose nobody dispatched from is one that gets switched off.
    expect(dispatchedAgents('`proposal-reviewer` owns the verdict.', AGENTS)).toEqual([]);
    expect(
      dispatchedAgents('This skill handles retries and reports to `proposal-reviewer`.', AGENTS),
      '"handles" anchored the hand-to idiom',
    ).toEqual([]);
    expect(dispatchedAgents('The reviewer is `proposal-reviewer`.', AGENTS)).toEqual([]);
  });
});
