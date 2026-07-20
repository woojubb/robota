import { describe, expect, it } from 'vitest';

import {
  evaluateSpec,
  findCapabilityReachabilityFindings,
  parseFrontmatter,
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

  it('TC-04: the live done/ tree is clean (every declared capability names an existing scenario)', () => {
    expect(findCapabilityReachabilityFindings()).toEqual([]);
  });
});
