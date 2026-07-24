import { describe, expectTypeOf, it } from 'vitest';

import type {
  IBackgroundTaskState,
  IBackgroundTaskUsage,
  ISubagentJobState,
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
});
