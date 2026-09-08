import { describe, it, expect } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
  isPersistableInstantNode,
  parsePersistedInstantNode,
  rehydrateInstantNode,
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICompositeSubRunner,
} from '../index.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

const TEST_PROVIDERS: readonly IProviderDefinition[] = [
  {
    type: 'anthropic',
    defaults: { model: 'test-model', apiKey: '$ENV:ANTHROPIC_API_KEY' },
    credentialRequirement: { anyOf: ['apiKey'] },
    createProvider: () => ({ name: 'anthropic' }) as never,
  },
];

const RUNNER: ICompositeSubRunner = { run: async () => ({ ok: true, outputs: {} }) };
const INNER_DAG: IDagDefinition = {
  dagId: 'inner',
  version: 1,
  status: 'draft',
  nodes: [],
  edges: [],
};

function makeComposite() {
  return createCompositeInstantNodeDefinition({
    nodeType: 'wrap',
    displayName: 'Wrap',
    innerDag: INNER_DAG,
    exposedInputPort: { key: 'text', mapsTo: { nodeId: 'a', portKey: 'text' } },
    exposedOutputPorts: [{ key: 'out', mapsTo: { nodeId: 'b', portKey: 'text' } }],
    runner: RUNNER,
  });
}

describe('DATA-003 F1: provider set is a runtime SSOT', () => {
  it('accepts any persisted provider string and validates it against the injected registry', () => {
    const parsed = parsePersistedInstantNode({
      kind: 'prompt',
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: '{{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
      provider: 'anthropic',
    });
    expect(parsed?.kind).toBe('prompt');
    if (parsed?.kind === 'prompt') expect(parsed.provider).toBe('anthropic');
    expect(() => rehydrateInstantNode(parsed!, { providers: [] })).toThrow(
      /DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN/,
    );
  });
});

describe('DATA-003 F4: isPersistableInstantNode guard', () => {
  it('is true for instant nodes and false otherwise', () => {
    const prompt = createPromptBackedNodeDefinition(
      {
        nodeType: 'p',
        displayName: 'P',
        systemPromptTemplate: '{{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
      },
      TEST_PROVIDERS,
    );
    expect(isPersistableInstantNode(prompt)).toBe(true);
    expect(isPersistableInstantNode(makeComposite())).toBe(true);
    expect(isPersistableInstantNode({})).toBe(false);
    expect(isPersistableInstantNode(null)).toBe(false);
    expect(isPersistableInstantNode({ toPersisted: 'x' })).toBe(false);
  });
});

describe('DATA-003 F2: symmetric persist → parse → rehydrate round-trip', () => {
  it('prompt node round-trips through JSON with provider + model preserved', () => {
    const original = createPromptBackedNodeDefinition(
      {
        nodeType: 'pirate',
        displayName: 'Pirate',
        systemPromptTemplate: 'Rewrite: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      },
      TEST_PROVIDERS,
    );
    const onDisk = JSON.parse(JSON.stringify(original.toPersisted())) as unknown;
    const parsed = parsePersistedInstantNode(onDisk);
    expect(parsed).not.toBeNull();
    const rebuilt = rehydrateInstantNode(parsed!, { providers: TEST_PROVIDERS });
    expect(rebuilt.nodeType).toBe('pirate');
    expect(rebuilt.defaultInputPort).toBe('text');
    expect(rebuilt.defaultOutputPort).toBe('text');
    expect(isPersistableInstantNode(rebuilt)).toBe(true);
    expect((rebuilt as unknown as { toPersisted(): unknown }).toPersisted()).toMatchObject({
      kind: 'prompt',
      nodeType: 'pirate',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('composite node round-trips when a runner is injected', () => {
    const onDisk = JSON.parse(JSON.stringify(makeComposite().toPersisted())) as unknown;
    const parsed = parsePersistedInstantNode(onDisk);
    expect(parsed?.kind).toBe('composite');
    const rebuilt = rehydrateInstantNode(parsed!, { compositeRunner: RUNNER });
    expect(rebuilt.nodeType).toBe('wrap');
  });

  it('composite without a runner throws — never a half-built node (no silent partial)', () => {
    const record = makeComposite().toPersisted();
    expect(() => rehydrateInstantNode(record, {})).toThrow(/composite/i);
  });

  it('rejects malformed records (returns null, never throws)', () => {
    expect(parsePersistedInstantNode(null)).toBeNull();
    expect(parsePersistedInstantNode('nope')).toBeNull();
    expect(parsePersistedInstantNode({ kind: 'prompt', nodeType: 'x' })).toBeNull();
    expect(parsePersistedInstantNode({ nodeType: 'x' })).toBeNull();
    expect(parsePersistedInstantNode({ kind: 'composite', nodeType: 'x' })).toBeNull();
  });
});
