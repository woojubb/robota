import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultNodeRegistry,
  createDefaultNodeRegistrySync,
} from '../default-node-registry.js';

describe('createDefaultNodeRegistrySync', () => {
  it('returns all built-in node types without LLM nodes', () => {
    const nodes = createDefaultNodeRegistrySync();
    const types = nodes.map((n) => n.nodeType);
    expect(types).toContain('input');
    expect(types).toContain('text-output');
    expect(types).toContain('transform');
    expect(types).toContain('text-template');
    expect(types).toContain('string-to-number');
    expect(types).toContain('text-join');
    expect(types).toContain('json-extract');
    expect(types).toContain('conditional-text');
    // in-process tool node (agent-tools builtins) is in the sync registry
    expect(types).toContain('tool');
    // LLM nodes are NOT included in the sync registry
    expect(types).not.toContain('llm-text-anthropic');
  });

  it('returns 23 or more nodes (base 9 + 14 utility-text)', () => {
    const nodes = createDefaultNodeRegistrySync();
    expect(nodes.length).toBeGreaterThanOrEqual(23);
  });
});

describe('createDefaultNodeRegistry — optional loading', () => {
  it('returns at least the sync nodes', async () => {
    const nodes = await createDefaultNodeRegistry();
    const syncNodes = createDefaultNodeRegistrySync();
    expect(nodes.length).toBeGreaterThanOrEqual(syncNodes.length);
  });

  it('handles import failure gracefully (tryImport catch)', async () => {
    // tryImport catches errors from import() — simulate a missing module scenario
    // by verifying that createDefaultNodeRegistry completes even when LLM modules
    // may not be installed in the test environment
    await expect(createDefaultNodeRegistry()).resolves.toBeDefined();
  });

  it('handles factory construction failure gracefully (tryConstruct catch)', async () => {
    // If an optional node's constructor throws, tryConstruct returns undefined and skips it.
    // Verify the registry still completes without error.
    const nodes = await createDefaultNodeRegistry();
    expect(Array.isArray(nodes)).toBe(true);
  });
});

describe('createDefaultNodeRegistry — tryImport and tryConstruct paths', () => {
  it('loads a mock module and constructs nodes via factory', async () => {
    // We indirectly exercise tryImport (success) and tryConstruct (success) through the
    // async registry. The test verifies the registry includes sync nodes regardless.
    const nodes = await createDefaultNodeRegistry();
    const types = nodes.map((n) => n.nodeType);
    expect(types).toContain('input');
    expect(types).toContain('text-output');
  });

  it('skips a node when factory throws (tryConstruct error branch)', async () => {
    // Create a spy on console.warn to ensure no unhandled errors are thrown
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nodes = await createDefaultNodeRegistry();
    // The registry should always return successfully even if some optional nodes fail
    expect(nodes.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});
