import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { frontmatterObject as parseFrontmatter } from '../frontmatter.mjs';
import {
  evaluateSpec,
  findCapabilityReachabilityFindings,
} from '../scan-capability-reachability.mjs';

/**
 * HARNESS-030 — the capability-reachability floor (opt-in, explicit-scenario-reference).
 * TC-01: capability + user_execution none/omitted → FAIL; agent-run + existing named scenario → clean.
 * TC-02: capability + agent-run but NO user_execution_scenario named → FAIL.
 * TC-02b: capability + agent-run naming a MISSING/misnamed scenario file → FAIL (the SEC-001-shaped case).
 * TC-03: no `capability: true` → not checked (opt-in, no FP).
 * TC-04: the live done/ tree is GREEN.
 */

// scenarioExists: only these two evidence files "exist" in the fixtures.
const exists = (p) =>
  [
    '.agents/evals/scenarios/selfhost-011-eval-gate-agent-run.md',
    '.agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md',
  ].includes(p);

describe('HARNESS-030 TC-01/02 — declared capability must carry agent-run evidence', () => {
  it('FAILs a capability spec that records no user-execution (none / missing / N/A)', () => {
    expect(
      evaluateSpec({ capability: 'true', user_execution: 'none' }, 'FOO-001.md', exists),
    ).toMatch(/must NOT dodge/);
    expect(evaluateSpec({ capability: 'true' }, 'FOO-001.md', exists)).toMatch(/must NOT dodge/);
    expect(
      evaluateSpec({ capability: 'true', user_execution: 'N/A' }, 'FOO-001.md', exists),
    ).toMatch(/must NOT dodge/);
  });

  it('TC-02: FAILs a capability + agent-run spec that names no user_execution_scenario', () => {
    expect(
      evaluateSpec({ capability: 'true', user_execution: 'agent-run' }, 'NOPE-042.md', exists),
    ).toMatch(/names no 'user_execution_scenario/);
  });

  it('TC-02b: FAILs a capability + agent-run spec whose named scenario file does not exist', () => {
    expect(
      evaluateSpec(
        {
          capability: 'true',
          user_execution: 'agent-run',
          user_execution_scenario: '.agents/evals/scenarios/does-not-exist.md',
        },
        'NOPE-043.md',
        exists,
      ),
    ).toMatch(/does not exist/);
  });

  it('is CLEAN when the named scenario exists — including a CROSS-REFERENCED file (SEC-001 → GUI-007)', () => {
    expect(
      evaluateSpec(
        {
          capability: 'true',
          user_execution: 'agent-run',
          user_execution_scenario: '.agents/evals/scenarios/selfhost-011-eval-gate-agent-run.md',
        },
        'SELFHOST-011-P3.md',
        exists,
      ),
    ).toBeNull();
    // SEC-001's evidence lives under the GUI-007 scenario file — the explicit reference resolves it.
    expect(
      evaluateSpec(
        {
          capability: 'true',
          user_execution: 'agent-run',
          user_execution_scenario:
            '.agents/evals/scenarios/gui-007-cli-served-monitor-agent-run.md',
        },
        'SEC-001-default-loopback-ws-auth.md',
        exists,
      ),
    ).toBeNull();
  });

  it('accepts user_execution: manual without requiring a scenario', () => {
    expect(
      evaluateSpec({ capability: 'true', user_execution: 'manual' }, 'BAR-001.md', exists),
    ).toBeNull();
  });
});

describe('HARNESS-030 TC-03 — opt-in (undeclared specs are not checked)', () => {
  it('does not flag a spec without `capability: true`', () => {
    expect(evaluateSpec({ user_execution: 'none' }, 'FOO-001.md', exists)).toBeNull();
    expect(evaluateSpec({ capability: 'false' }, 'FOO-001.md', exists)).toBeNull();
    expect(evaluateSpec({}, 'FOO-001.md', exists)).toBeNull();
  });
});

describe('HARNESS-030 — helpers + live tree', () => {
  it('parseFrontmatter reads the --- block', () => {
    const fm = parseFrontmatter(
      '---\nstatus: done\ncapability: true\nuser_execution: agent-run\n---\nbody',
    );
    expect(fm.capability).toBe('true');
    expect(fm.user_execution).toBe('agent-run');
  });

  it('parseFrontmatter strips surrounding quotes from a value', () => {
    const fm = parseFrontmatter(
      '---\nuser_execution_scenario: ".agents/evals/scenarios/x.md"\n---\nbody',
    );
    expect(fm.user_execution_scenario).toBe('.agents/evals/scenarios/x.md');
  });

  it('TC-04: the live done/ tree is clean (every declared capability names an existing scenario)', () => {
    expect(findCapabilityReachabilityFindings()).toEqual([]);
  });
});

/**
 * HARNESS-046 — this scan must read frontmatter through the ONE parser (`frontmatter.mjs`), not a
 * forked single-line regex. These drive the scan END-TO-END over a fixture tree, so they stay honest
 * regardless of which parser the scan happens to call.
 *
 * A per-line regex reads a key whose value was wrapped onto the following indented line as the empty
 * string — turning a fully-evidenced capability spec into a false "dodged the gate" gate failure.
 * The wrapping is not hypothetical: prettier (lint-staged's `*.md` formatter) reflows any frontmatter
 * flow array past printWidth into exactly this shape, and `.agents/tasks/` already carries 441
 * `depends_on: [` arrays waiting for the day a scan reads one.
 */
async function createSpecTree(files) {
  const root = makeTemp('robota-capability-reachability-');
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
  }
  return root;
}

