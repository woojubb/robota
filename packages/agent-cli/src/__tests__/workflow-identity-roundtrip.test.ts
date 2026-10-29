import { describe, expect, it } from 'vitest';
import { dagDefinitionFromParsedFile, toDagWorkflowFile } from '@robota-sdk/workflows/builder';

describe('bundled workflow identity', () => {
  it('preserves distinct colon-containing endpoints through a visual file and companion', () => {
    const definition = {
      dagId: 'identity-pairs',
      version: 1,
      status: 'draft',
      nodes: [
        { nodeId: 'a:b', nodeType: 'input', dependsOn: [], config: { text: 'first' } },
        { nodeId: 'c', nodeType: 'text-output', dependsOn: ['a:b'], config: {} },
        { nodeId: 'a', nodeType: 'input', dependsOn: [], config: { text: 'second' } },
        { nodeId: 'b:c', nodeType: 'text-output', dependsOn: ['a'], config: {} },
      ],
      edges: [
        { from: 'a:b', to: 'c', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
        { from: 'a', to: 'b:c', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      ],
    } satisfies Parameters<typeof toDagWorkflowFile>[0];
    const saved = toDagWorkflowFile(definition);
    const restored = dagDefinitionFromParsedFile(saved.workflowFile, saved.companion);
    expect(restored.edges).toEqual(definition.edges);
    expect(restored.nodes.map((node) => node.nodeId)).toEqual(
      definition.nodes.map((node) => node.nodeId),
    );
  });
});
