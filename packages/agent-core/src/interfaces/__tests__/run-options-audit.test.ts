import { describe, expect, it } from 'vitest';

import type { IRunOptions } from '../agent';

/**
 * CORE-017 — IRunOptions threading audit.
 *
 * Every field advertised on the public run-options surface must be consumed by the
 * execution pipeline; a typed-but-ignored option is a contract lie (the defect class behind
 * the CORE-016 maxTokens report and the removed `stream`/`toolChoice` dead fields).
 *
 * The Record below is keyed by `keyof Required<IRunOptions>`: adding a field to IRunOptions
 * without registering its consumer seam here is a COMPILE error. Register the field only
 * after wiring it end-to-end and covering it with a threading test.
 */
const RUN_OPTION_CONSUMERS: Record<keyof Required<IRunOptions>, string> = {
  // CORE-042: these named `execution-stream.ts` alongside the round path, from when the streaming
  // entry built its own chat options. It no longer builds any -- there is one construction site.
  temperature: 'execution-round-provider.ts chatOptions (CORE-016)',
  maxTokens: 'execution-round-provider.ts chatOptions (CORE-016)',
  toolChoice: 'execution-round-provider.ts chatOptions (CORE-017)',
  sessionId: 'robota-execution.ts buildRunContext → IExecutionContext / plugin payload',
  userId: 'robota-execution.ts buildRunContext → IExecutionContext / plugin payload',
  driverId:
    'robota-execution.ts buildRunContext → IExecutionContext → execution-service.ts addUserMessage metadata (PEER-007)',
  metadata: 'robota-execution.ts buildRunContext → IExecutionContext',
  signal: 'robota.ts run queue + execution-round-provider.ts provider call',
  onTextDelta: 'execution-round-streaming.ts text delta dispatch; the streaming entry sinks it',
  onExecutionEvent: 'execution-round-streaming.ts replay event dispatch',
  maxExecutionRounds: 'execution round loop cap',
  maxSameToolInputs: 'execution tool-repetition guard',
  allowToolOnlyCompletion: 'execution round completion policy (CORE-011)',
  ephemeralSystemContext:
    'execution-round.ts derived providerMessages — transient system block, not persisted (SELFHOST-008 P3)',
  output: 'robota-execution-structured.ts robotaRunStructured (CORE-015)',
  outputRetries: 'robota-execution-structured.ts structured-output retry budget (CORE-015)',
};

describe('IRunOptions threading audit (CORE-017)', () => {
  it('every advertised run option has a registered execution consumer', () => {
    for (const [field, consumer] of Object.entries(RUN_OPTION_CONSUMERS)) {
      expect(consumer, `IRunOptions.${field} must name its consumer seam`).toMatch(/\S/);
      expect(consumer, `IRunOptions.${field} must be threaded, not parked`).not.toMatch(
        /UNTHREADED|TODO/i,
      );
    }
  });
});
