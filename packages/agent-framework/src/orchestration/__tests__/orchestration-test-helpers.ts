import type {
  IEventService,
  IBaseEventData,
  IEventContext,
  ITokenUsage,
} from '@robota-sdk/agent-core';
import type { ISubagentManager } from '@robota-sdk/agent-executor';
import type { ISubagentJobResult } from '@robota-sdk/agent-interface-execution';
import type { ISubagentJobState } from '@robota-sdk/agent-interface-execution';

export const TEST_CONTEXT = { parentSessionId: 'sess-1', cwd: '/tmp/work', depth: 0 };

/** A minimal completed job-state stub for the fake manager. */
export function jobState(id: string): ISubagentJobState {
  return {
    id,
    type: 'worker',
    label: 'step',
    parentSessionId: TEST_CONTEXT.parentSessionId,
    status: 'completed',
    mode: 'foreground',
    depth: 0,
    cwd: TEST_CONTEXT.cwd,
    promptPreview: '',
    updatedAt: '2026-07-17T00:00:00.000Z',
  };
}

export interface IRecordedSpawn {
  prompt: string;
  type: string;
  model?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
}

/**
 * Extra, opt-in behaviour for {@link fakeManager}: attach usage to a spawn's result, or make a
 * spawn's `wait()` reject instead of resolving. Both are indexed the same way as `outputs` — an
 * ordered array read by spawn order, or a function given the recorded spawn and its index.
 */
export interface IFakeManagerOptions {
  /** Token usage to attach to the job result at this spawn index (absent ⇒ no `usage` field). */
  usage?:
    | (ITokenUsage | undefined)[]
    | ((spawn: IRecordedSpawn, index: number) => ITokenUsage | undefined);
  /** When truthy for a spawn index, that job's `wait()` rejects instead of resolving. */
  failing?: boolean[] | ((spawn: IRecordedSpawn, index: number) => boolean);
  /** The error a failing spawn's `wait()` rejects with. Defaults to a stock `Error` per job id. */
  failure?: (spawn: IRecordedSpawn, index: number) => unknown;
  /** Runs at the start of `wait()`, before it resolves — e.g. to move the clock mid-turn. */
  onWait?: (taskId: string) => void | Promise<void>;
}

/**
 * A fake ISubagentManager. `outputs` is either an ordered array (indexed by
 * spawn order) or a function mapping the spawn request to an output string.
 */
export function fakeManager(
  outputs: string[] | ((spawn: IRecordedSpawn) => string),
  options: IFakeManagerOptions = {},
): {
  manager: ISubagentManager;
  spawns: IRecordedSpawn[];
} {
  const spawns: IRecordedSpawn[] = [];
  let index = 0;
  const results = new Map<string, ISubagentJobResult>();
  const failures = new Map<string, unknown>();
  const manager: ISubagentManager = {
    async spawn(request) {
      const id = `job-${index}`;
      const current = index;
      const recorded: IRecordedSpawn = {
        prompt: request.prompt,
        type: request.agentType,
        model: request.model,
        allowedTools: request.allowedTools,
        disallowedTools: request.disallowedTools,
      };
      spawns.push(recorded);
      const shouldFail = Array.isArray(options.failing)
        ? (options.failing[current] ?? false)
        : (options.failing?.(recorded, current) ?? false);
      if (shouldFail) {
        failures.set(
          id,
          options.failure?.(recorded, current) ??
            new Error(`fakeManager: forced failure for ${id}`),
        );
      } else {
        const output = Array.isArray(outputs) ? (outputs[current] ?? '') : outputs(recorded);
        const usage = Array.isArray(options.usage)
          ? options.usage[current]
          : options.usage?.(recorded, current);
        results.set(id, { taskId: id, output, ...(usage ? { usage } : {}) });
      }
      index += 1;
      return jobState(id);
    },
    async wait(taskId) {
      await options.onWait?.(taskId);
      if (failures.has(taskId)) throw failures.get(taskId);
      const result = results.get(taskId);
      if (!result) throw new Error(`no result for ${taskId}`);
      return result;
    },
    list: () => [],
    get: () => undefined,
    cancel: async () => {},
    close: async () => {},
    send: async () => {},
    shutdown: async () => {},
  };
  return { manager, spawns };
}

/** One captured `emit()` call, kept alongside the flat `names` list for deeper assertions. */
export interface ICapturedEvent {
  type: string;
  data: IBaseEventData;
  context?: IEventContext;
}

/** A capturing event service that records emitted event names (and, in `records`, the full call). */
export function capturingEvents(): {
  events: IEventService;
  names: string[];
  records: ICapturedEvent[];
} {
  const names: string[] = [];
  const records: ICapturedEvent[] = [];
  const events: IEventService = {
    emit: (eventType: string, data: IBaseEventData, context?: IEventContext) => {
      names.push(eventType);
      records.push({ type: eventType, data, context });
    },
    subscribe: () => {},
    unsubscribe: () => {},
  };
  return { events, names, records };
}
