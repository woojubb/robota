import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { ObservableEventService } from '../../event-service/event-service';
import { TOOL_EVENTS, TOOL_EVENT_PREFIX } from '../tool-execution-constants';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';
import type { IManagedRunProvider } from '../../interfaces/managed-provider';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAgentConfig } from '../../interfaces/agent';
import type {
  IToolExecutionResult,
  IToolCallScheduling,
  TToolEffectAdmission,
  TToolParameters,
} from '../../interfaces/tool';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

function fixture(
  plugin?: AbstractPlugin,
  replacement?: FunctionTool,
  decorate?: (message: TUniversalMessage) => TUniversalMessage,
  policy?: IAgentConfig['toolExecutionPolicy'],
  maxSameToolInputs?: number,
  eventService?: ObservableEventService,
) {
  const scripted = createScriptedProvider([
    {
      toolCalls: [
        { name: 'act', args: { n: 1 } },
        { name: 'act', args: { n: 2 } },
      ],
    },
    { text: 'done' },
  ]);
  if (decorate) {
    const chat = scripted.provider.chat.bind(scripted.provider);
    scripted.provider.chat = async (...args) => decorate(await chat(...args));
  }
  const effect = vi.fn(async (parameters: { n?: unknown }) => `result ${parameters.n}`);
  const agent = new ConversationAgent({
    // These fixtures exercise independent calls settling concurrently.
    toolExecutionPolicy:
      policy ??
      ((calls) => ({
        scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
      })),
    name: 'resume-test',
    ...(maxSameToolInputs !== undefined && { maxSameToolInputs }),
    ...(eventService && { eventService }),
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    ...(plugin && { plugins: [plugin] }),
    tools: [
      replacement ??
        new FunctionTool(
          {
            name: 'act',
            description: 'Test action',
            parameters: {
              type: 'object',
              properties: { n: { type: 'number' } },
            },
          },
          effect,
        ),
    ],
  });
  agents.push(agent);
  return { agent, effect, ...scripted };
}

async function stoppedAt(
  kind: TExecutionJournalRecord['kind'],
  afterWrite = false,
  source = fixture(),
) {
  const records: TExecutionJournalRecord[] = [];
  const append = async (record: TExecutionJournalRecord) => {
    if (record.kind === kind && !afterWrite) throw new Error('crash boundary');
    records.push(structuredClone(record));
    if (record.kind === kind) throw new Error('lost acknowledgement');
  };
  await expect(
    source.agent.run('perform actions', {
      executionJournal: { append },
      ephemeralSystemContext: 'Only this invocation sees this instruction',
    }),
  ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
  const response = records.find((record) => record.kind === 'model-response');
  if (!response || response.kind !== 'model-response') throw new Error('Missing response fixture');
  const journal = {
    read: vi.fn(async () => structuredClone(records)),
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      const existing = records.find((entry) => entry.recordId === record.recordId);
      if (existing) expect(record).toEqual(existing);
      else records.push(structuredClone(record));
    }),
  };
  return { source, records, journal, executionId: response.executionId, callId: response.callId };
}

