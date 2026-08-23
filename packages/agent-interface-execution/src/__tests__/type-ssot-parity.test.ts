import { describe, expectTypeOf, it } from 'vitest';

import type {
  IAgentBackgroundTaskRequest,
  IBackgroundTaskResult,
  IBackgroundTaskState,
  IBackgroundTaskUsage,
  ISubagentJobResult,
  ISubagentJobState,
  ISubagentSpawnRequest,
  TBackgroundTaskMode,
  TBackgroundTaskStatus,
  TSubagentJobMode,
  TSubagentJobStatus,
} from '../index.js';
import type { ISessionUsageTotals, ITokenUsage } from '@robota-sdk/agent-core';

/**
 * TYPE-003 type-SSOT parity floor. This package's tsconfig typechecks `__tests__`, so every
 * assertion below is enforced by `pnpm typecheck` — if a derived type is ever re-declared by hand
 * and drifts from its SSOT (the CONTRACT-002/003/011/012 failure mode, demonstrated live when
 * SELFHOST-012 added `paused` to the task union but not the manual subagent copy), this file stops
 * compiling.
 */
describe('TYPE-003 type-SSOT parity', () => {
  it('usage triples are the agent-core ITokenUsage SSOT', () => {
    // Named variants converged to aliases — identical types, not lookalike copies.
    expectTypeOf<IBackgroundTaskUsage>().toEqualTypeOf<ITokenUsage>();
    expectTypeOf<ISessionUsageTotals>().toEqualTypeOf<ITokenUsage>();
  });

  it('subagent job status/mode are derived from the background-task SSOT', () => {
    // The subagent union is exactly the task union minus the scheduled-only 'paused'.
    expectTypeOf<TSubagentJobStatus | 'paused'>().toEqualTypeOf<TBackgroundTaskStatus>();
    expectTypeOf<TSubagentJobMode>().toEqualTypeOf<TBackgroundTaskMode>();
  });

  it('ISubagentJobState shared fields are Pick-derived from IBackgroundTaskState', () => {
    // Every shared field must keep the SSOT's exact type — drift in any one breaks equality.
    // Deliberately-diverging fields are excluded: status (paused-free union), result/error
    // (flattened strings vs structured objects), promptPreview (required here, optional there).
    type TSharedKeys = Extract<
      keyof ISubagentJobState,
      Exclude<keyof IBackgroundTaskState, 'status' | 'result' | 'error' | 'promptPreview'>
    >;
    expectTypeOf<Pick<ISubagentJobState, TSharedKeys>>().toEqualTypeOf<
      Pick<IBackgroundTaskState, TSharedKeys>
    >();
  });

  /**
   * ARCH-031 finished what TYPE-003 started. TYPE-003 derived the STATE hop and left the request and
   * result hops as manual mirrors; the next two changes each dropped a field at a hop it had skipped
   * (CORE-025's permission policy, ANALYTICS-001's `usage` — dropped in the very commit that added it).
   * These assertions are tautologies while the types are defined as `Omit<…>`, and that is exactly what
   * makes them worth writing: they fail the moment either type is re-declared by hand, which is the
   * only way the drift can come back.
   */
  it('ISubagentSpawnRequest is the agent task request minus the seam-fixed discriminant', () => {
    expectTypeOf<ISubagentSpawnRequest>().toEqualTypeOf<
      Omit<IAgentBackgroundTaskRequest, 'kind'>
    >();
    // Every key of the source except `kind` is present — a field added there reaches the runner.
    expectTypeOf<keyof ISubagentSpawnRequest>().toEqualTypeOf<
      Exclude<keyof IAgentBackgroundTaskRequest, 'kind'>
    >();
  });

  it('ISubagentJobResult is the task result minus the discriminant and the process-only keys', () => {
    expectTypeOf<ISubagentJobResult>().toEqualTypeOf<
      Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>
    >();
    // `exitCode`/`signalCode` are produced only by the shell runner; an agent result never sets them.
    expectTypeOf<keyof ISubagentJobResult>().toEqualTypeOf<
      Exclude<keyof IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>
    >();
  });
});
