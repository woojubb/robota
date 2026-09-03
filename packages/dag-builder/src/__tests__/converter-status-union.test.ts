import { describe, expect, it } from 'vitest';

import { fromDagWorkflowFile } from '../dag-workflow-converter.js';
import { dagDefinitionFromParsedFile } from '../parsed-dag-file.js';

import type { IDagWorkflowFile, TDagDefinitionStatus } from '@robota-sdk/dag-core';

/**
 * DAG-002 — a value produced outside its own union, laundered by a cast.
 *
 * `fromDagWorkflowFile` returned `status: (companion?.status ?? 'active') as TDagDefinitionStatus`.
 * `TDagDefinitionStatus` is `'draft' | 'published' | 'deprecated'` (`dag-core/types/domain.ts:2`) and
 * `'active'` is not a member of it. The companion's own `status` field is ALREADY typed as
 * `TDagDefinitionStatus` (`workflow-file.ts:83`), so the cast could never have been needed for the
 * companion branch — it existed solely to make the default compile.
 *
 * The consequence is not cosmetic. Any workflow imported without a companion produced a definition
 * carrying a status the domain type says cannot exist, and every downstream `switch` over the union
 * fell through it. Nothing failed, which is why it survived.
 */
const STATUSES: readonly TDagDefinitionStatus[] = ['draft', 'published', 'deprecated'];

function emptyWorkflowFile(): IDagWorkflowFile {
  return {
    last_node_id: 0,
    last_link_id: 0,
    nodes: [],
    links: [],
    groups: [],
    config: {},
    extra: {},
    version: 0.4,
  };
}

describe('fromDagWorkflowFile produces a status inside its own union (DAG-002)', () => {
  it('a workflow file with NO companion gets a real domain status', () => {
    // Against the defect this is `'active'` — a value `TDagDefinitionStatus` does not contain.
    const definition = fromDagWorkflowFile(emptyWorkflowFile());
    expect(STATUSES).toContain(definition.status);
  });

  it("defaults to 'draft' — an imported file has not been published by anyone", () => {
    expect(fromDagWorkflowFile(emptyWorkflowFile()).status).toBe('draft');
  });

  it('a companion status is carried through unchanged', () => {
    // The branch the cast was never needed for: the companion field is already typed as the union.
    const definition = fromDagWorkflowFile(emptyWorkflowFile(), {
      dagId: 'd',
      version: 2,
      status: 'published',
      nodes: {},
    });
    expect(definition.status).toBe('published');
  });
});

describe('dagDefinitionFromParsedFile is the one import adapter (DAG-002)', () => {
  it('passes a definition file through unchanged (as a decoded copy, issue #2077)', () => {
    const definition = { dagId: 'd', version: 1, status: 'draft', nodes: [], edges: [] };
    expect(dagDefinitionFromParsedFile(definition)).toEqual(definition);
  });

  it('converts a workflow file', () => {
    expect(dagDefinitionFromParsedFile(emptyWorkflowFile()).dagId).toBe('unknown');
  });

  it('THROWS on a shape that is neither, rather than casting it onward', () => {
    // Both open-coded copies this replaces ended in a bare `as` here, so an unrecognised file was
    // handed to the runtime wearing a type it did not have and failed later, somewhere else, as
    // something else. Naming it at the boundary is the whole point of having one boundary.
    expect(() => dagDefinitionFromParsedFile({ something: 'else' })).toThrow(/Not a DAG file/);
    expect(() => dagDefinitionFromParsedFile(null)).toThrow(/Not a DAG file/);
  });
});

describe('the import boundary rejects a status the domain type cannot hold (DAG-002)', () => {
  it('names the offending value and the legal set', () => {
    // The scan cannot see this one: `status: 'active'` written into an UNTYPED object literal, then
    // serialized. `dag-cli node`'s example generator did exactly that and printed the result for the
    // user to save — found by review, on a file this PR never touched. A static check over casts was
    // never going to reach data that arrives at runtime, and files written by older versions are
    // already out there, so the boundary that now owns every import owns this too.
    expect(() =>
      dagDefinitionFromParsedFile({
        dagId: 'd',
        version: 1,
        status: 'active',
        nodes: [],
        edges: [],
      }),
    ).toThrow(/status.*draft.*published.*deprecated.*'active'/s);
  });

  it('accepts every legal status', () => {
    for (const status of STATUSES) {
      expect(
        dagDefinitionFromParsedFile({ dagId: 'd', version: 1, status, nodes: [], edges: [] })
          .status,
      ).toBe(status);
    }
  });

  it('accepts a definition with no status at all rather than inventing one', () => {
    // Absent is not invalid — only a PRESENT value outside the union is. Rejecting absence would
    // break every file that predates the field.
    expect(() => dagDefinitionFromParsedFile({ dagId: 'd', version: 1, nodes: [] })).not.toThrow();
  });
});

describe('BOTH import branches are validated, not just one (DAG-002)', () => {
  it('a COMPANION carrying an out-of-union status is rejected too', () => {
    // Review round 3. `assertStatusInUnion` guarded only the legacy-definition branch; the
    // workflow-file branch returned `companion?.status ?? 'draft'` unchecked. `tryReadCompanion` in
    // dag-cli parses a companion with a bare `as IDagRobotaCompanion`, so a pre-DAG-002 companion
    // carrying 'active' would have walked straight through — the same defect, reachable through the
    // branch nobody red-proved. No caller passes a companion TODAY, which is exactly why it had to be
    // closed before DAG-004 routes the eight CLI sites through here with theirs.
    expect(() =>
      dagDefinitionFromParsedFile(emptyWorkflowFile(), {
        dagId: 'd',
        version: 1,
        status: 'active' as never,
        nodes: {},
      }),
    ).toThrow(/'active'/);
  });

  it('a companion with a legal status still passes', () => {
    expect(
      dagDefinitionFromParsedFile(emptyWorkflowFile(), {
        dagId: 'd',
        version: 1,
        status: 'published',
        nodes: {},
      }).status,
    ).toBe('published');
  });
});
