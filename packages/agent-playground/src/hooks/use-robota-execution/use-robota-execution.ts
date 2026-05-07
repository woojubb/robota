'use client';

import { usePlaygroundActions, usePlaygroundState } from '../../contexts/playground-context';
import { buildRobotaExecutionReturn } from './build-robota-execution-return';
import type { IRobotaExecutionHookReturn } from './types';
import { useLocalExecutionState } from './use-local-execution-state';
import { useRobotaExecutionActions } from './use-robota-execution-actions';

export function useRobotaExecution(): IRobotaExecutionHookReturn {
  const state = usePlaygroundState();
  const contextActions = usePlaygroundActions();
  const localState = useLocalExecutionState(state);
  const actions = useRobotaExecutionActions(contextActions, localState);

  return buildRobotaExecutionReturn({
    state,
    localState,
    actions,
  });
}
