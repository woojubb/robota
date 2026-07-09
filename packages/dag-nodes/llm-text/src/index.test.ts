import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { INodeExecutionContext } from '@robota-sdk/dag-core';
import type {
  IAIProvider,
  IProviderDefinition,
  IProviderDefinitionConfig,
} from '@robota-sdk/agent-core';
import { LlmTextNodeDefinition } from './index.js';

// Keep the real credential-resolution functions (normalizeProviderConfig / createProviderFromConfig /
// findProviderDefinition / getProviderCredentialRequirement) — only stub the Robota agent so no real
// provider call is made (ARCH-PROVIDER-003 TC-03 / common-mistakes #76).
const mockRun = vi.fn();
vi.mock('@robota-sdk/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-core')>();
  return { ...actual, Robota: vi.fn(() => ({ run: mockRun })) };
});

let capturedConfig: IProviderDefinitionConfig | undefined;

function stubProvider(name: string): IAIProvider {
  return { name } as unknown as IAIProvider;
}

/** Build a stub provider definition — no real SDK, no network. */
function stubDefinition(
  type: string,
  opts: {
    model?: string;
    requiresApiKey?: boolean;
    apiKey?: string;
    allowedModels?: string[];
  } = {},
): IProviderDefinition {
  return {
    type,
    requiresApiKey: opts.requiresApiKey ?? false,
    defaults: {
      model: opts.model ?? `${type}-default`,
      ...(opts.apiKey !== undefined && { apiKey: opts.apiKey }),
    },
    ...(opts.allowedModels !== undefined && { allowedModels: opts.allowedModels }),
    createProvider: (config: IProviderDefinitionConfig): IAIProvider => {
      capturedConfig = config;
      return stubProvider(type);
    },
  };
}

function createContext(config: Record<string, unknown> = {}): INodeExecutionContext {
  return {
    dagId: 'dag-1',
    dagRunId: 'run-1',
    taskRunId: 'task-1',
    nodeDefinition: {
      nodeId: 'llm-1',
      nodeType: 'llm-text',
      dependsOn: [],
      inputs: [{ key: 'text', type: 'string', required: true }],
      outputs: [{ key: 'text', type: 'string', required: true }],
      config,
    },
    nodeManifest: {
      nodeType: 'llm-text',
      displayName: 'LLM Text',
      category: 'AI',
      inputs: [],
      outputs: [],
    },
    attempt: 1,
    executionPath: [],
    currentTotalCredits: 0,
  } as unknown as INodeExecutionContext;
}

describe('LlmTextNodeDefinition (ARCH-PROVIDER-003)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig = undefined;
  });

  it('has the collapsed llm-text metadata', () => {
    const node = new LlmTextNodeDefinition([stubDefinition('stub')]);
    expect(node.nodeType).toBe('llm-text');
    expect(node.displayName).toBe('LLM Text');
    expect(node.category).toBe('AI');
  });

  it('TC-01: resolves the provider from the INJECTED registry (no hardcoded vendor list)', async () => {
    mockRun.mockResolvedValueOnce('hello from custom provider');
    // A provider type that no hardcoded union would know about — proves registry-driven resolution.
    const node = new LlmTextNodeDefinition([
      stubDefinition('my-custom-llm', { requiresApiKey: false }),
    ]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({ provider: 'my-custom-llm' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('hello from custom provider');
    }
  });

  it('TC-02: priority-fallback SKIPS a credential-less provider and uses the next', async () => {
    mockRun.mockResolvedValueOnce('answer from B');
    const node = new LlmTextNodeDefinition([
      // A requires a key but supplies none → must be skipped, not fatal.
      stubDefinition('prov-a', { requiresApiKey: true }),
      // B requires no key → used.
      stubDefinition('prov-b', { requiresApiKey: false }),
    ]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({
        providers: [
          { provider: 'prov-a', priority: 1 },
          { provider: 'prov-b', priority: 2 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('answer from B');
      expect(String(result.value._agentSummary)).toContain('prov-b');
    }
    // A skipped (credential-less) provider is never run — only prov-b executes.
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it('TC-02c: priority-fallback moves to the next provider when an ATTEMPTED one throws', async () => {
    mockRun.mockRejectedValueOnce(new Error('prov-a boom')).mockResolvedValueOnce('answer from B');
    const node = new LlmTextNodeDefinition([
      stubDefinition('prov-a', { requiresApiKey: false }),
      stubDefinition('prov-b', { requiresApiKey: false }),
    ]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({
        providers: [
          { provider: 'prov-a', priority: 1 },
          { provider: 'prov-b', priority: 2 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('answer from B');
      // prov-a was attempted-and-failed, so it appears as the fallback source.
      expect(String(result.value._agentSummary)).toContain('fallback from prov-a');
    }
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('TC-02b: errors (not throws) when every provider is skipped for missing credentials', async () => {
    const node = new LlmTextNodeDefinition([stubDefinition('prov-a', { requiresApiKey: true })]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({ provider: 'prov-a' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_LLM_NO_PROVIDER_AVAILABLE');
    }
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('TC-07: options passthrough reaches the provider config', async () => {
    mockRun.mockResolvedValueOnce('ok');
    const node = new LlmTextNodeDefinition([stubDefinition('stub')]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({ provider: 'stub', options: { flavor: 'vanilla' } }),
    );
    expect(result.ok).toBe(true);
    expect(capturedConfig?.options).toEqual({ flavor: 'vanilla' });
  });

  it('enforces the definition allowedModels allowlist', async () => {
    const node = new LlmTextNodeDefinition([
      stubDefinition('stub', { model: 'ok-model', allowedModels: ['ok-model'] }),
    ]);
    const result = await node.taskHandler.execute(
      { text: 'Hi' },
      createContext({ provider: 'stub', model: 'other-model' }),
    );
    // model-not-allowed → skipped → no usable provider.
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_LLM_NO_PROVIDER_AVAILABLE');
    }
  });

  it('requires provider or providers in config', async () => {
    const node = new LlmTextNodeDefinition([stubDefinition('stub')]);
    const result = await node.taskHandler.validateInput!({ text: 'Hi' }, createContext({}));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROVIDER_REQUIRED');
    }
  });

  it('rejects empty prompt', async () => {
    const node = new LlmTextNodeDefinition([stubDefinition('stub')]);
    const result = await node.taskHandler.validateInput!(
      { text: '' },
      createContext({ provider: 'stub' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DAG_VALIDATION_LLM_PROMPT_REQUIRED');
    }
  });

  it('estimateCost uses the primary provider definition cost', async () => {
    const node = new LlmTextNodeDefinition([stubDefinition('stub')]);
    const text = 'x'.repeat(400);
    const result = await node.taskHandler.estimateCost!(
      { text },
      createContext({ provider: 'stub', baseCredits: 0.01 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // stub has no costPerTokenUsd → FALLBACK_COST_PER_TOKEN_USD (0.003)
      expect(result.value.estimatedCredits).toBeCloseTo(0.01 + (400 / 4) * 0.003, 4);
    }
  });
});
