import { describe, expect, it } from 'vitest';

import { isLegacyDefinitionFormat, isWorkflowFileFormat } from '../dag-workflow-converter.js';
import {
  DagFileDecodeError,
  dagDefinitionFromParsedFile,
  decodeDagFile,
} from '../parsed-dag-file.js';

/**
 * Issue #2077 — the file import adapter is a TOTAL decoder, not a shallow discriminator.
 *
 * Each case here passed the old `isLegacyDefinitionFormat` / `isWorkflowFileFormat` guards (a
 * `dagId` string plus a `nodes` array, or `nodes` + `links` + numeric `version`) and was cast to
 * `IDagDefinition`, so `/workflows validate` threw a `TypeError` iterating it instead of reporting.
 */
const NODE = { nodeId: 'a', nodeType: 'input', dependsOn: [], config: {} };

describe('decodeDagFile is total over the definition format', () => {
  it('names a malformed nested node field by path instead of casting onward', () => {
    const result = decodeDagFile({ dagId: 'd', version: 1, nodes: [{ nodeId: 'a' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.format).toBe('definition');
    expect(result.error.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['nodes[0].nodeType', 'nodes[0].dependsOn', 'nodes[0].config']),
    );
  });

  it('names a malformed edge by path', () => {
    const result = decodeDagFile({ dagId: 'd', version: 1, nodes: [NODE], edges: [{ from: 'a' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toBe('edges[0].to');
  });

  it('rejects a string where nodes must be an array — the old guard already did; a nodes ARRAY of strings it did not', () => {
    const result = decodeDagFile({ dagId: 'd', version: 1, nodes: ['a'] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toBe('nodes[0]');
  });

  it('the throwing form carries the same issues on a typed error', () => {
    let caught: unknown;
    try {
      dagDefinitionFromParsedFile({ dagId: 'd', version: '1', nodes: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DagFileDecodeError);
    if (!(caught instanceof DagFileDecodeError)) return;
    expect(caught.failure.issues[0]?.path).toBe('version');
    expect(caught.message).toMatch(/Malformed DAG definition: version: expected a finite number/);
  });

  it('still reports an unrecognised shape as "Not a DAG file"', () => {
    expect(() => dagDefinitionFromParsedFile({ something: 'else' })).toThrow(/Not a DAG file/);
    expect(() => dagDefinitionFromParsedFile([])).toThrow(/Not a DAG file/);
  });
});

describe('decodeDagFile is total over the workflow-file format', () => {
  const FILE = {
    last_node_id: 1,
    last_link_id: 0,
    version: 0.4,
    nodes: [{ id: 1, type: 'RobotaInput', pos: [0, 0] }],
    links: [],
  };

  it('converts a well-formed workflow file', () => {
    const result = decodeDagFile(FILE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nodes[0]?.nodeType).toBe('input');
  });

  it('names a malformed link tuple by path instead of converting it', () => {
    const result = decodeDagFile({ ...FILE, links: [[1, 1, 0]] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.format).toBe('workflow-file');
      expect(result.error.issues[0]?.path).toBe('links[0]');
    }
  });

  it('names a node with a non-numeric id by path', () => {
    const result = decodeDagFile({ ...FILE, nodes: [{ id: '1', type: 'X', pos: [0, 0] }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.path).toBe('nodes[0].id');
  });
});

describe('the exported format guards are total too (the eight DAG-004 sites branch on them)', () => {
  it('isLegacyDefinitionFormat is false for a definition with a malformed node', () => {
    expect(isLegacyDefinitionFormat({ dagId: 'd', version: 1, nodes: [{ nodeId: 'a' }] })).toBe(
      false,
    );
    expect(isLegacyDefinitionFormat({ dagId: 'd', version: 1, nodes: [NODE] })).toBe(true);
  });

  it('isWorkflowFileFormat is false for a workflow file with a malformed node', () => {
    const base = { last_node_id: 1, last_link_id: 0, version: 0.4, links: [] };
    expect(isWorkflowFileFormat({ ...base, nodes: [{ id: 1 }] })).toBe(false);
    expect(isWorkflowFileFormat({ ...base, nodes: [{ id: 1, type: 'X', pos: [0, 0] }] })).toBe(
      true,
    );
  });
});
