import type { IEventService, IBaseEventData, IEventContext } from '@robota-sdk/agent-core';
import type { ISubagentManager, ISubagentJobResult } from '@robota-sdk/agent-executor';
import type { ISubagentJobState } from '@robota-sdk/agent-interface-transport';

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
 * A fake ISubagentManager. `outputs` is either an ordered array (indexed by
 * spawn order) or a function mapping the spawn request to an output string.
 */
export function fakeManager(outputs: string[] | ((spawn: IRecordedSpawn) => string)): {
  manager: ISubagentManager;
  spawns: IRecordedSpawn[];
} {
  const spawns: IRecordedSpawn[] = [];
  let index = 0;
  const results = new Map<string, ISubagentJobResult>();
  const manager: ISubagentManager = {
    async spawn(request) {
      const id = `job-${index}`;
      const recorded: IRecordedSpawn = {
        prompt: request.prompt,
        type: request.type,
        model: request.model,
        allowedTools: request.allowedTools,
        disallowedTools: request.disallowedTools,
      };
      spawns.push(recorded);
      const output = Array.isArray(outputs) ? (outputs[index] ?? '') : outputs(recorded);
      results.set(id, { jobId: id, output });
      index += 1;
      return jobState(id);
    },
    async wait(jobId) {
      const result = results.get(jobId);
      if (!result) throw new Error(`no result for ${jobId}`);
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

/** A capturing event service that records emitted event names. */
export function capturingEvents(): { events: IEventService; names: string[] } {
  const names: string[] = [];
  const events: IEventService = {
    emit: (eventType: string, _data: IBaseEventData, _context?: IEventContext) => {
      names.push(eventType);
    },
    subscribe: () => {},
    unsubscribe: () => {},
  };
  return { events, names };
}
