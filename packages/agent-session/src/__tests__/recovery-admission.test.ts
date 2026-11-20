import { afterEach, expect, it, vi } from 'vitest';
import { ConversationAgent, FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { wrapToolWithPermission } from '../tool-permission-wrapper.js';
import type {
  IToolExecutionContext,
  TExecutionJournalRecord,
  TToolEffectAdmission,
  TToolParameters,
} from '@robota-sdk/agent-core';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

it.each(['scalar', 'date', 'alias', 'hidden', 'symbol', 'accessor', 'frozen'] as const)(
  'does not execute changed %s arguments after the permission wrapper records admission',
  async (mutation) => {
    let owned: TToolParameters | undefined;
    const effect = vi.fn(async (parameters: TToolParameters) => parameters.n);
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
          _context: IToolExecutionContext,
          admit: TToolEffectAdmission,
        ) => {
          const at = new Date('2025-01-02T03:04:05Z');
          const effective = { ...parameters, nested: { at, aliases: [at, at] } };
          if (mutation === 'hidden') Object.defineProperty(effective, 'mode', { value: 'hidden' });
          if (mutation === 'symbol')
            Object.defineProperty(effective, Symbol('mode'), { value: 'symbol' });
          if (mutation === 'frozen')
            Object.defineProperty(effective, 'empty', {
              value: Object.freeze([]),
              enumerable: true,
              configurable: true,
              writable: true,
            });
          if (mutation === 'accessor')
            Object.defineProperty(effective, 'mode', {
              enumerable: true,
              configurable: true,
              get: () => 'accessor',
            });
          owned = effective;
          await admit(effective);
          return { success: true, data: await effect(effective) };
        },
      },
    );
    const wrapped = wrapToolWithPermission(tool, {
      sessionId: 'session',
      cwd: '/tmp',
      config: { permissions: { allow: [], deny: [] }, hooks: {} },
      terminal: {
        write: vi.fn(),
        writeLine: vi.fn(),
        writeMarkdown: vi.fn(),
        writeError: vi.fn(),
        prompt: vi.fn(async () => ''),
        select: vi.fn(async () => 0),
        spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
      },
      hookTypeExecutors: [],
      getPermissionMode: () => 'default',
      log: () => undefined,
      checkPermission: async () => true,
    });
    const provider = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: { n: 1 } }] },
    ]).provider;
    const makeAgent = () => {
      const agent = new ConversationAgent({
        name: 'admission-fixture',
        aiProviders: [provider],
        defaultModel: { provider: provider.name, model: 'test-model' },
        tools: [wrapped],
      });
      agents.push(agent);
      return agent;
    };
    const records: TExecutionJournalRecord[] = [];
    await expect(
      makeAgent().run('act', {
        executionJournal: {
          append: async (record) => {
            records.push(structuredClone(record));
            if (record.kind === 'model-response') throw new Error('lost acknowledgement');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((record) => record.kind === 'model-response');
    if (!response || response.kind !== 'model-response') throw new Error('Missing saved response');
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const journal = {
      read: async () => structuredClone(records),
      append: async (record: TExecutionJournalRecord) => {
        if (record.kind === 'tool-effect-start') {
          reached();
          await gate;
        }
        records.push(structuredClone(record));
      },
    };
    const pending = makeAgent().resumeToolCalls({
      executionId: response.executionId,
      callId: response.callId,
      journal,
      includeReceipts: true,
    });
    if (
      mutation === 'hidden' ||
      mutation === 'symbol' ||
      mutation === 'accessor' ||
      mutation === 'frozen'
    ) {
      await expect(pending).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
      expect(effect).not.toHaveBeenCalled();
      expect(records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
      return;
    }
    await appending;
    if (!owned) throw new Error('Missing inner arguments');
    if (mutation === 'scalar') owned.n = 2;
    else if (mutation === 'date') (owned.nested as { at: Date }).at.setUTCFullYear(2030);
    else {
      const nested = owned.nested as { at: Date; aliases: Date[] };
      nested.aliases[1] = new Date(nested.at);
    }
    release();
    await expect(pending).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(effect).not.toHaveBeenCalled();
    expect(records.find((record) => record.kind === 'tool-effect-start')).toMatchObject({
      parameters: { n: 1 },
    });
  },
);