describe('provider-free journal continuation', () => {
  it('keeps the selected provider stable while saved tool calls are recovered', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    const managed: IManagedRunProvider = {
      kind: 'managed-run',
      name: 'managed-test',
      version: 'test',
      run: vi.fn(),
      validateConfig: () => true,
    };
    fresh.agent.swapDefaultProvider(managed, 'test-model');
    fresh.agent.setModel({ provider: fresh.provider.name, model: 'test-model' });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    saved.journal.read.mockImplementation(async () => {
      enter();
      await gate;
      return structuredClone(saved.records);
    });
    const resuming = fresh.agent.resumeToolCalls(saved);
    await entered;
    try {
      expect(() => fresh.agent.setModel({ provider: managed.name, model: 'test-model' })).toThrow(
        /queued or active/,
      );
      expect(() => fresh.agent.swapDefaultProvider(managed, 'test-model')).toThrow(
        /queued or active/,
      );
      expect(fresh.effect).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await resuming;
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(fresh.agent.getModel().provider).toBe(fresh.provider.name);
    expect(managed.run).not.toHaveBeenCalled();
  });

  it('restores a saved response without another provider call or ephemeral instructions', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(fresh.agent.getHistory().map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
    ]);
    expect(JSON.stringify(fresh.agent.getHistory())).not.toContain('Only this invocation');
    const ids = fresh.agent.getHistory().map((m) => m.id);
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.agent.getHistory().map((m) => m.id)).toEqual(ids);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('optionally returns durable receipts and reuses them without repeating effects', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(first.receipts).toHaveLength(2);
    for (const receipt of first.receipts ?? []) {
      const record = saved.records.find(
        (item) => item.kind === 'tool-result' && item.toolCallId === receipt.toolCallId,
      );
      expect(record).toMatchObject({ actionId: receipt.actionId, result: receipt.result });
    }
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    const ordinary = await fresh.agent.resumeToolCalls(saved);
    expect(ordinary).not.toHaveProperty('receipts');
    const repeated = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(repeated.receipts).toEqual(first.receipts);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it.each(['mode', 'concurrency', 'failure handling', 'dependencies', 'resources'] as const)(
    'refuses a changed %s policy after a partial intent write',
    async (changed) => {
      const saved = await stoppedAt('tool-intent', true);
      const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => ({
        ...(changed === 'mode' && { mode: 'sequential' }),
        ...(changed === 'concurrency' && { maxConcurrency: 1 }),
        ...(changed === 'failure handling' && { continueOnError: false }),
        scheduling: new Map(
          calls.map((call, index) => [
            call.id,
            {
              resources:
                changed === 'resources' && index === 0 ? [{ key: 'shared', access: 'write' }] : [],
              ...(changed === 'dependencies' && index === 1 && { dependsOn: [calls[0].id] }),
            },
          ]),
        ),
      });
      const fresh = fixture(undefined, undefined, undefined, policy);
      await expect(
        fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
    },
  );

  it('records one policy binding and resolves it once when a batch resumes', async () => {
    const saved = await stoppedAt('tool-intent', true);
    const policy = vi.fn<NonNullable<IAgentConfig['toolExecutionPolicy']>>((calls) => ({
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    }));
    const fresh = fixture(undefined, undefined, undefined, policy);
    const result = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(policy).toHaveBeenCalledOnce();
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(result.receipts).toHaveLength(2);
    const records = saved.records.filter(
      (record) => record.kind === 'tool-intent' || record.kind === 'tool-result',
    );
    expect(records).toHaveLength(4);
    expect(records[0]).toHaveProperty('batchPolicy');
    for (const record of records.slice(1)) expect(record).not.toHaveProperty('batchPolicy');
  });

  it('reads a top-level policy field once and binds the resolved value', async () => {
    const read = vi.fn(() => 'parallel' as const);
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => ({
      get mode() {
        return read();
      },
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    });
    const source = fixture(undefined, undefined, undefined, policy);
    const saved = await stoppedAt('tool-intent', true, source);
    expect(read).toHaveBeenCalledOnce();
    read.mockClear();
    const fresh = fixture(undefined, undefined, undefined, policy);
    await fresh.agent.resumeToolCalls(saved);
    expect(read).toHaveBeenCalledOnce();
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('checks policy before continuing after a durable effect result', async () => {
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => ({
      mode: 'sequential',
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    });
    const source = fixture(undefined, undefined, undefined, policy);
    const saved = await stoppedAt('tool-result', true, source);
    expect(source.effect).toHaveBeenCalledTimes(1);
    const changed = fixture();
    await expect(
      changed.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(changed.effect).not.toHaveBeenCalled();
    const fresh = fixture(undefined, undefined, undefined, policy);
    const result = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(fresh.effect).toHaveBeenCalledTimes(1);
    expect(fresh.effect).toHaveBeenCalledWith({ n: 2 }, expect.anything());
    expect(result.receipts).toHaveLength(2);
  });

  it('binds a batch consisting only of malformed tool arguments through its first result', async () => {
    const source = fixture(undefined, undefined, (message) => {
      if (message.role !== 'assistant' || !message.toolCalls) return message;
      return {
        ...message,
        toolCalls: message.toolCalls.map((call) => ({
          ...call,
          function: { ...call.function, arguments: '{invalid' },
        })),
      };
    });
    const saved = await stoppedAt('tool-result', true, source);
    expect(source.effect).not.toHaveBeenCalled();
    const recorded = saved.records.find((record) => record.kind === 'tool-result');
    expect(recorded).toHaveProperty('batchPolicy');
    const changed = fixture(undefined, undefined, undefined, (calls) => ({
      mode: 'sequential',
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    }));
    await expect(changed.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(changed.effect).not.toHaveBeenCalled();
  });

  it('does not persist a second malformed result before the policy binding is acknowledged', async () => {
    const source = fixture(undefined, undefined, (message) => {
      if (message.role !== 'assistant' || !message.toolCalls) return message;
      return {
        ...message,
        toolCalls: message.toolCalls.map((call) => ({
          ...call,
          function: { ...call.function, arguments: '{invalid' },
        })),
      };
    });
    const records: TExecutionJournalRecord[] = [];
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const run = source.agent.run('perform actions', {
      executionJournal: {
        append: async (record) => {
          records.push(structuredClone(record));
          if (record.kind === 'tool-result') {
            enter();
            await gate;
            throw new Error('lost acknowledgement');
          }
        },
      },
    });
    const rejected = expect(run).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    await entered;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const results = records.filter((record) => record.kind === 'tool-result');
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveProperty('batchPolicy');
    } finally {
      release();
    }
    await rejected;
    expect(records.filter((record) => record.kind === 'tool-result')).toHaveLength(1);
    expect(source.effect).not.toHaveBeenCalled();
  });

  it('rejects conflicting saved policy bindings before dispatch', async () => {
    const saved = await stoppedAt('tool-dispatch');
    const intents = saved.records.filter((record) => record.kind === 'tool-intent');
    if (intents.length !== 2 || !intents[0].batchPolicy) throw new Error('Missing policy binding');
    intents[1].batchPolicy = structuredClone(intents[0].batchPolicy);
    intents[1].batchPolicy.mode = 'sequential';
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('accepts equivalent policy ordering, duplicates and default entries', async () => {
    const policy =
      (alternate: boolean): NonNullable<IAgentConfig['toolExecutionPolicy']> =>
      (calls) => ({
        scheduling: new Map(
          alternate
            ? [
                [calls[1].id, { dependsOn: [calls[0].id], resources: [] }],
                [calls[0].id, { resources: [{ key: 'db', access: 'write' }] }],
              ]
            : [
                [
                  calls[0].id,
                  {
                    resources: [
                      { key: 'db', access: 'write' },
                      { key: 'db', access: 'write' },
                    ],
                  },
                ],
                [calls[1].id, { dependsOn: [calls[0].id, calls[0].id], resources: [] }],
              ],
        ),
      });
    const source = fixture(undefined, undefined, undefined, policy(false));
    const saved = await stoppedAt('tool-intent', true, source);
    const fresh = fixture(undefined, undefined, undefined, policy(true));
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('preserves unknown dependency refusal order during recovery', async () => {
    const policy =
      (reverse: boolean): NonNullable<IAgentConfig['toolExecutionPolicy']> =>
      (calls) => ({
        scheduling: new Map([
          [
            calls[0].id,
            { dependsOn: reverse ? ['missing-a', 'missing-z'] : ['missing-z', 'missing-a'] },
          ],
        ]),
      });
    const source = fixture(undefined, undefined, undefined, policy(false));
    const saved = await stoppedAt('tool-result', true, source);
    const first = saved.records.find((record) => record.kind === 'tool-result');
    if (first?.kind !== 'tool-result') throw new Error('Missing refusal');
    expect(first.result.error).toContain('missing-z');
    const fresh = fixture(undefined, undefined, undefined, policy(true));
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('keeps legacy batches unbound under the equivalent host policy', async () => {
    const saved = await stoppedAt('tool-intent', true);
    for (const record of saved.records)
      if (record.kind === 'tool-intent' || record.kind === 'tool-result') delete record.batchPolicy;
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    for (const record of saved.records)
      if (record.kind === 'tool-intent' || record.kind === 'tool-result')
        expect(record).not.toHaveProperty('batchPolicy');
  });

  it.each([
    'proxy map',
    'accessor',
    'class',
    'array subclass',
    'extra field',
    'invalid access',
  ] as const)('refuses %s before a journaled tool effect', async (kind) => {
    const getter = vi.fn(() => 'write');
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => {
      const resource: { key: string; access: 'read' | 'write' } = { key: 'shared', access: 'read' };
      const declaration: IToolCallScheduling = { resources: [resource] };
      if (kind === 'accessor')
        Object.defineProperty(resource, 'access', { get: getter, enumerable: true });
      if (kind === 'extra field') Object.assign(declaration, { unused: true });
      if (kind === 'invalid access') Object.assign(resource, { access: 'invalid' });
      if (kind === 'array subclass') {
        class Resources extends Array<{ key: string; access: 'read' | 'write' }> {}
        Object.assign(declaration, { resources: new Resources() });
      }
      if (kind === 'class') Object.setPrototypeOf(declaration, { marker: true });
      const scheduling = new Map(calls.map((call) => [call.id, declaration]));
      return { scheduling: kind === 'proxy map' ? new Proxy(scheduling, {}) : scheduling };
    };
    const source = fixture(undefined, undefined, undefined, policy);
    const records: TExecutionJournalRecord[] = [];
    await expect(
      source.agent.run('perform actions', {
        executionJournal: {
          append: async (record) => {
            records.push(structuredClone(record));
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(source.effect).not.toHaveBeenCalled();
    expect(records.some((record) => record.kind === 'tool-intent')).toBe(false);
  });

  it('runs against a detached snapshot when a declaration mutates during inspection', async () => {
    const getter = vi.fn(() => 'changed');
    const first = { key: 'original', access: 'read' as const };
    const target = { key: 'other', access: 'read' as const };
    const resources: Array<{ key: string; access: 'read' | 'write' }> = [first, target];
    const dynamic = new Proxy(target, {
      getPrototypeOf(value) {
        Object.defineProperty(first, 'key', { get: getter, enumerable: true });
        resources[1] = { key: 'replacement', access: 'write' };
        return Object.getPrototypeOf(value);
      },
    });
    resources[1] = dynamic;
    const source = fixture(undefined, undefined, undefined, (calls) => ({
      scheduling: new Map([
        [calls[0].id, { resources }],
        [calls[1].id, { resources: [] }],
      ]),
    }));
    const records: TExecutionJournalRecord[] = [];
    await source.agent.run('perform actions', {
      executionJournal: {
        append: async (record) => {
          records.push(structuredClone(record));
        },
      },
    });
    const intent = records.find((record) => record.kind === 'tool-intent');
    expect(intent?.batchPolicy?.scheduling?.[0]?.[1].resources).toEqual([
      { key: 'original', access: 'read' },
      { key: 'other', access: 'read' },
    ]);
    expect(getter).not.toHaveBeenCalled();
    expect(source.effect).toHaveBeenCalledTimes(2);
  });

  it('accepts frozen plain scheduling data', async () => {
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => ({
      scheduling: new Map(
        calls.map((call) => [call.id, Object.freeze({ resources: Object.freeze([]) })]),
      ),
    });
    const source = fixture(undefined, undefined, undefined, policy);
    const saved = await stoppedAt('tool-intent', true, source);
    const fresh = fixture(undefined, undefined, undefined, policy);
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it.each(['hidden array property', 'array accessor', 'policy accessor'] as const)(
    'rejects %s in a journal before cloning it',
    async (kind) => {
      const saved = await stoppedAt('tool-intent', true);
      const intent = saved.records.find((record) => record.kind === 'tool-intent');
      if (intent?.kind !== 'tool-intent') throw new Error('Missing intent');
      const resources = intent.batchPolicy?.scheduling?.[0]?.[1].resources;
      if (!resources) throw new Error('Missing resources');
      const getter = vi.fn(() => 1);
      if (kind === 'hidden array property')
        Object.defineProperty(resources, 'map', { value: 1, enumerable: false });
      if (kind === 'array accessor')
        Object.defineProperty(resources, 'map', { get: getter, enumerable: true });
      if (kind === 'policy accessor')
        Object.defineProperty(intent, 'batchPolicy', { get: getter, enumerable: true });
      saved.journal.read.mockImplementation(async () => saved.records);
      const fresh = fixture();
      await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(getter).not.toHaveBeenCalled();
      expect(fresh.effect).not.toHaveBeenCalled();
    },
  );

  it('does not read a journal record kind accessor during execution continuation', async () => {
    const saved = await stoppedAt('tool-intent', true);
    const intent = saved.records.find((record) => record.kind === 'tool-intent');
    if (!intent) throw new Error('Missing intent');
    const getter = vi.fn(() => 'tool-intent');
    Object.defineProperty(intent, 'kind', { get: getter, enumerable: true });
    saved.journal.read.mockImplementation(async () => saved.records);
    const fresh = fixture();
    await expect(
      fresh.agent.resume({ executionId: saved.executionId, journal: saved.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('does not read a proxied journal array before rejecting it', async () => {
    const saved = await stoppedAt('tool-intent', true);
    const getter = vi.fn();
    saved.journal.read.mockImplementation(
      async () =>
        new Proxy(saved.records, {
          get(target, key, receiver) {
            if (key === 'length') getter();
            return Reflect.get(target, key, receiver);
          },
        }),
    );
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(getter).not.toHaveBeenCalled();
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('rejects inherited policy accessors before parsing a saved policy', async () => {
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => ({
      scheduling: new Map([
        [calls[0].id, { dependsOn: [calls[1].id] }],
        [calls[1].id, { resources: [] }],
      ]),
    });
    const saved = await stoppedAt(
      'tool-intent',
      true,
      fixture(undefined, undefined, undefined, policy),
    );
    const fresh = fixture(undefined, undefined, undefined, policy);
    const getter = vi.fn(() => []);
    let failure: unknown;
    Object.defineProperty(Object.prototype, 'resources', { configurable: true, get: getter });
    try {
      await fresh.agent.resumeToolCalls(saved);
    } catch (error) {
      failure = error;
    } finally {
      delete (Object.prototype as { resources?: unknown }).resources;
    }
    expect(failure).toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('rejects a modified array intrinsic without reading a policy accessor', async () => {
    const getter = vi.fn(() => []);
    const originalEvery = Array.prototype.every;
    const policy: NonNullable<IAgentConfig['toolExecutionPolicy']> = (calls) => {
      Array.prototype.every = (() => true) as unknown as typeof Array.prototype.every;
      const declaration = Object.defineProperty({}, 'resources', {
        enumerable: true,
        get: getter,
      });
      return { scheduling: new Map(calls.map((call) => [call.id, declaration])) };
    };
    const source = fixture(undefined, undefined, undefined, policy);
    let failure: unknown;
    try {
      await source.agent.run('perform actions', { executionJournal: { append: async () => {} } });
    } catch (error) {
      failure = error;
    } finally {
      Array.prototype.every = originalEvery;
    }
    expect(failure).toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(getter).not.toHaveBeenCalled();
    expect(source.effect).not.toHaveBeenCalled();
  });

  it('uses a detached policy if the caller mutates it during an append', async () => {
    let captured = new Map<string, IToolCallScheduling>();
    let firstId = '';
    const source = fixture(undefined, undefined, undefined, (calls) => {
      firstId = calls[0].id;
      captured = new Map(calls.map((call) => [call.id, { resources: [] }]));
      return { scheduling: captured };
    });
    let entered!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const run = source.agent.run('perform actions', {
      executionJournal: {
        append: async (record) => {
          if (record.kind === 'tool-intent' && first) {
            first = false;
            entered();
            await gate;
          }
        },
      },
    });
    await appending;
    captured.set(firstId, { resources: [], dependsOn: ['missing'] });
    release();
    await run;
    expect(source.effect).toHaveBeenCalledTimes(2);
  });

  it.each(['sequential', 'dependent'] as const)(
    'applies the active %s scheduling policy before recovered actions',
    async (mode) => {
      const saved = await stoppedAt('model-response', true);
      const policy = vi.fn<NonNullable<IAgentConfig['toolExecutionPolicy']>>((calls) =>
        mode === 'sequential'
          ? { mode: 'sequential', continueOnError: false }
          : {
              scheduling: new Map([
                [calls[0].id, { resources: [] }],
                [calls[1].id, { resources: [], dependsOn: [calls[0].id] }],
              ]),
            },
      );
      const fresh = fixture(undefined, undefined, undefined, policy);
      fresh.effect.mockImplementation(async ({ n }) => {
        if (n === 1) throw new Error('first action failed');
        return `result ${n}`;
      });
      const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
      expect(policy).toHaveBeenCalledTimes(1);
      expect(fresh.effect).toHaveBeenCalledTimes(1);
      expect(first.receipts?.[0].result.success).toBe(false);
      expect(first.receipts?.[1].result.metadata?.errorCode).toBe('tool_call_skipped');
      expect(
        (await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true })).receipts,
      ).toEqual(first.receipts);
      expect(fresh.effect).toHaveBeenCalledTimes(1);
    },
  );

  it('uses the durable failed result for dependency scheduling without requesting receipts', async () => {
    const saved = await stoppedAt('model-response', true);
    let observed: IToolExecutionResult | undefined;
    class Observer extends AbstractPlugin {
      readonly name = 'observer';
      readonly version = '1';
      override async afterToolCall(
        _name: string,
        _parameters: TToolParameters,
        result: IToolExecutionResult,
      ): Promise<void> {
        if (!result.success) observed = result;
      }
    }
    const fresh = fixture(new Observer(), undefined, undefined, (calls) => ({
      scheduling: new Map([
        [calls[0].id, { resources: [] }],
        [calls[1].id, { resources: [], dependsOn: [calls[0].id] }],
      ]),
    }));
    fresh.effect.mockImplementation(async ({ n }) => {
      if (n === 1) throw new Error('first action failed');
      return `result ${n}`;
    });
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    saved.journal.append.mockImplementation(async (record) => {
      if (
        record.kind === 'tool-result' &&
        !record.result.success &&
        record.toolCallId.endsWith('-0')
      ) {
        reached();
        await gate;
      }
      saved.records.push(structuredClone(record));
    });
    const pending = fresh.agent.resumeToolCalls(saved);
    await appending;
    if (!observed) throw new Error('Missing observed result');
    observed.success = true;
    observed.result = 'changed';
    release();
    const result = await pending;
    expect(result).not.toHaveProperty('receipts');
    expect(fresh.effect).toHaveBeenCalledTimes(1);
    expect(saved.records.filter((record) => record.kind === 'tool-result')).toMatchObject([
      { result: { success: false } },
      { result: { success: false, metadata: { errorCode: 'tool_call_skipped' } } },
    ]);
    expect(result.messages.filter((message) => message.role === 'tool')[0].content).toContain(
      'first action failed',
    );
  });

  it.each([false, true])(
    'ignores a synchronous observer changing a failed result (receipts=%s)',
    async (includeReceipts) => {
      const saved = await stoppedAt('model-response', true);
      class Observer extends AbstractPlugin {
        readonly name = 'observer';
        readonly version = '1';
        override async afterToolCall(
          _name: string,
          _parameters: TToolParameters,
          result: IToolExecutionResult,
        ): Promise<void> {
          if (!result.success) {
            result.success = true;
            result.result = 'forged success';
          }
        }
      }
      const fresh = fixture(new Observer(), undefined, undefined, (calls) => ({
        scheduling: new Map([
          [calls[0].id, { resources: [] }],
          [calls[1].id, { resources: [], dependsOn: [calls[0].id] }],
        ]),
      }));
      fresh.effect.mockImplementation(async ({ n }) => {
        if (n === 1) throw new Error('first action failed');
        return `result ${n}`;
      });
      const result = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts });
      expect(fresh.effect).toHaveBeenCalledTimes(1);
      expect(saved.records.filter((record) => record.kind === 'tool-result')).toMatchObject([
        { result: { success: false } },
        { result: { success: false, metadata: { errorCode: 'tool_call_skipped' } } },
      ]);
      if (includeReceipts) expect(result.receipts?.[0].result.success).toBe(false);
    },
  );

  it.each([false, true])(
    'uses the saved absence of a repeated-input limit during recovery (receipts=%s)',
    async (includeReceipts) => {
      const source = fixture(undefined, undefined, (message) => {
        if (message.role !== 'assistant' || !message.toolCalls?.length) return message;
        return {
          ...message,
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            function: { ...call.function, arguments: message.toolCalls![0].function.arguments },
          })),
        };
      });
      const saved = await stoppedAt('model-response', true, source);
      const fresh = fixture(undefined, undefined, undefined, undefined, 1);
      const result = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts });
      expect(fresh.effect).toHaveBeenCalledTimes(2);
      if (includeReceipts) expect(result.receipts).toHaveLength(2);
      else expect(result).not.toHaveProperty('receipts');
    },
  );

  it.each(['hidden', 'symbol', 'accessor'] as const)(
    'rejects a plugin parameter with %s data before the first clone or effect',
    async (kind) => {
      const saved = await stoppedAt('model-response', true);
      const getter = vi.fn(() => 'value');
      class Observer extends AbstractPlugin {
        readonly name = 'observer';
        readonly version = '1';
        override async beforeToolCall(_name: string, parameters: TToolParameters): Promise<void> {
          if (kind === 'hidden') Object.defineProperty(parameters, 'mode', { value: 'hidden' });
          if (kind === 'symbol')
            Object.defineProperty(parameters, Symbol('mode'), { value: 'symbol' });
          if (kind === 'accessor')
            Object.defineProperty(parameters, 'mode', {
              get: getter,
              enumerable: false,
              configurable: true,
            });
        }
      }
      const fresh = fixture(new Observer());
      await expect(
        fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(getter).not.toHaveBeenCalled();
      expect(saved.records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
    },
  );

  it('publishes the saved result when a tool mutates its output during journal acknowledgement', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    const outputs = [{ value: 'original' }, { value: 'original' }];
    fresh.effect.mockImplementation(async ({ n }) => outputs[Number(n) - 1] as unknown as string);
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') {
        reached();
        await gate;
      }
      const existing = saved.records.find((entry) => entry.recordId === record.recordId);
      if (existing) expect(record).toEqual(existing);
      else saved.records.push(structuredClone(record));
    });

    const pending = fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    await appending;
    outputs[0].value = 'changed';
    release();
    const first = await pending;
    expect(first.receipts?.map((receipt) => receipt.result.result)).toEqual([
      { value: 'original' },
      { value: 'original' },
    ]);
    expect(
      first.messages.filter((message) => message.role === 'tool').map((m) => m.content),
    ).toEqual(['{"value":"original"}', '{"value":"original"}']);
    const repeated = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(repeated.receipts).toEqual(first.receipts);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('runs the admitted arguments when a pre-tool observer mutates its retained reference', async () => {
    const saved = await stoppedAt('model-response', true);
    let observed: TToolParameters | undefined;
    class Observer extends AbstractPlugin {
      readonly name = 'observer';
      readonly version = '1';
      override async beforeToolCall(_name: string, parameters: TToolParameters): Promise<void> {
        if (parameters.n === 1) observed = parameters;
      }
    }
    const fresh = fixture(new Observer());
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-effect-start' && record.parameters.n === 1) {
        reached();
        await gate;
      }
      const existing = saved.records.find((entry) => entry.recordId === record.recordId);
      if (existing) expect(record).toEqual(existing);
      else saved.records.push(structuredClone(record));
    });
    const pending = fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    await appending;
    if (!observed) throw new Error('Missing plugin observation');
    observed.n = 99;
    release();
    const resumed = await pending;
    expect(fresh.effect.mock.calls.map(([parameters]) => parameters.n).sort()).toEqual([1, 2]);
    expect(resumed.receipts?.map((receipt) => receipt.result.result)).toEqual([
      'result 1',
      'result 2',
    ]);
    expect(
      saved.records
        .filter((record) => record.kind === 'tool-effect-start')
        .map((r) => r.parameters.n)
        .sort(),
    ).toEqual([1, 2]);
  });

  it('isolates recovered history from mutations by history observers', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    let observedTools = 0;
    fresh.effect.mockImplementation(async ({ n }) => ({ value: n }) as unknown as string);
    const outcome = await fresh.agent.resumeToolCalls({
      ...saved,
      includeReceipts: true,
      onExecutionEvent: (event, data) => {
        if (event === 'history_mutation' && (data.message as { role: string }).role === 'tool') {
          observedTools++;
          (data.message as { content: string }).content = 'changed';
        }
      },
    });
    expect(observedTools).toBe(2);
    expect(fresh.effect.mock.calls.map(([parameters]) => parameters.n).sort()).toEqual([1, 2]);
    expect(outcome.receipts?.map((receipt) => receipt.result.result)).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    expect(
      outcome.messages.filter((message) => message.role === 'tool').map((m) => m.content),
    ).toEqual(['{"value":1}', '{"value":2}']);
  });

  it('isolates tool start and completion events from admitted inputs and settled results', async () => {
    const saved = await stoppedAt('model-response', true);
    const events = new ObservableEventService();
    let starts = 0;
    let completions = 0;
    events.subscribe((event, data) => {
      if (event === `${TOOL_EVENT_PREFIX}.${TOOL_EVENTS.CALL_START}`) {
        starts++;
        (data.parameters as { n: number }).n = 99;
      }
      if (event === `${TOOL_EVENT_PREFIX}.${TOOL_EVENTS.CALL_COMPLETE}`) {
        completions++;
        (data.result as { value: number }).value = 99;
      }
    });
    const fresh = fixture(undefined, undefined, undefined, undefined, undefined, events);
    fresh.effect.mockImplementation(async ({ n }) => ({ value: n }) as unknown as string);
    const result = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(starts).toBe(2);
    expect(completions).toBe(2);
    expect(fresh.effect.mock.calls.map(([parameters]) => parameters.n).sort()).toEqual([1, 2]);
    expect(result.receipts?.map((receipt) => receipt.result.result)).toEqual([
      { value: 1 },
      { value: 2 },
    ]);
    expect(
      result.messages.filter((message) => message.role === 'tool').map((m) => m.content),
    ).toEqual(['{"value":1}', '{"value":2}']);
  });

  it('settles results when an unused tool extension cannot be cloned', async () => {
    const saved = await stoppedAt('model-response', true);
    const effect = vi.fn(async (parameters: TToolParameters) => ({
      success: true,
      data: `result ${parameters.n}`,
      diagnostic: new Error('local diagnostic', { cause: () => {} }),
    }));
    const tool = FunctionTool.fromResult(
      {
        name: 'act',
        description: 'Test action',
        parameters: { type: 'object', properties: { n: { type: 'number' } } },
      },
      effect,
    );
    const fresh = fixture(undefined, tool);
    const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(first.receipts?.map((receipt) => receipt.result.result)).toEqual([
      'result 1',
      'result 2',
    ]);
    expect(
      (await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true })).receipts,
    ).toEqual(first.receipts);
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it.each(['tool_call_skipped', 'argument_decode_error', 'unknown_tool'])(
    'does not let an executed tool claim the host-owned %s classification',
    async (errorCode) => {
      const saved = await stoppedAt('model-response', true);
      const effect = vi.fn(async () => ({
        success: false,
        error: 'failed',
        data: null,
        metadata: { errorCode },
      }));
      const tool = FunctionTool.fromResult(
        {
          name: 'act',
          description: 'Test action',
          parameters: { type: 'object', properties: { n: { type: 'number' } } },
        },
        effect,
      );
      const fresh = fixture(undefined, tool);
      const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
      expect(effect).toHaveBeenCalledTimes(2);
      expect(
        first.receipts?.every((receipt) => receipt.result.metadata?.errorCode !== errorCode),
      ).toBe(true);
      const repeated = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
      expect(repeated.receipts).toEqual(first.receipts);
      expect(effect).toHaveBeenCalledTimes(2);
    },
  );

  it('prevents a result observer from claiming a dispatched effect was skipped', async () => {
    const saved = await stoppedAt('model-response', true);
    class Observer extends AbstractPlugin {
      readonly name = 'observer';
      readonly version = '1';
      override async afterToolCall(
        _name: string,
        _parameters: TToolParameters,
        result: IToolExecutionResult,
      ): Promise<void> {
        result.metadata = {
          ...result.metadata,
          errorCode: 'tool_call_skipped',
          dispatchStatus: 'not-dispatched',
        };
      }
    }
    const fresh = fixture(new Observer());
    const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(
      first.receipts?.every(
        (receipt) => receipt.result.metadata?.errorCode !== 'tool_call_skipped',
      ),
    ).toBe(true);
    expect(
      (await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true })).receipts,
    ).toEqual(first.receipts);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('stops before a custom wrapper effect if its admitted parameters change during persistence', async () => {
    const saved = await stoppedAt('model-response', true);
    let owned: TToolParameters | undefined;
    const effect = vi.fn(async (_parameters: TToolParameters) => 'done');
    const tool = new FunctionTool(
      {
        name: 'act',
        description: 'Test action',
        parameters: { type: 'object', properties: { n: { type: 'number' } } },
      },
      effect,
    );
    Object.assign(tool, {
      executeWithAdmission: async (
        parameters: TToolParameters,
        _context: unknown,
        admit: TToolEffectAdmission,
      ) => {
        if (parameters.n === 1) owned = parameters;
        await admit(parameters);
        return { success: true, data: await effect(parameters) };
      },
    });
    const fresh = fixture(undefined, tool);
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-effect-start' && record.parameters.n === 1) {
        reached();
        await gate;
      }
      saved.records.push(structuredClone(record));
    });
    const pending = fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    await appending;
    if (!owned) throw new Error('Missing wrapper arguments');
    owned.n = 99;
    release();
    await expect(pending).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(effect.mock.calls.every(([parameters]) => parameters.n !== 1)).toBe(true);
  });

  it('accepts unchanged date-valued wrapper arguments and reuses their receipts', async () => {
    const saved = await stoppedAt('model-response', true);
    const effect = vi.fn(async (parameters: TToolParameters) => parameters.n);
    const tool = new FunctionTool(
      {
        name: 'act',
        description: 'Test action',
        parameters: { type: 'object', properties: { n: { type: 'number' } } },
      },
      effect,
    );
    Object.assign(tool, {
      executeWithAdmission: async (
        parameters: TToolParameters,
        _context: unknown,
        admit: TToolEffectAdmission,
      ) => {
        const effective = { ...parameters, nested: { dates: [new Date('2025-01-02T03:04:05Z')] } };
        await admit(effective);
        return { success: true, data: await effect(effective) };
      },
    });
    const fresh = fixture(undefined, tool);
    const first = await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    const start = saved.records.find((record) => record.kind === 'tool-effect-start');
    expect(start).toMatchObject({
      parameters: { nested: { dates: [new Date('2025-01-02T03:04:05Z')] } },
    });
    expect(
      (await fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true })).receipts,
    ).toEqual(first.receipts);
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it('rejects cyclic wrapper arguments before recording or starting the effect', async () => {
    const saved = await stoppedAt('model-response', true);
    const effect = vi.fn(async () => 'done');
    const tool = Object.assign(
      new FunctionTool(
        {
          name: 'act',
          description: 'Act',
          parameters: { type: 'object', properties: { n: { type: 'number' } } },
        },
        effect,
      ),
      {
        executeWithAdmission: async (
          parameters: TToolParameters,
          _context: unknown,
          admit: TToolEffectAdmission,
        ) => {
          const effective: TToolParameters = { ...parameters };
          effective.self = effective;
          await admit(effective);
          return { success: true, data: await effect() };
        },
      },
    );
    const fresh = fixture(undefined, tool);
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(effect).not.toHaveBeenCalled();
    expect(saved.records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
  });

  it('does not persist a cyclic tool result or retry its uncertain effect', async () => {
    const saved = await stoppedAt('model-response', true);
    const effect = vi.fn(async () => {
      const result: TToolParameters = {};
      result.self = result;
      return result;
    });
    const tool = new FunctionTool(
      {
        name: 'act',
        description: 'Act',
        parameters: { type: 'object', properties: { n: { type: 'number' } } },
      },
      effect,
    );
    const fresh = fixture(undefined, tool);
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    const calls = effect.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(saved.records.some((record) => record.kind === 'tool-result')).toBe(false);
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(effect).toHaveBeenCalledTimes(calls);
  });

  it('refuses a changed committed assistant frame before dispatching recovered actions', async () => {
    const saved = await stoppedAt('model-response', true);
    const request = saved.records.find((record) => record.kind === 'model-request');
    const response = saved.records.find((record) => record.kind === 'model-response');
    if (
      !request ||
      request.kind !== 'model-request' ||
      !request.checkpoint ||
      !response ||
      response.kind !== 'model-response' ||
      response.response.role !== 'assistant'
    )
      throw new Error('Missing recovery checkpoint');
    const fresh = fixture();
    for (const message of request.checkpoint.messages) fresh.agent.injectRawMessage(message);
    fresh.agent.injectRawMessage({
      ...response.response,
      parts: [{ type: 'text', text: 'a different frame' }],
      metadata: { executionId: saved.executionId, providerCallId: saved.callId },
    });
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(saved.journal.append).not.toHaveBeenCalled();
  });

  it.each(['assistant', 'tool'] as const)(
    'refuses altered %s parts when delivering saved receipts',
    async (role) => {
      const saved = await stoppedAt('model-response', true);
      const first = fixture();
      const restored = await first.agent.resumeToolCalls({ ...saved, includeReceipts: true });
      const fresh = fixture();
      let changed = false;
      for (const message of restored.messages) {
        if (!changed && message.role === role) {
          fresh.agent.injectRawMessage({
            ...message,
            parts: [{ type: 'text', text: 'a different observation' }],
          });
          changed = true;
        } else fresh.agent.injectRawMessage(message);
      }
      expect(changed).toBe(true);
      saved.journal.append.mockClear();
      await expect(
        fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_CONFLICT',
      });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
    },
  );

  it('uses existing action ids when a dispatch stopped before body entry', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const ids = saved.records.filter((r) => r.kind === 'tool-intent').map((r) => r.actionId);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(
      saved.records.filter((r) => r.kind === 'tool-effect-start').map((r) => r.actionId),
    ).toEqual(ids);
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('refuses ambiguous effects before dispatching a safe sibling or changing history', async () => {
    const saved = await stoppedAt('tool-result');
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(saved.journal.append).not.toHaveBeenCalled();
  });

  it('reuses committed results after result acknowledgement was lost', async () => {
    const saved = await stoppedAt('tool-result', true);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(['result 1', 'result 2']);
    expect(fresh.requests).toHaveLength(0);
  });

  it('rejects mismatched result linkage and unsupported checkpoints before effects', async () => {
    const saved = await stoppedAt('tool-result', true);
    const result = saved.records.find((r) => r.kind === 'tool-result');
    if (!result || result.kind !== 'tool-result') throw new Error('Missing result');
    result.result.executionId = 'a-different-call';
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it.each(['date', 'negative-zero'] as const)(
    'rejects duplicate journal records whose %s values differ',
    async (kind) => {
      const saved = await stoppedAt('model-response', true);
      const initial = fixture();
      await initial.agent.resumeToolCalls({ ...saved, includeReceipts: true });
      const record = saved.records.find((item) => item.kind === 'tool-result');
      if (!record || record.kind !== 'tool-result') throw new Error('Missing result');
      record.result.result = kind === 'date' ? new Date('2025-01-02T03:04:05Z') : -0;
      const duplicate = structuredClone(record);
      duplicate.result.result = kind === 'date' ? '2025-01-02T03:04:05.000Z' : 0;
      saved.records.push(duplicate);
      const fresh = fixture();
      await expect(
        fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(fresh.effect).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate records that share one object but disagree on reference aliasing', async () => {
    const saved = await stoppedAt('model-response', true);
    await fixture().agent.resumeToolCalls({ ...saved, includeReceipts: true });
    const record = saved.records.find((item) => item.kind === 'tool-result');
    if (!record || record.kind !== 'tool-result') throw new Error('Missing result');
    const shared = { value: 1 };
    record.result.result = { a: shared, b: shared };
    saved.records.push({
      ...record,
      result: { ...record.result, result: { a: shared, b: { value: 1 } } },
    });
    const fresh = fixture();
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('refuses to append an old batch into unrelated live history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    fresh.agent.injectMessage('user', 'another turn');
    const before = fresh.agent.getHistory();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.agent.getHistory()).toEqual(before);
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it.each(['date', 'negative-zero'] as const)(
    'rejects a checkpoint prefix with a changed %s value before issuing receipts',
    async (kind) => {
      const source = fixture();
      source.agent.injectRawMessage({
        id: 'earlier-message',
        role: 'user',
        content: 'earlier input',
        state: 'complete',
        timestamp: new Date('2025-01-02T03:04:05Z'),
        metadata: { marker: kind === 'date' ? new Date('2025-01-02T03:04:05Z') : -0 },
      });
      const saved = await stoppedAt('model-response', true, source);
      const request = saved.records.find((record) => record.kind === 'model-request');
      if (!request || request.kind !== 'model-request' || !request.checkpoint)
        throw new Error('Missing recovery checkpoint');
      const fresh = fixture();
      for (const message of request.checkpoint.messages) {
        fresh.agent.injectRawMessage(
          message.id === 'earlier-message'
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  marker: kind === 'date' ? '2025-01-02T03:04:05.000Z' : 0,
                },
              }
            : message,
        );
      }
      await expect(
        fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_CONFLICT',
      });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
    },
  );

  it('reuses a matching assistant already committed by the original run', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const assistant = saved.source.agent.getHistory().find((m) => m.role === 'assistant');
    await saved.source.agent.resumeToolCalls(saved);
    expect(
      saved.source.agent
        .getHistory()
        .filter((m) => m.role === 'assistant')
        .map((m) => m.id),
    ).toEqual([assistant!.id]);
    expect(saved.source.requests).toHaveLength(1);
  });

  it('accepts a matching original assistant when durable receipts are requested', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const resumed = await saved.source.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    expect(resumed.receipts).toHaveLength(2);
    expect(saved.source.effect).toHaveBeenCalledTimes(2);
  });

  it('refuses receipts when a live assistant projection cannot prove the full saved frame', async () => {
    const source = fixture(undefined, undefined, (message) =>
      message.role === 'assistant'
        ? {
            ...message,
            parts: [{ type: 'text', text: 'provider part' }],
            metadata: { providerContinuation: 'opaque', extraProviderField: 'not committed' },
          }
        : message,
    );
    const saved = await stoppedAt('tool-effect-start', false, source);
    const original = source.agent.getHistory().find((message) => message.role === 'assistant');
    expect(original?.metadata?.providerContinuation).toBe('opaque');
    expect(original?.metadata?.extraProviderField).toBeUndefined();
    expect(original?.parts).toBeUndefined();
    await expect(
      source.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(source.effect).not.toHaveBeenCalled();
    await source.agent.resumeToolCalls(saved);
    expect(source.effect).toHaveBeenCalledTimes(2);
  });

  it.each(['providerId', 'modelId', 'round'] as const)(
    'does not ignore saved provider metadata that overlaps host field %s',
    async (key) => {
      const source = fixture(undefined, undefined, (message) =>
        message.role === 'assistant'
          ? { ...message, metadata: { [key]: key === 'round' ? 99 : 'provider-value' } }
          : message,
      );
      const saved = await stoppedAt('tool-effect-start', false, source);
      await expect(
        source.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_CONFLICT',
      });
      expect(source.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
    },
  );

  it('rejects conflicting saved provider metadata before creating new receipt history', async () => {
    const source = fixture(undefined, undefined, (message) =>
      message.role === 'assistant' ? { ...message, metadata: { round: 99 } } : message,
    );
    const saved = await stoppedAt('model-response', true, source);
    const fresh = fixture();
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(saved.journal.append).not.toHaveBeenCalled();
  });

  it('does not accept removed recovered frame data after changing the assistant ID', async () => {
    const source = fixture(undefined, undefined, (message) =>
      message.role === 'assistant'
        ? {
            ...message,
            parts: [{ type: 'text', text: 'provider part' }],
            metadata: { extra: 'context' },
          }
        : message,
    );
    const saved = await stoppedAt('model-response', true, source);
    const first = fixture();
    const restored = await first.agent.resumeToolCalls({ ...saved, includeReceipts: true });
    const fresh = fixture();
    for (const message of restored.messages) {
      if (message.role === 'assistant') {
        const { parts: _parts, ...withoutParts } = message;
        const { extra: _extra, ...metadata } = message.metadata ?? {};
        void _parts;
        void _extra;
        fresh.agent.injectRawMessage({ ...withoutParts, id: 'changed-id', metadata });
      } else fresh.agent.injectRawMessage(message);
    }
    saved.journal.append.mockClear();
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, includeReceipts: true }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(saved.journal.append).not.toHaveBeenCalled();
  });

  it('preserves fatal persistence errors and commits no partial restored history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') throw new Error('offline');
    });
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(fresh.requests).toHaveLength(0);
  });
  it('reuses a completed sibling while executing only the member stopped before effect admission', async () => {
    const source = fixture();
    const records: TExecutionJournalRecord[] = [];
    let firstSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      firstSettled = resolve;
    });
    await expect(
      source.agent.run('perform actions', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-effect-start' && record.parameters.n === 2) {
              await settled;
              throw new Error('crash before second effect');
            }
            records.push(structuredClone(record));
            if (record.kind === 'tool-result') firstSettled();
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((r) => r.kind === 'model-response')!;
    if (response.kind !== 'model-response') throw new Error('Missing response');
    const fresh = fixture();
    await fresh.agent.resumeToolCalls({
      executionId: response.executionId,
      callId: response.callId,
      journal: {
        read: async () => records,
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(fresh.effect).toHaveBeenCalledTimes(1);
    expect(fresh.effect.mock.calls[0][0]).toEqual({ n: 2 });
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(['result 1', 'result 2']);
  });

  it('rejects a superseded batch even if the newer provider request has no response', async () => {
    const saved = await stoppedAt('tool-intent');
    const request = saved.records.find((r) => r.kind === 'model-request')!;
    if (request.kind !== 'model-request') throw new Error('Missing request');
    saved.records.push({ ...structuredClone(request), recordId: 'next:request', callId: 'next' });
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it.each(['version', 'toolChoice', 'repeatLimit', 'duplicateId', 'duplicateRecord'])(
    'preserves replay admission constraints (%s)',
    async (variant) => {
      const saved = await stoppedAt('tool-intent');
      const request = saved.records.find((r) => r.kind === 'model-request')!;
      const response = saved.records.find((r) => r.kind === 'model-response')!;
      if (
        request.kind !== 'model-request' ||
        response.kind !== 'model-response' ||
        response.response.role !== 'assistant'
      )
        throw new Error('Missing fixture');
      if (variant === 'version') Object.assign(request.checkpoint!, { version: 2 });
      if (variant === 'toolChoice') request.options.toolChoice = 'none';
      if (variant === 'repeatLimit') {
        request.checkpoint!.maxSameToolInputs = 1;
        request.checkpoint!.sameToolInputCounts = [['act::{"n":1}', 1]];
      }
      if (variant === 'duplicateId')
        response.response.toolCalls![1].id = response.response.toolCalls![0].id;
      if (variant === 'duplicateRecord') saved.records.push({ ...request, callId: 'conflict' });
      const fresh = fixture();
      await expect(fresh.agent.resumeToolCalls(saved)).rejects.toThrow();
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
      expect(fresh.agent.getHistory()).toEqual([]);
    },
  );

  it('preserves injected input while an effect is awaiting settlement', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    fresh.effect.mockImplementation(async () => {
      enter();
      await gate;
      return 'settled';
    });
    const resuming = fresh.agent.resumeToolCalls(saved);
    await entered;
    fresh.agent.injectMessage('user', 'input received during recovery');
    release();
    await expect(resuming).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(fresh.agent.getHistory().map((m) => m.content)).toEqual([
      'input received during recovery',
    ]);
    expect(saved.records.filter((r) => r.kind === 'tool-result')).toHaveLength(2);
  });

  it('serializes concurrent recovery and re-reads settlement before the second operation', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    await Promise.all([fresh.agent.resumeToolCalls(saved), fresh.agent.resumeToolCalls(saved)]);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(saved.journal.read).toHaveBeenCalledTimes(2);
    expect(fresh.agent.getHistory()).toHaveLength(4);
  });

  it('rejects an older response arriving after a newer invocation began', async () => {
    const saved = await stoppedAt('tool-intent');
    const request = saved.records.find((r) => r.kind === 'model-request')!;
    if (request.kind !== 'model-request') throw new Error('Missing request');
    saved.records.splice(1, 0, {
      ...structuredClone(request),
      recordId: 'next:request',
      callId: 'next',
    });
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('rejects two tool calls claiming the same durable action identity', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const first = saved.records.find((r) => r.kind === 'tool-intent')!;
    if (first.kind !== 'tool-intent') throw new Error('Missing intent');
    for (const record of saved.records) {
      if ('actionId' in record) record.actionId = first.actionId;
    }
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });
  it('reports cancellation after preserving durable settlements and recovered history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    const abort = new AbortController();
    fresh.effect.mockImplementation(async () => {
      abort.abort();
      return 'settled before cancellation';
    });
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved.records.filter((r) => r.kind === 'tool-result')).toHaveLength(2);
    expect(fresh.agent.getHistory()).toHaveLength(4);
    expect(fresh.requests).toHaveLength(0);
  });

  it('reproduces the original whole-batch context-overflow projection after restart', async () => {
    const source = fixture();
    source.effect.mockImplementation(async (args) =>
      args.n === 1 ? 'x'.repeat(680_000) : 'second result',
    );
    const records: TExecutionJournalRecord[] = [];
    let requests = 0;
    await expect(
      source.agent.run('large results', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-request' && ++requests === 2)
              throw new Error('stop before next invocation');
            records.push(structuredClone(record));
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((r) => r.kind === 'model-response')!;
    if (response.kind !== 'model-response') throw new Error('Missing response');
    const options = {
      executionId: response.executionId,
      callId: response.callId,
      journal: {
        read: async () => records,
        append: async (record: TExecutionJournalRecord) => {
          records.push(record);
        },
      },
    };
    const before = source.agent
      .getHistory()
      .filter((m) => m.role === 'tool')
      .map((m) => m.content);
    expect(before[1]).toContain('Context window near capacity');
    await source.agent.resumeToolCalls(options);
    expect(source.effect).toHaveBeenCalledTimes(2);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(options);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(before);
  });
});