const SCENARIO = '.agents/evals/scenarios/harness-046-agent-run.md';

describe('HARNESS-046 — one frontmatter parser (end-to-end over a fixture tree)', () => {
  it('reads a WRAPPED user_execution / user_execution_scenario value (no false "dodge" finding)', async () => {
    const root = await createSpecTree({
      [SCENARIO]: '# agent-run evidence\n',
      '.agents/spec-docs/done/HARNESS-046-wrapped.md': [
        '---',
        'status: done',
        'type: INFRA',
        'tags:',
        '  [',
        '    harness,',
        '    frontmatter,',
        '    formatter-drift,',
        '    verification,',
        '    enforcement-architecture,',
        '  ]',
        'capability: true',
        'user_execution:',
        '  agent-run',
        'user_execution_scenario:',
        `  ${SCENARIO}`,
        '---',
        '',
        '# HARNESS-046',
      ].join('\n'),
    });

    expect(findCapabilityReachabilityFindings(root)).toEqual([]);
  });

  it('still FAILS a wrapped-frontmatter capability spec that really dodges the gate (not weakened)', async () => {
    const root = await createSpecTree({
      '.agents/spec-docs/done/HARNESS-046-dodge.md': [
        '---',
        'status: done',
        'type: INFRA',
        'tags:',
        '  [',
        '    harness,',
        '    frontmatter,',
        '  ]',
        'capability: true',
        'user_execution:',
        '  none',
        '---',
        '',
        '# HARNESS-046 dodge',
      ].join('\n'),
    });

    const findings = findCapabilityReachabilityFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/must NOT dodge/);
  });

  it('still FAILS when the wrapped scenario path does not exist (not weakened)', async () => {
    const root = await createSpecTree({
      '.agents/spec-docs/done/HARNESS-046-missing.md': [
        '---',
        'status: done',
        'type: INFRA',
        'capability: true',
        'user_execution: agent-run',
        'user_execution_scenario:',
        '  .agents/evals/scenarios/does-not-exist.md',
        '---',
        '',
        '# HARNESS-046 missing',
      ].join('\n'),
    });

    const findings = findCapabilityReachabilityFindings(root);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/does not exist/);
  });
});
