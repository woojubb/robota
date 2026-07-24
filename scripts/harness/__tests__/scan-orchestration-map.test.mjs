import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectOrchestrationMapFindings } from '../scan-orchestration-map.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-orchestration-map.mjs', import.meta.url));

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
  const root = await mkdtemp(path.join(tmpdir(), 'robota-orchestration-map-'));
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
      'agent "unlisted-agent" (.claude/agents/unlisted-agent.md) is not listed in the Orchestration Map — add it (role, signal, pipeline).',
    ]);
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

  it('passes when there is no agents directory at all', async () => {
    const root = await createFixture({
      '.agents/specs/orchestration-map.md': GREEN_MAP,
    });

    expect(collectOrchestrationMapFindings(root)).toEqual({ mapMissing: false, findings: [] });
  });
});

describe('scan-orchestration-map CLI', () => {
  // The scan anchors its default root at `<script dir>/../..`, so the CLI is exercised by copying
  // the (unmodified) script into the fixture's scripts/harness/ and running that copy.
  async function createCliFixture(files) {
    const root = await createFixture(files);
    const scriptCopy = path.join(root, 'scripts/harness/scan-orchestration-map.mjs');
    mkdirSync(path.dirname(scriptCopy), { recursive: true });
    copyFileSync(SCAN_SCRIPT, scriptCopy);
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
