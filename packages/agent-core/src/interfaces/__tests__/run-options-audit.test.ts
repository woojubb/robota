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
  temperature: 'execution-stream.ts / execution-round-provider.ts chatOptions (CORE-016)',
  maxTokens: 'execution-stream.ts / execution-round-provider.ts chatOptions (CORE-016)',
  toolChoice: 'execution-stream.ts / execution-round-provider.ts chatOptions (CORE-017)',
  sessionId: 'robota-execution.ts buildRunContext → IExecutionContext / plugin payload',
  userId: 'robota-execution.ts buildRunContext → IExecutionContext / plugin payload',
  metadata: 'robota-execution.ts buildRunContext → IExecutionContext',
  signal: 'robota.ts run queue + execution-round-provider.ts provider call',
  onTextDelta: 'execution round/stream text delta dispatch',
  onExecutionEvent: 'execution round/stream replay event dispatch',
  maxExecutionRounds: 'execution round loop cap',
  maxSameToolInputs: 'execution tool-repetition guard',
  allowToolOnlyCompletion: 'execution round completion policy (CORE-011)',
  ephemeralSystemContext:
    'execution-round.ts derived providerMessages — transient system block, not persisted (SELFHOST-008 P3)',
  output: 'robota-execution.ts robotaRunStructured (CORE-015)',
  outputRetries: 'robota-execution.ts structured-output retry budget (CORE-015)',
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
