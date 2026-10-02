import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import { ConversationAgent } from '../../core/conversation-agent';
import { registerModelMetadata } from '../../context/models';
import { FunctionTool } from '../../tool-registry';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import { ARGUMENT_DECODE_ERROR_CODE, UNKNOWN_TOOL_ERROR_CODE } from '../tool-execution-constants';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';
import type { IToolExecutionResult, TToolParameters } from '../../interfaces/tool';

const agents: ConversationAgent[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
});

class OutcomeObserver extends AbstractPlugin {
  readonly name = 'fixture-outcome-observer';
  readonly version = '1';
  readonly outcomes: IToolExecutionResult[] = [];
  override async afterToolCall(
    _name: string,
    _parameters: TToolParameters,
    result: IToolExecutionResult,
  ) {
    this.outcomes.push(result);
  }
}

function asset() {
  const directory = mkdtempSync(join(tmpdir(), 'tool-observation-'));
  directories.push(directory);
  const counter = join(directory, 'counter.json');
  const journalPath = join(directory, 'journal.jsonl');
  writeFileSync(counter, '0');
  writeFileSync(journalPath, '');
  const read = (): TExecutionJournalRecord[] =>
    readFileSync(journalPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(
        (line) =>
          JSON.parse(line, (key, value: unknown) =>
            key === 'timestamp' && typeof value === 'string' ? new Date(value) : value,
          ) as TExecutionJournalRecord,
      );
  const journal = {
    async append(record: TExecutionJournalRecord) {
      const previous = read().find((entry) => entry.recordId === record.recordId);
      if (previous) expect(record).toEqual(previous);
      else appendFileSync(journalPath, JSON.stringify(record) + '\n');
    },
    async read() {
      return read();
    },
  };
  return { counter, read, journal, count: () => Number(readFileSync(counter, 'utf8')) };
}

function fixture(
  store: ReturnType<typeof asset>,
  turns: TScriptedTurn[],
  failAfterEffect = false,
  malformed = false,
) {
  const scripted = createScriptedProvider(turns);
  const chat = scripted.provider.chat.bind(scripted.provider);
  if (malformed)
    scripted.provider.chat = async (...args) => {
      const response = await chat(...args);
      if (response.role === 'assistant' && response.toolCalls?.[1]) {
        response.toolCalls[1].function.arguments = '{invalid';
      }
      return response;
    };
  const model = 'tool-observation-fixture';
  registerModelMetadata({ id: model, name: model, contextWindow: 1000, maxOutput: 100 });
  const observer = new OutcomeObserver();
  const agent = new ConversationAgent({
    name: 'tool-observation-fixture',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model },
    plugins: [observer],
    tools: [
      new FunctionTool(
        {
          name: 'read',
          description: 'Observe fixture state',
          parameters: { type: 'object', properties: {} },
        },
        async () => 'observed',
      ),
      new FunctionTool(
        {
          name: 'act',
          description: 'Mutate fixture asset',
          parameters: { type: 'object', properties: {} },
        },
        async () => {
          const count = store.count() + 1;
          writeFileSync(store.counter, String(count));
          if (failAfterEffect) throw new Error('acknowledgement lost after fixture mutation');
          return `retained fixture receipt ${count}`;
        },
      ),
    ],
  });
  agents.push(agent);
  return { agent, observer, ...scripted };
}

function batch(name = 'act'): TScriptedTurn {
  return {
    toolCalls: [
      { name: 'read', args: {} },
      { name, args: {} },
    ],
    usage: { inputTokens: 850, outputTokens: 1 },
  };
}

function omitted(agent: ConversationAgent) {
  const message = agent
    .getHistory()
    .find((entry) => entry.role === 'tool' && entry.name !== 'read');
  expect(message?.role).toBe('tool');
  if (message?.role !== 'tool') throw new Error('Missing mutation observation');
  expect(message.content).not.toMatch(/re-request skipped|execution result skipped/iu);
  expect(message.metadata).toMatchObject({
    resultOmitted: true,
    observationError: 'context_overflow',
  });
  return message;
}

