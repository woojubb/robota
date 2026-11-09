import { describe, expect, it } from 'vitest';

import type { IRunOptions } from '../agent';

/**
 * IRunOptions threading audit.
 *
 * Every field advertised on the public run-options surface must be consumed by the
 * execution pipeline; a typed-but-ignored option is a contract lie (the defect class behind
 * a `maxTokens` report and the removed `stream`/`toolChoice` dead fields).
 *
 * The Record below is keyed by `keyof Required<IRunOptions>`: adding a field to IRunOptions
 * without registering its consumer seam here is a COMPILE error. Register the field only
 * after wiring it end-to-end and covering it with a threading test.
 */
const RUN_OPTION_CONSUMERS: Record<keyof Required<IRunOptions>, string> = {
  // These named `execution-stream.ts` alongside the round path, from when the streaming
  // entry built its own chat options. It no longer builds any -- there is one construction site.
  temperature: 'execution-round-provider.ts chatOptions',
  maxTokens: 'execution-round-provider.ts chatOptions',
  toolChoice: 'execution-round-provider.ts chatOptions',
  withholdHostedTools:
    'execution-round-streaming.ts round overrides → chatOptions.nativeWebTools false (peer turns)',
  sessionId: 'agent-execution.ts buildRunContext → IExecutionContext / plugin payload',
  userId: 'agent-execution.ts buildRunContext → IExecutionContext / plugin payload',
  driverId:
    'agent-execution.ts buildRunContext → IExecutionContext → execution-service.ts addUserMessage metadata',
  turnSource:
    'agent-execution.ts buildRunContext → IExecutionContext → execution-service.ts addUserMessage metadata',
  metadata: 'agent-execution.ts buildRunContext → IExecutionContext',
  signal: 'agent.ts run queue + execution-round-provider.ts provider call',
  awaitProviderSettlement: 'execution-provider-call.ts provider completion join',
  onTextDelta: 'execution-round-streaming.ts text delta dispatch; the streaming entry sinks it',
  onThinkingDelta:
    'execution-round-streaming.ts and execution-forced-summary.ts hand it to the provider call; the reply path never sees it',
  onExecutionEvent: 'execution-round-streaming.ts replay event dispatch',
  executionJournal: 'execution-journal.ts provider gate and execution-round-tools.ts batch gate',
  maxExecutionRounds: 'execution round loop cap',
  maxSameToolInputs: 'execution tool-repetition guard',
  allowToolOnlyCompletion: 'execution round completion policy',
  ephemeralSystemContext:
    'execution-round.ts derived providerMessages — transient system block, not persisted',
  traceContext:
    'execution-trace-context.ts resolveProviderCallTraceContext at the round and forced-summary invocation',
  output: 'agent-execution-structured.ts agentRunStructured',
  outputRetries: 'agent-execution-structured.ts structured-output retry budget',
};

describe('IRunOptions threading audit', () => {
  it('every advertised run option has a registered execution consumer', () => {
    for (const [field, consumer] of Object.entries(RUN_OPTION_CONSUMERS)) {
      expect(consumer, `IRunOptions.${field} must name its consumer seam`).toMatch(/\S/);
      expect(consumer, `IRunOptions.${field} must be threaded, not parked`).not.toMatch(
        /UNTHREADED|TODO/i,
      );
    }
  });
});
