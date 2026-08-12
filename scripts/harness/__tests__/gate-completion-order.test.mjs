import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function section(markdown, heading, nextHeadingLevel = heading.match(/^#+/)?.[0].length ?? 3) {
  const start = markdown.indexOf(heading);
  if (start === -1) throw new Error(`missing heading: ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const next = rest.search(new RegExp(`^#{1,${nextHeadingLevel}}\\s`, 'm'));
  return next === -1 ? rest : rest.slice(0, next);
}

describe('GATE-COMPLETE transition ownership', () => {
  it('judges an active completion-ready task before Phase 5 archives the task atomically', () => {
    const catalogue = section(read('.agents/specs/gate-catalogue.md'), '### GATE-COMPLETE');
    const workflow = read('.agents/rules/spec-workflow.md');
    const execution = section(read('.agents/rules/backlog-execution.md'), '## Completion Steps', 2);
    const orchestrator = section(
      read('.agents/skills/backlog-execution-orchestrator/SKILL.md'),
      '### Phase 5 — Completion',
    );

    expect(catalogue).toContain('active task path');
    expect(catalogue).toContain('completion-ready');
    expect(catalogue).not.toContain('Tasks file archived to');
    expect(catalogue).not.toContain('Tasks section updated to reflect archived path');

    expect(workflow).toContain('| `verifying`             | `.agents/spec-docs/active/`');
    expect(workflow).toContain('| `done`                  | `.agents/spec-docs/done/`');
    expect(execution).toContain('set `status: done`');
    expect(execution).toContain('Move the file');
    expect(execution).toContain('SAME commit');
    expect(orchestrator).toContain('status change and the file move are **one commit**');
  });
});
