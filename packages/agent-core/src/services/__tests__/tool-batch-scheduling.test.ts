import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeBatch } from '../tool-execution-batch';
import { createLogger } from '../../utils/logger';
import type { IToolExecutionRequest } from '../../interfaces/service';
import type { IToolExecutionContext, IToolExecutionResult } from '../../interfaces/tool';
import { ConversationAgent } from '../../core/conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry/function-tool';
import type { IToolCall } from '../../interfaces/messages';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function request(id: string, toolName = 'external-operation'): IToolExecutionRequest {
  return { executionId: id, toolName, parameters: {}, ownerType: 'tool', ownerId: id };
}
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('host-owned batch scheduling', () => {
  it.each(['unknown-call', 'unknown-dependency', 'cycle', 'empty-resource'])(
    'rejects %s before effects and pairs refusal receipts',
    async (variant) => {
      const scheduling = new Map([
        [
          'first',
          {
            resources: [
              { key: variant === 'empty-resource' ? '' : 'shared', access: 'write' as const },
            ],
            dependsOn:
              variant === 'cycle'
                ? ['second']
                : variant === 'unknown-dependency'
                  ? ['missing']
                  : [],
          },
        ],
        ['second', { resources: [], dependsOn: variant === 'cycle' ? ['first'] : [] }],
      ]);
      if (variant === 'unknown-call') scheduling.set('missing', { resources: [], dependsOn: [] });
      const tool = { executeTool: vi.fn() };
      const onResult = vi.fn(async () => {});
      const output = await executeBatch(
        {
          requests: [request('first'), request('second')],
          mode: 'parallel',
          scheduling,
          journal: { beforeDispatch: vi.fn(), onResult },
        },
        tool,
        createLogger('schedule-fixture'),
      );
      expect(tool.executeTool).not.toHaveBeenCalled();
      expect(output.results.map((result) => result.executionId)).toEqual(['first', 'second']);
      expect(
        output.results.every((result) => result.metadata?.dispatchStatus === 'not-dispatched'),
      ).toBe(true);
      expect(onResult).toHaveBeenCalledTimes(2);
    },
  );

  it('allows shared readers, bounds fan-out, and waits for a writer and forward fan-in', async () => {
    const readers = gate();
    const started = gate();
    const effects: string[] = [];
    let active = 0;
    let peak = 0;
    const tool = {
      executeTool: vi.fn(
        async (
          _name: string,
          _parameters: unknown,
          context?: IToolExecutionContext,
        ): Promise<IToolExecutionResult> => {
          const id = context!.executionId!;
          effects.push(id);
          peak = Math.max(peak, ++active);
          if (id.startsWith('read')) {
            if (active === 2) started.resolve();
            await readers.promise;
          }
          active--;
          return { executionId: id, success: true, result: id };
        },
      ),
    };
    const running = executeBatch(
      {
        requests: ['join', 'read-one', 'read-two', 'write'].map((id) => request(id)),
        mode: 'parallel',
        maxConcurrency: 2,
        continueOnError: true,
        scheduling: new Map([
          ['join', { resources: [], dependsOn: ['read-one', 'read-two', 'write'] }],
          ['read-one', { resources: [{ key: 'shared', access: 'read' as const }] }],
          ['read-two', { resources: [{ key: 'shared', access: 'read' as const }] }],
          ['write', { resources: [{ key: 'shared', access: 'write' as const }] }],
        ]),
      },
      tool,
      createLogger('schedule-fixture'),
    );
    try {
      await started.promise;
      expect(effects).toEqual(['read-one', 'read-two']);
    } finally {
      readers.resolve();
    }
    const output = await running;
    expect(peak).toBe(2);
    expect(effects).toEqual(['read-one', 'read-two', 'write', 'join']);
    expect(output.results.map((result) => result.executionId)).toEqual([
      'join',
      'read-one',
      'read-two',
      'write',
    ]);
  });

  it('snapshots host claims before dispatch and preserves started siblings on fail-fast', async () => {
    const failure = gate();
    const sibling = gate();
    const bothStarted = gate();
    const scheduling = new Map(
      ['first', 'sibling', 'queued'].map((id) => [
        id,
        { resources: [] as { key: string; access: 'write' }[], dependsOn: [] as string[] },
      ]),
    );
    const effects: string[] = [];
    const tool = {
      executeTool: vi.fn(
        async (
          _name: string,
          _parameters: unknown,
          context?: IToolExecutionContext,
        ): Promise<IToolExecutionResult> => {
          const id = context!.executionId!;
          effects.push(id);
          if (effects.length === 2) bothStarted.resolve();
          if (id === 'first') await failure.promise;
          else if (id === 'sibling') await sibling.promise;
          return {
            executionId: id,
            success: id !== 'first',
            result: id,
            ...(id === 'first' ? { error: 'controlled failure' } : {}),
          };
        },
      ),
    };
    const running = executeBatch(
      {
        requests: ['first', 'sibling', 'queued'].map((id) => request(id)),
        mode: 'parallel',
        maxConcurrency: 2,
        continueOnError: false,
        scheduling,
      },
      tool,
      createLogger('schedule-fixture'),
    );
    try {
      await bothStarted.promise;
      scheduling.get('queued')!.dependsOn.push('missing');
      scheduling.get('sibling')!.resources.push({ key: 'shared', access: 'write' });
      failure.resolve();
      await vi.waitFor(() => expect(effects).toEqual(['first', 'sibling']));
    } finally {
      failure.resolve();
      sibling.resolve();
    }
    const output = await running;
    expect(effects).toEqual(['first', 'sibling']);
    expect(output.results[1]).toMatchObject({ success: true, result: 'sibling' });
    expect(output.results[2]).toMatchObject({ metadata: { dispatchStatus: 'not-dispatched' } });
  });

  it('retains recovered outcomes and does not dispatch failed dependencies again', async () => {
    const tool = { executeTool: vi.fn() };
    const onResult = vi.fn(async () => {});
    const receipts = new Map<number, IToolExecutionResult>([
      [0, { executionId: 'first', success: false, result: null, error: 'Earlier failure' }],
      [2, { executionId: 'independent', success: true, result: 'already applied' }],
    ]);
    const output = await executeBatch(
      {
        requests: [request('first'), request('dependent'), request('independent')],
        mode: 'parallel',
        continueOnError: true,
        recoveredResults: receipts,
        scheduling: new Map([['dependent', { dependsOn: ['first'] }]]),
        journal: { beforeDispatch: vi.fn(), onResult },
      },
      tool,
      createLogger('schedule-fixture'),
    );
    expect(tool.executeTool).not.toHaveBeenCalled();
    expect(output.results[0]).toEqual(receipts.get(0));
    expect(output.results[1].metadata?.dispatchStatus).toBe('not-dispatched');
    expect(output.results[2]).toEqual(receipts.get(2));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('serializes unknown resources and settles queued cancellation without losing a started result', async () => {
    const first = gate();
    const abort = new AbortController();
    const tool = {
      executeTool: vi.fn(
        async (
          _name: string,
          _parameters: unknown,
          context?: IToolExecutionContext,
        ): Promise<IToolExecutionResult> => {
          await first.promise;
          return { executionId: context!.executionId!, success: true, result: 'actual completion' };
        },
      ),
    };
    const running = executeBatch(
      {
        requests: [request('first'), request('second')],
        mode: 'parallel',
        maxConcurrency: 2,
        continueOnError: true,
        scheduling: new Map(),
        signal: abort.signal,
      },
      tool,
      createLogger('schedule-fixture'),
    );
    try {
      await vi.waitFor(() => expect(tool.executeTool).toHaveBeenCalledTimes(1));
      abort.abort();
    } finally {
      first.resolve();
    }
    const output = await running;
    expect(tool.executeTool).toHaveBeenCalledTimes(1);
    expect(output.results[0]).toMatchObject({ success: true, result: 'actual completion' });
    expect(output.results[1]).toMatchObject({ success: false });
    expect(output.results.map((result) => result.executionId)).toEqual(['first', 'second']);
  });
  it('applies host policy through the real model round and pairs skipped observations', async () => {
    const scripted = createScriptedProvider([
      { text: 'ready' },
      { toolCalls: ['first', 'dependent', 'independent'].map((name) => ({ name, args: {} })) },
      { text: 'done' },
    ]);
    const config = {
      name: 'scheduled-fixture',
      aiProviders: [scripted.provider],
      defaultModel: { provider: scripted.provider.name, model: 'fixture' },
      toolExecutionPolicy: (calls: readonly IToolCall[]) => ({
        maxConcurrency: 3,
        continueOnError: true,
        scheduling: new Map(
          calls.map((call, index) => [
            call.id,
            { resources: [] as [], dependsOn: index === 1 ? [calls[0]!.id] : [] },
          ]),
        ),
      }),
    };
    const agent = new ConversationAgent(config);
    const effects: string[] = [];
    try {
      await agent.run('initialize');
      await agent.updateTools(
        ['first', 'dependent', 'independent'].map((name) =>
          FunctionTool.fromResult(
            {
              name,
              description: 'Fixture operation',
              parameters: { type: 'object', properties: {} },
            },
            async () => {
              effects.push(name);
              return {
                success: name !== 'first',
                data: name,
                ...(name === 'first' ? { error: 'Controlled failure' } : {}),
              };
            },
          ),
        ),
      );
      await agent.run('execute');
      expect(effects).toEqual(['first', 'independent']);
      const results = scripted.requests[2]!.filter((message) => message.role === 'tool');
      expect(results).toHaveLength(3);
      expect(results[1]!.content).toContain('not dispatched');
      expect(results[2]!.content).toContain('independent');
    } finally {
      await agent.destroy();
    }
  });
  it('serializes two plugins mutating one resource while independent work completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'tool-resource-schedule-'));
    roots.push(root);
    const shared = join(root, 'shared.json');
    const other = join(root, 'other.json');
    writeFileSync(shared, '0');
    writeFileSync(other, '0');
    const first = gate();
    const independent = gate();
    const tool = {
      executeTool: vi.fn(
        async (
          _name: string,
          _parameters: unknown,
          context?: IToolExecutionContext,
        ): Promise<IToolExecutionResult> => {
          const id = context!.executionId!;
          const path = id === 'independent' ? other : shared;
          const previous = Number(readFileSync(path, 'utf8'));
          if (id === 'first') await first.promise;
          writeFileSync(path, String(previous + 1));
          if (id === 'independent') independent.resolve();
          return { executionId: id, success: true, result: previous + 1 };
        },
      ),
    };
    const context = {
      requests: [
        request('first', 'plugin-one.change'),
        request('second', 'plugin-two.change'),
        request('independent'),
      ],
      mode: 'parallel' as const,
      maxConcurrency: 3,
      continueOnError: true,
      scheduling: new Map([
        ['first', { resources: [{ key: shared, access: 'write' as const }] }],
        ['second', { resources: [{ key: shared, access: 'write' as const }] }],
        ['independent', { resources: [{ key: other, access: 'write' as const }] }],
      ]),
    };
    const running = executeBatch(context, tool, createLogger('schedule-fixture'));
    try {
      await independent.promise;
      expect(Number(readFileSync(other, 'utf8'))).toBe(1);
      // The second writer must not observe or change the shared resource before the first settles.
      expect(Number(readFileSync(shared, 'utf8'))).toBe(0);
    } finally {
      first.resolve();
      await running;
    }
    expect(Number(readFileSync(shared, 'utf8'))).toBe(2);
    expect((await running).results.map((result) => result.executionId)).toEqual([
      'first',
      'second',
      'independent',
    ]);
  });

  it('skips only failed dependencies, settles every ID, and preserves independent success', async () => {
    const tool = {
      executeTool: vi.fn(
        async (
          _name: string,
          _parameters: unknown,
          context?: IToolExecutionContext,
        ): Promise<IToolExecutionResult> => ({
          executionId: context!.executionId!,
          success: context!.executionId !== 'first',
          result: context!.executionId === 'first' ? null : 'completed',
          ...(context!.executionId === 'first' ? { error: 'Controlled failure' } : {}),
        }),
      ),
    };
    const beforeDispatch = vi.fn(async () => {});
    const onResult = vi.fn(async () => {});
    const context = {
      requests: [request('first'), request('dependent'), request('independent')],
      mode: 'parallel' as const,
      maxConcurrency: 3,
      continueOnError: true,
      scheduling: new Map([
        ['first', { resources: [] as [], dependsOn: [] as string[] }],
        ['dependent', { resources: [] as [], dependsOn: ['first'] }],
        ['independent', { resources: [] as [], dependsOn: [] as string[] }],
      ]),
      journal: { beforeDispatch, onResult },
    };
    const output = await executeBatch(context, tool, createLogger('schedule-fixture'));
    expect(output.results.map((result) => result.executionId)).toEqual([
      'first',
      'dependent',
      'independent',
    ]);
    expect(output.results[1]).toMatchObject({
      success: false,
      metadata: { errorCode: 'tool_call_skipped', dispatchStatus: 'not-dispatched' },
    });
    expect(output.results[2]).toMatchObject({ success: true, result: 'completed' });
    expect(tool.executeTool).toHaveBeenCalledTimes(2);
    expect(beforeDispatch).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(3);
  });
});
