import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { findConflictMarkerFindings } from '../scan-conflict-markers.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-conflict-markers.mjs', import.meta.url));

const GREEN_AGENTS_MD = '# AGENTS\n\nAll guidance here is rule-conforming.\n';
const GREEN_RULE_MD = '# Rule\n\nUse strict types everywhere.\n';

async function createFixture(files = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'robota-conflict-markers-'));
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
