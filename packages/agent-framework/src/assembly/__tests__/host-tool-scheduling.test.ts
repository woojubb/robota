import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { FunctionTool } from '@robota-sdk/agent-core';
import type { IAgentConfig, IToolWithEventService } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../../interactive/interactive-session.js';
import { createSession } from '../create-session.js';
import type { ICreateSessionOptions } from '../create-session-types.js';

type Policy = NonNullable<IAgentConfig['toolExecutionPolicy']>;
const names = ['First', 'Dependent', 'Independent'];
const terminal: ICreateSessionOptions['terminal'] = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};
function tool(
  name: string,
  effect: () => Promise<{ success: boolean; data: string; error?: string }>,
) {
  return FunctionTool.fromResult(
    {
      name,
      description: 'Disposable fixture operation',
      parameters: { type: 'object', properties: {} },
    },
    effect,
  );
}

async function fixture(
  surface: 'factory' | 'interactive',
  tools: IToolWithEventService[],
  policy?: Policy,
  deniedTools: string[] = [],
  onToolExecution?: ICreateSessionOptions['onToolExecution'],
) {
  const root = mkdtempSync(join(tmpdir(), 'host-tool-scheduling-'));
  const scripted = createScriptedProvider([
    { toolCalls: names.map((name) => ({ name, args: {} })) },
    { text: 'done' },
  ]);
  const options = {
    cwd: root,
    config: {
      defaultTrustLevel: 'safe' as const,
      provider: { name: scripted.provider.name, model: 'fixture-model', apiKey: undefined },
      permissions: { allow: names, deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    terminal,
    provider: scripted.provider,
    defaultTools: [],
    additionalTools: tools,
    deniedTools,
    ...(onToolExecution ? { onToolExecution } : {}),
    ...(policy === undefined ? {} : { toolExecutionPolicy: policy }),
  };
  try {
    if (surface === 'factory') {
      const { session } = await createSession(options);
      return {
        ...scripted,
        run: () => session.run('Execute the supplied fixture operations.'),
        close: async () => {
          await session.shutdown();
          rmSync(root, { recursive: true, force: true });
        },
      };
    }
    const session = new InteractiveSession({ ...options, bare: true });
    return {
      ...scripted,
      run: async () => (await session.submit('Execute the supplied fixture operations.')).completed,
      close: async () => {
        await session.shutdown();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

it('a registered tool cannot turn its dispatched failure into another undispatched settlement', async () => {
  const effects: string[] = [];
  const onToolExecution = vi.fn();
  const owned = await fixture('factory', names.map((name) => tool(name, async () => {
    effects.push(name);
    return { success: name !== 'First', data: 'ORIGINAL_OBSERVATION', error: name === 'First' ? 'Controlled failure' : undefined,
      parts: [{ type: 'text' as const, text: 'ORIGINAL_OBSERVATION' }],
      metadata: { dispatchStatus: 'not-dispatched' },
    };
  })), undefined, [], onToolExecution);
  try {
    await owned.run();
    expect(effects).toEqual(names);
    const settlements = onToolExecution.mock.calls.map(([event]) => event).filter((event) => event.type === 'end' && event.toolName === 'First');
    expect(settlements).toHaveLength(1);
    expect(settlements[0]?.toolResultData).toContain('ORIGINAL_OBSERVATION');
    expect(JSON.stringify(owned.requests[1]?.find((message) => message.role === 'tool'))).toContain('ORIGINAL_OBSERVATION');
  } finally { await owned.close(); }
});

describe.each(['factory', 'interactive'] as const)(
  'host scheduling through %s assembly',
  (surface) => {
    it('keeps undeclared shared-state calls serial', async () => {
      const events: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const owned = await fixture(
        surface,
        names.map((name) =>
          tool(name, async () => {
            events.push(name);
            if (name === 'First') await held;
            return { success: true, data: name };
          }),
        ),
      );
      const run = owned.run();
      try {
        await vi.waitFor(() => expect(events).toEqual(['First']));
        release();
        await run;
        expect(events).toEqual(names);
      } finally {
        release();
        try {
          await run;
        } finally {
          await owned.close();
        }
      }
    });

    it('does not turn independent scheduling declarations into permission approval', async () => {
      const effects: string[] = [];
      const policy: Policy = (calls) => ({
        maxConcurrency: 3,
        scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
      });
      const owned = await fixture(
        surface,
        names.map((name) =>
          tool(name, async () => {
            effects.push(name);
            return { success: true, data: name };
          }),
        ),
        policy,
        ['First'],
      );
      try {
        await owned.run();
        expect(effects).not.toContain('First');
        expect(new Set(effects)).toEqual(new Set(['Dependent', 'Independent']));
        const receipts = owned.requests[1]!.filter((message) => message.role === 'tool');
        expect(receipts).toHaveLength(3);
        expect(receipts[0]!.metadata?.success).toBe(false);
      } finally {
        await owned.close();
      }
    });
    it('skips a failed dependency while collecting the independent outcome', async () => {
      const effects: string[] = [];
      const policy: Policy = (calls) => ({
        maxConcurrency: 2,
        continueOnError: true,
        scheduling: new Map(
          calls.map((call, index) => [
            call.id,
            {
              resources: [],
              dependsOn: index === 1 ? [calls[0]!.id] : [],
            },
          ]),
        ),
      });
      const owned = await fixture(
        surface,
        names.map((name) =>
          tool(name, async () => {
            effects.push(name);
            return {
              success: name !== 'First',
              data: name,
              ...(name === 'First' ? { error: 'Controlled failure' } : {}),
            };
          }),
        ),
        policy,
      );
      try {
        await owned.run();
        expect(effects).toEqual(['First', 'Independent']);
        const receipts = owned.requests[1]!.filter((message) => message.role === 'tool');
        expect(receipts.map((message) => message.toolCallId)).toEqual(
          names.map((_name, index) => `scripted-call-1-${index}`),
        );
        expect(receipts[1]!.content).toContain('not dispatched');
        expect(receipts[2]!.content).toContain('Independent');
      } finally {
        await owned.close();
      }
    });

    it('serializes shared writes while an admitted independent call can run', async () => {
      const events: string[] = [];
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const policy: Policy = (calls) => ({
        maxConcurrency: 2,
        scheduling: new Map(
          calls.map((call, index) => [
            call.id,
            {
              resources: [
                {
                  key: index === 2 ? 'independent-resource' : 'shared-resource',
                  access: 'write' as const,
                },
              ],
            },
          ]),
        ),
      });
      const owned = await fixture(
        surface,
        names.map((name) =>
          tool(name, async () => {
            events.push(`start:${name}`);
            if (name === 'First') await held;
            events.push(`end:${name}`);
            return { success: true, data: name };
          }),
        ),
        policy,
      );
      const run = owned.run();
      try {
        await vi.waitFor(() => expect(events).toContain('end:Independent'), { timeout: 1_000 });
        expect(events).not.toContain('start:Dependent');
        release();
        await run;
        expect(events).toEqual([
          'start:First',
          'start:Independent',
          'end:Independent',
          'end:First',
          'start:Dependent',
          'end:Dependent',
        ]);
        expect(owned.requests[1]!.filter((message) => message.role === 'tool')).toHaveLength(3);
      } finally {
        release();
        try {
          await run;
        } finally {
          await owned.close();
        }
      }
    });
  },
);
