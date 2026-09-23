/**
 * Issue #2317 — the wire payload carries the two context members the child reads, not the parent's
 * whole `ILoadedContext`.
 *
 * `agentsFileEntries` and `projectNotesFileEntries` carry the full `content` of every AGENTS.md and
 * CLAUDE.md the parent loaded, and nothing in the child read them. These test the PROJECTION's
 * behaviour, not its type: `return context` typechecks against the narrow type (excess properties
 * are assignable), so only the exact key-set assertion fails on a pass-through.
 */

import { describe, expect, it } from 'vitest';

import { projectParentContext } from '../parent-context-projection.js';

import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

function parentContext(): IInProcessSubagentRunnerDeps['context'] {
  return {
    agentsMd: '# AGENTS',
    projectNotesMd: '# CLAUDE',
    memoryMd: '# MEMORY',
    taskContext: 'active task',
    compactInstructions: 'compact this way',
    agentsFileEntries: [{ filePath: '/p/AGENTS.md', content: 'whole file text', contentHash: 'a' }],
    projectNotesFileEntries: [
      { filePath: '/p/CLAUDE.md', content: 'whole file text', contentHash: 'b' },
    ],
  };
}

describe('issue #2317: the projected parent context', () => {
  it('carries the two members the child actually reads', () => {
    const projected = projectParentContext(parentContext());
    expect(projected.agentsMd).toBe('# AGENTS');
    expect(projected.projectNotesMd).toBe('# CLAUDE');
  });

  it('does not carry the per-file entries — whole file contents nothing in the child reads', () => {
    const projected = projectParentContext(parentContext()) as {
      agentsFileEntries?: unknown;
      projectNotesFileEntries?: unknown;
    };
    expect(projected.agentsFileEntries).toBeUndefined();
    expect(projected.projectNotesFileEntries).toBeUndefined();
  });

  it('drops the members nothing reads, rather than passing the object through', () => {
    // The assertion a `return context` implementation fails.
    expect(Object.keys(projectParentContext(parentContext())).sort()).toEqual([
      'agentsMd',
      'projectNotesMd',
    ]);
  });
});
