import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Issue #2470: the standing-authorization policy has ONE owner (`backlog-execution.md`) and two
 * routing consumers. The three drifted — the rule named recommendation auto-approval as a standing
 * authorization example while the pipeline skill stopped on every FAIL for a fresh confirmation — so
 * this contract holds them to one text: the owner defines the route, the consumers cite it and do
 * not contradict it.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

const RULE = '.agents/rules/backlog-execution.md';
const PIPELINE = '.agents/skills/backlog-pipeline/SKILL.md';
const ORCHESTRATOR = '.agents/skills/backlog-execution-orchestrator/SKILL.md';
const SECTION = 'Validated recommendations and bounded gate-FAIL corrections';
const MARKER = '<!-- standing-authorization-contract: bounded gate-FAIL correction -->';

describe('standing-authorization contract (issue #2470)', () => {
  it('the rule owns the route: section, marker, and all four boundedness conditions', () => {
    const rule = read(RULE);
    expect(rule).toContain(`#### ${SECTION}`);
    expect(rule).toContain(MARKER);
    for (const condition of [
      'named failed criteria',
      'preserves the already approved scope and design',
      'independently re-judged',
      'cannot advance until the re-run returns PASS',
    ]) {
      expect(rule).toContain(condition);
    }
    // The exclusions stay direct-user decisions, stated in the same section.
    const section = rule.slice(rule.indexOf(`#### ${SECTION}`));
    for (const exclusion of [
      'widens scope',
      'policy or',
      'product direction',
      'published contract',
      'user-authored document',
      'protected-branch merge',
    ]) {
      expect(section).toContain(exclusion);
    }
  });

  it('both routing consumers cite the owner section and neither restates or contradicts it', () => {
    for (const consumer of [PIPELINE, ORCHESTRATOR]) {
      const text = read(consumer);
      expect(text, consumer).toContain(`backlog-execution.md\` § "${SECTION}"`);
      expect(text, consumer).toContain('bounded gate-FAIL correction');
      // Restating the conditions would create a second owner; only the rule enumerates them.
      expect(text, consumer).not.toContain('cannot advance until the re-run returns PASS');
    }
    const pipeline = read(PIPELINE);
    // The contradiction the issue observed: a stop-for-confirmation on EVERY fail.
    expect(pipeline).not.toMatch(/Re-run only after user confirms fix/);
    expect(pipeline).toMatch(/recorded standing authorization/);
  });
});
