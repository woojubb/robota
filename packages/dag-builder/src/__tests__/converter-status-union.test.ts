import { describe, expect, it } from 'vitest';

import { fromDagWorkflowFile } from '../dag-workflow-converter.js';

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
