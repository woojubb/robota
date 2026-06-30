import { describe, it, expect, vi } from 'vitest';

vi.mock('../local-runner/local-node-loader.js', () => ({
  loadLocalNodeDefinitions: vi.fn().mockResolvedValue([]),
}));

import { createCliNodeRegistryWithLocalNodes } from '../local-runner/node-registry.js';

describe('createCliNodeRegistryWithLocalNodes', () => {
  it('returns built-in registry when no local nodes found', async () => {
    const registry = await createCliNodeRegistryWithLocalNodes('/tmp/fake');
    expect(Array.isArray(registry)).toBe(true);
    expect(registry.length).toBeGreaterThan(0);
  });

  it('merges local nodes with built-ins', async () => {
    const { loadLocalNodeDefinitions } = await import('../local-runner/local-node-loader.js');
    vi.mocked(loadLocalNodeDefinitions).mockResolvedValueOnce([
      {
        nodeType: 'my-local-node',
        displayName: 'My Local Node',
        category: 'test',
        inputs: [],
        outputs: [],
        configSchemaDefinition: {},
        taskHandler: { execute: async () => ({ ok: true, output: {} }) },
      } as never,
    ]);

    const registry = await createCliNodeRegistryWithLocalNodes('/tmp/with-local');
    const localNode = registry.find((n) => n.nodeType === 'my-local-node');
    expect(localNode).toBeDefined();
  });

  it('overrides built-in node with same type from local nodes', async () => {
    const { loadLocalNodeDefinitions } = await import('../local-runner/local-node-loader.js');
    vi.mocked(loadLocalNodeDefinitions).mockResolvedValueOnce([
      {
        nodeType: 'input',
        displayName: 'Custom Input',
        category: 'test',
        inputs: [],
        outputs: [],
        configSchemaDefinition: {},
        taskHandler: { execute: async () => ({ ok: true, output: {} }) },
      } as never,
    ]);

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const registry = await createCliNodeRegistryWithLocalNodes('/tmp/override');

    const inputNodes = registry.filter((n) => n.nodeType === 'input');
    // Should have exactly one 'input' node (the local one)
    expect(inputNodes).toHaveLength(1);
    expect(inputNodes[0]?.displayName).toBe('Custom Input');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('overriding'));
    stderrSpy.mockRestore();
  });

  it('passes verbose option to loadLocalNodeDefinitions', async () => {
    const { loadLocalNodeDefinitions } = await import('../local-runner/local-node-loader.js');
    vi.mocked(loadLocalNodeDefinitions).mockResolvedValueOnce([]);
    await createCliNodeRegistryWithLocalNodes('/tmp/fake', { verbose: true });
    expect(loadLocalNodeDefinitions).toHaveBeenCalledWith(
      expect.objectContaining({ verbose: true }),
    );
  });
});
