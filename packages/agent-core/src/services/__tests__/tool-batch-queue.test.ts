import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOOL_QUEUE_EVENTS } from '../../event-service/span-events.js';
import { executeBatch } from '../tool-execution-batch.js';
import { createLogger } from '../../utils/logger.js';
import type { IEventService } from '../../interfaces/event-service.js';
import type { IToolExecutionRequest } from '../../interfaces/service.js';
import type { IToolExecutionContext } from '../../interfaces/tool.js';

const AT = '2026-10-02T00:00:00.000Z';
const logger = createLogger('queue-fixture');
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
const request = (id: string, emit: IEventService['emit']): IToolExecutionRequest => ({
  executionId: id, toolName: 'fixture', parameters: { private: 'never-export-this' },
  ownerType: 'tool', ownerId: id, eventService: { emit } as IEventService,
});
const observe = () => {
  const events: Record<string, unknown>[] = [];
  const emit = vi.fn((name, data) => { if (name === TOOL_QUEUE_EVENTS.COMPLETED) events.push(data); });
  return { events, emit };
};
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('owned scheduler queue observations', () => {
  it('ends queue wait before journal admission and preserves a later shared-resource wait', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(AT));
    const journal = gate(), body = gate(), enteredJournal = gate(), enteredBody = gate();
    const { events, emit } = observe();
    const running = executeBatch({
      requests: [request('first', emit), request('second', emit)], mode: 'parallel', maxConcurrency: 2,
      scheduling: new Map(['first', 'second'].map((id) => [id, { resources: [{ key: 'same-file', access: 'write' as const }] }])),
      journal: { beforeDispatch: async (index) => { if (index === 0) { enteredJournal.resolve(); await journal.promise; } }, onResult: async () => {} },
    }, { executeTool: async (_name, _args, context?: IToolExecutionContext) => {
      if (context?.executionId === 'first') { enteredBody.resolve(); await body.promise; }
      return { executionId: context!.executionId!, success: true, result: 'observed' };
    } }, logger);
    await enteredJournal.promise;
    expect(events).toEqual([{ executionId: 'first', queuedAt: AT, timestamp: new Date(AT), endedAt: AT, disposition: 'admission-started' }]);
    vi.setSystemTime(new Date(Date.parse(AT) + 20)); journal.resolve(); await enteredBody.promise;
    expect(events).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse(AT) + 100)); body.resolve();
    const output = await running;
    expect(events[1]).toEqual({ executionId: 'second', queuedAt: AT, timestamp: new Date(Date.parse(AT) + 100), endedAt: new Date(Date.parse(AT) + 100).toISOString(), disposition: 'admission-started' });
    expect(output.results.map((entry) => entry.executionId)).toEqual(['first', 'second']);
    expect(JSON.stringify(events)).not.toContain('never-export-this');
  });

  it('ends a failed dependency queue without inventing an admitted attempt', async () => {
    const { events, emit } = observe(); const effects: string[] = [];
    const output = await executeBatch({
      requests: [request('first', emit), request('dependent', emit)], mode: 'parallel', continueOnError: true,
      scheduling: new Map([['first', { resources: [] }], ['dependent', { dependsOn: ['first'], resources: [] }]]),
    }, { executeTool: async (_name, _args, context) => {
      effects.push(context!.executionId!); return { executionId: context!.executionId!, success: false, result: null, error: 'Deliberate failure' };
    } }, logger);
    expect(effects).toEqual(['first']);
    expect(output.results.map((entry) => entry.executionId)).toEqual(['first', 'dependent']);
    expect(events.map((event) => [event.executionId, event.disposition])).toEqual([['first', 'admission-started'], ['dependent', 'not-dispatched']]);
  });

  it('settles every cancelled queued member once while retaining the active result', async () => {
    const { events, emit } = observe(); const body = gate(), entered = gate(), abort = new AbortController();
    const running = executeBatch({ requests: [request('first', emit), request('queued', emit)], mode: 'parallel', maxConcurrency: 1, continueOnError: true, signal: abort.signal }, {
      executeTool: async (_name, _args, context) => { entered.resolve(); await body.promise; return { executionId: context!.executionId!, success: true, result: 'actual-settlement' }; },
    }, logger);
    await entered.promise; abort.abort(); body.resolve();
    const output = await running;
    expect(output.results[0].result).toBe('actual-settlement');
    expect(output.results[1].success).toBe(false);
    expect(events.map((event) => [event.executionId, event.disposition])).toEqual([['first', 'admission-started'], ['queued', 'not-dispatched']]);
  });

  it('does not requeue restored settlements or let throwing/rejecting observers change execution', async () => {
    const events = observe();
    const throwing = vi.fn(() => { throw new Error('Observer failure'); });
    const rejecting = vi.fn(async () => { throw new Error('Observer rejected'); });
    const restored = { executionId: 'saved', success: true, result: 'saved-effect' };
    const output = await executeBatch({ requests: [request('saved', events.emit), request('throw', throwing), request('reject', rejecting)], mode: 'sequential', continueOnError: true, recoveredResults: new Map([[0, restored]]) }, {
      executeTool: async (_name, _args, context) => ({ executionId: context!.executionId!, success: true, result: 'new-effect' }),
    }, logger);
    expect(events.events).toEqual([]);
    expect(throwing).toHaveBeenCalledOnce(); expect(rejecting).toHaveBeenCalledOnce();
    expect(output.results).toEqual([restored, { executionId: 'throw', success: true, result: 'new-effect' }, { executionId: 'reject', success: true, result: 'new-effect' }]);
  });
});
