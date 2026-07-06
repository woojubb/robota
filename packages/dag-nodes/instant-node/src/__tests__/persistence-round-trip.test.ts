import { describe, it, expect } from 'vitest';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import {
  INSTANT_NODE_PROVIDERS,
  isInstantNodeProvider,
  isPersistableInstantNode,
  parsePersistedInstantNode,
  rehydrateInstantNode,
  createPromptBackedNodeDefinition,
  createCompositeInstantNodeDefinition,
  type ICompositeSubRunner,
  type TInstantNodeProvider,
} from '../index.js';

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
  it('exports the const list and derives the type from it', () => {
    expect([...INSTANT_NODE_PROVIDERS]).toEqual([
      'anthropic',
      'openai',
      'gemini',
      'deepseek',
      'qwen',
    ]);
    const p: TInstantNodeProvider = INSTANT_NODE_PROVIDERS[0];
    expect(p).toBe('anthropic');
  });

  it('isInstantNodeProvider narrows unknown → TInstantNodeProvider', () => {
    expect(isInstantNodeProvider('anthropic')).toBe(true);
    expect(isInstantNodeProvider('qwen')).toBe(true);
    expect(isInstantNodeProvider('not-a-provider')).toBe(false);
    expect(isInstantNodeProvider(undefined)).toBe(false);
    expect(isInstantNodeProvider(42)).toBe(false);
  });
});

describe('DATA-003 F4: isPersistableInstantNode guard', () => {
  it('is true for instant nodes and false otherwise', () => {
    const prompt = createPromptBackedNodeDefinition({
      nodeType: 'p',
      displayName: 'P',
      systemPromptTemplate: '{{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
    });
    expect(isPersistableInstantNode(prompt)).toBe(true);
    expect(isPersistableInstantNode(makeComposite())).toBe(true);
    expect(isPersistableInstantNode({})).toBe(false);
    expect(isPersistableInstantNode(null)).toBe(false);
    expect(isPersistableInstantNode({ toPersisted: 'x' })).toBe(false);
  });
});

describe('DATA-003 F2: symmetric persist → parse → rehydrate round-trip', () => {
  it('prompt node round-trips through JSON with provider + model preserved', () => {
    const original = createPromptBackedNodeDefinition({
      nodeType: 'pirate',
      displayName: 'Pirate',
      systemPromptTemplate: 'Rewrite: {{text}}',
      inputPorts: [{ key: 'text' }],
      outputPort: { key: 'text' },
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
    const onDisk = JSON.parse(JSON.stringify(original.toPersisted())) as unknown;
    const parsed = parsePersistedInstantNode(onDisk);
    expect(parsed).not.toBeNull();
    const rebuilt = rehydrateInstantNode(parsed!);
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
