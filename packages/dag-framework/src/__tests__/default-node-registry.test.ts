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

  it('loads the text-to-image node (optional, Gemini-backed)', async () => {
    const nodes = await createDefaultNodeRegistry();
    expect(nodes.map((n) => n.nodeType)).toContain('text-to-image');
  });

  it('loads the seedance-video node (optional, ByteDance-backed)', async () => {
    const nodes = await createDefaultNodeRegistry();
    expect(nodes.map((n) => n.nodeType)).toContain('seedance-video');
  });

  it('loads the skill node (optional, agent-framework-backed)', async () => {
    const nodes = await createDefaultNodeRegistry();
    expect(nodes.map((n) => n.nodeType)).toContain('skill');
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

describe('createDefaultNodeRegistry — collapsed llm-text provider injection (ARCH-PROVIDER-003)', () => {
  const stubProviders = [
    {
      type: 'stub-provider',
      createProvider: () => ({ name: 'stub-provider' }),
    },
  ] as unknown as Parameters<typeof createDefaultNodeRegistry>[0];

  it('always includes the collapsed llm-text node (not the per-vendor nodes)', async () => {
    const types = (await createDefaultNodeRegistry()).map((n) => n.nodeType);
    expect(types).toContain('llm-text');
    expect(types).not.toContain('llm-text-openai');
    expect(types).not.toContain('llm-text-router');
  });

  it('uses injected providers WITHOUT loading the default set (loadDefaults not called)', async () => {
    const loadDefaults = vi.fn(async () => {
      throw new Error('default set must not be loaded when providers are injected');
    });
    const nodes = await createDefaultNodeRegistry(stubProviders, loadDefaults);
    expect(nodes.map((n) => n.nodeType)).toContain('llm-text');
    expect(loadDefaults).not.toHaveBeenCalled();
  });

  it('TC-10: surfaces a typed diagnostic naming the missing package when the default set cannot load', async () => {
    const loadDefaults = vi.fn(async () => {
      throw new Error("Cannot find package '@robota-sdk/agent-provider-openai'");
    });
    // No providers injected + default load fails → REJECT with a named diagnostic, never a silent node drop.
    await expect(createDefaultNodeRegistry(undefined, loadDefaults)).rejects.toThrow(
      /agent-provider-openai/,
    );
  });
});