describe('executed effects with context-limited observations through the public runtime', () => {
  it.each([false, true])(
    'preserves successful execution and the retained receipt (streaming=%s)',
    async (streaming) => {
      const store = asset();
      const source = fixture(store, [batch(), { text: 'done' }]);
      if (streaming) {
        for await (const _text of source.agent.runStream('act once', {
          executionJournal: store.journal,
        })) {
          /* Drive public streaming. */
        }
      } else await source.agent.run('act once', { executionJournal: store.journal });
      expect(store.count()).toBe(1);
      expect(omitted(source.agent).metadata).toMatchObject({ success: true });
      expect(source.observer.outcomes.find((result) => result.toolName === 'act')).toMatchObject({
        success: true,
      });
      expect(
        store.read().find((record) => record.kind === 'tool-result' && record.toolName === 'act'),
      ).toMatchObject({ result: { success: true, result: 'retained fixture receipt 1' } });
      expect(source.requests.at(-1)?.filter((message) => message.role === 'tool')).toEqual(
        source.agent.getHistory().filter((message) => message.role === 'tool'),
      );
    },
  );

  it('does not infer no effect from an error after a real mutation', async () => {
    const store = asset();
    const source = fixture(store, [batch(), { text: 'reconcile' }], true);
    await source.agent.run('act once', { executionJournal: store.journal });
    expect(store.count()).toBe(1);
    const observation = omitted(source.agent);
    expect(observation.metadata).toMatchObject({ success: false });
    expect(observation.content).toMatch(/effects may have occurred/iu);
    expect(observation.content).toMatch(/reconcile.*before retry/iu);
    expect(
      store.read().find((record) => record.kind === 'tool-result' && record.toolName === 'act'),
    ).toMatchObject({
      result: { success: false, error: expect.stringContaining('acknowledgement lost') },
    });
  });

  it.each(['unknown', 'malformed'])(
    'preserves proof that the %s call was never dispatched',
    async (kind) => {
      const store = asset();
      const source = fixture(
        store,
        [batch(kind === 'unknown' ? 'missing' : 'act'), { text: 'correct call' }],
        false,
        kind === 'malformed',
      );
      await source.agent.run('act once', { executionJournal: store.journal });
      expect(store.count()).toBe(0);
      const observation = omitted(source.agent);
      expect(observation.metadata).toMatchObject({
        success: false,
        errorCode: kind === 'unknown' ? UNKNOWN_TOOL_ERROR_CODE : ARGUMENT_DECODE_ERROR_CODE,
      });
      expect(observation.content).toMatch(/not dispatched/iu);
      expect(
        store
          .read()
          .filter((record) => record.kind === 'tool-effect-start')
          .map((record) => record.toolName),
      ).toEqual(['read']);
    },
  );

  it.each([false, true])(
    'recovers only a durably recorded receipt after acknowledgement loss (persisted=%s)',
    async (persisted) => {
      const store = asset();
      const source = fixture(store, [batch(), { text: 'must not be reached' }]);
      await expect(
        source.agent.run('act once', {
          executionJournal: {
            append: async (record) => {
              if (!persisted && record.kind === 'tool-result' && record.toolName === 'act')
                throw new Error('result persistence failed');
              await store.journal.append(record);
              if (record.kind === 'tool-result' && record.toolName === 'act')
                throw new Error('lost result write acknowledgement');
            },
          },
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
      expect(store.count()).toBe(1);
      const response = store.read().find((record) => record.kind === 'model-response');
      if (!response || response.kind !== 'model-response')
        throw new Error('Missing response receipt');
      const fresh = fixture(store, [{ text: 'fresh observation' }]);
      if (!persisted) {
        await expect(
          fresh.agent.resume({ executionId: response.executionId, journal: store.journal }),
        ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
        expect(store.count()).toBe(1);
        expect(fresh.requests).toHaveLength(0);
        expect(fresh.agent.getHistory()).toEqual([]);
        expect(fresh.observer.outcomes).toHaveLength(0);
        return;
      }
      await fresh.agent.resume({ executionId: response.executionId, journal: store.journal });
      expect(store.count()).toBe(1);
      expect(fresh.observer.outcomes).toHaveLength(0);
      expect(omitted(fresh.agent).metadata).toMatchObject({ success: true });
      expect(fresh.requests).toHaveLength(1);
      expect(
        store
          .read()
          .filter((record) => record.kind === 'tool-effect-start' && record.toolName === 'act'),
      ).toHaveLength(1);
    },
  );
});
