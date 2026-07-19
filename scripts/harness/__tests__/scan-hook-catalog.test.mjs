import { describe, expect, it } from 'vitest';

import {
  computeCatalogDrift,
  extractFunctionBody,
  findFiringEvents,
  findHookCatalogFindings,
  parseDocEvents,
  parseGuideEventTable,
  parseUnionEvents,
} from '../scan-hook-catalog.mjs';

const UNION_SRC = `export type THookEvent =
  | 'PreToolUse'
  | 'Stop'
  | 'SubagentStart'
  | 'WorktreeCreate';`;

/** A doc table listing every union event — the GREEN baseline. */
const DOC_SRC = `## Events

| Event | Timing | Blocking |
| ----- | ------ | -------- |
| \`PreToolUse\` | before | BLOCKING |
| \`Stop\` | after | Informational |
| \`SubagentStart\` | start | Informational |
| \`WorktreeCreate\` | create | Informational |

Inline prose mentioning \`Stop\` must NOT be parsed as a table row.`;

const ALL_EVENTS = ['PreToolUse', 'Stop', 'SubagentStart', 'WorktreeCreate'];

describe('scan-hook-catalog — parsers', () => {
  it('parseUnionEvents extracts the union members', () => {
    expect(parseUnionEvents(UNION_SRC).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('parseDocEvents extracts only table-row events, not inline prose', () => {
    expect(parseDocEvents(DOC_SRC).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it('findFiringEvents resolves a literal-dispatched event (runHooks + hook_event_name)', () => {
    const src = `runHooks(config, 'Stop', { hook_event_name: 'Stop' }, exec);`;
    expect(findFiringEvents(src)).toContain('Stop');
  });

  it('findFiringEvents resolves a variable-dispatched event via the getSubagentHookEvent mapping', () => {
    const src = `function getSubagentHookEvent(e) { return 'SubagentStart'; }
    runHooks(hooks, hookEventName, { hook_event_name: hookEventName }, exec);`;
    expect(findFiringEvents(src)).toContain('SubagentStart');
  });

  it('HARNESS-031: a `return "Event"` OUTSIDE getSubagentHookEvent is NOT a firing site', () => {
    // A stray literal return in an unrelated function must not satisfy the firing check (else deleting the
    // real runHooks call could go undetected). Only the getSubagentHookEvent mapping body counts for (c).
    const stray = `function unrelated() { return 'Stop'; }`;
    expect(findFiringEvents(stray)).not.toContain('Stop');
    // …but the same literal inside the real mapping function DOES count.
    const mapping = `function getSubagentHookEvent(e) { return 'Stop'; }`;
    expect(findFiringEvents(mapping)).toContain('Stop');
  });

  it('extractFunctionBody returns the brace-matched body, or "" when absent', () => {
    expect(extractFunctionBody(`function f(x) { return { a: 1 }; }`, 'f')).toBe(
      '{ return { a: 1 }; }',
    );
    expect(extractFunctionBody(`const y = 1;`, 'f')).toBe('');
  });

  it('parseGuideEventTable reads the Event/Timing table, not the permission-mode table', () => {
    const guide = `## Modes

| Mode | Read | Write |
| ---- | ---- | ----- |
| \`plan\` | deny | deny |
| \`default\` | prompt | prompt |

## Hooks

| Event | Timing | Blocking |
| ----- | ------ | -------- |
| \`PreToolUse\` | before | BLOCKING |
| \`Stop\` | after | Informational |`;
    // Only the hook events — the mode rows (plan/default) must be excluded.
    expect(parseGuideEventTable(guide).sort()).toEqual(['PreToolUse', 'Stop']);
  });

  it('findFiringEvents resolves a variable-dispatched event via a fire*Hook helper call-site', () => {
    const src = `fireWorktreeHook(this.options, 'WorktreeCreate', job, worktree, false);`;
    expect(findFiringEvents(src)).toContain('WorktreeCreate');
  });

  it('findFiringEvents does NOT capture equality comparisons (=== "Event")', () => {
    const src = `if (input.hook_event_name === 'SessionEnd') return input.reason;`;
    expect(findFiringEvents(src)).not.toContain('SessionEnd');
  });
});

describe('scan-hook-catalog — TC-01 drift detection (red → green)', () => {
  const firingAll = [...ALL_EVENTS];

  it('GREEN: no findings when union, doc, and firing all agree', () => {
    expect(
      computeCatalogDrift({
        unionEvents: ALL_EVENTS,
        docEvents: ALL_EVENTS,
        firingEvents: firingAll,
      }),
    ).toEqual([]);
  });

  it('RED (literal-dispatched): dropping `Stop` from the doc FAILs', () => {
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: ALL_EVENTS.filter((e) => e !== 'Stop'),
      firingEvents: firingAll,
    });
    expect(findings.some((f) => f.includes('Stop'))).toBe(true);
  });

  it('RED (variable-dispatched, doc drift): dropping `WorktreeCreate` from the doc FAILs', () => {
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: ALL_EVENTS.filter((e) => e !== 'WorktreeCreate'),
      firingEvents: firingAll,
    });
    expect(findings.some((f) => f.includes('WorktreeCreate'))).toBe(true);
  });

  it('RED (variable-dispatched, mapping drift): renaming the fireWorktreeHook literal FAILs (no firing site)', () => {
    // Simulate the mapping/call-site literal being renamed → WorktreeCreate no longer resolves.
    const renamedFiring = findFiringEvents(
      `fireWorktreeHook(this.options, 'WorktreeCreated', job);`,
    );
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: ALL_EVENTS,
      firingEvents: [...renamedFiring, 'PreToolUse', 'Stop', 'SubagentStart'],
    });
    expect(
      findings.some((f) => f.includes('WorktreeCreate') && f.includes('firing call-site')),
    ).toBe(true);
  });

  it('RED (phantom): a documented event not in the union FAILs', () => {
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: [...ALL_EVENTS, 'Notification'],
      firingEvents: firingAll,
    });
    expect(findings.some((f) => f.includes('Notification') && f.includes('phantom'))).toBe(true);
  });

  it('HARNESS-031 GREEN: guideEvents matching the union adds no findings', () => {
    expect(
      computeCatalogDrift({
        unionEvents: ALL_EVENTS,
        docEvents: ALL_EVENTS,
        firingEvents: firingAll,
        guideEvents: ALL_EVENTS,
      }),
    ).toEqual([]);
  });

  it('HARNESS-031 RED: an event missing from the guide table FAILs', () => {
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: ALL_EVENTS,
      firingEvents: firingAll,
      guideEvents: ALL_EVENTS.filter((e) => e !== 'Stop'),
    });
    expect(findings.some((f) => f.includes('Stop') && f.includes('user guide'))).toBe(true);
  });

  it('HARNESS-031 RED: a phantom event in the guide table FAILs', () => {
    const findings = computeCatalogDrift({
      unionEvents: ALL_EVENTS,
      docEvents: ALL_EVENTS,
      firingEvents: firingAll,
      guideEvents: [...ALL_EVENTS, 'Notification'],
    });
    expect(findings.some((f) => f.includes('Notification') && f.includes('guide'))).toBe(true);
  });

  it('HARNESS-031: guideEvents omitted (null) skips the guide legs — back-compat', () => {
    expect(
      computeCatalogDrift({
        unionEvents: ALL_EVENTS,
        docEvents: ALL_EVENTS,
        firingEvents: firingAll,
      }),
    ).toEqual([]);
  });
});

describe('scan-hook-catalog — live sources are in sync', () => {
  it('the live union, catalog doc, and firing sites currently agree', () => {
    expect(findHookCatalogFindings()).toEqual([]);
  });
});
