import { useContext, useMemo } from 'react';

import type { IPlaygroundState } from '../playground-reducer';
import { PlaygroundActionsContext, PlaygroundStateContext } from './react-contexts';
import type { IPlaygroundActionsValue, IPlaygroundContextValue } from './types';

export function usePlaygroundState(): IPlaygroundState {
  const state = useContext(PlaygroundStateContext);
  if (state === undefined) {
    throw new Error('usePlaygroundState must be used within a PlaygroundProvider');
  }
  return state;
}

export function usePlaygroundActions(): IPlaygroundActionsValue {
  const actions = useContext(PlaygroundActionsContext);
  if (actions === undefined) {
    throw new Error('usePlaygroundActions must be used within a PlaygroundProvider');
  }
  return actions;
}

/**
 * Returns both state and actions. Prefer usePlaygroundState() or usePlaygroundActions()
 * when you only need one because this hook re-renders on every state change.
 */
export function usePlayground(): IPlaygroundContextValue {
  const state = usePlaygroundState();
  const actions = usePlaygroundActions();
  return useMemo(() => ({ state, ...actions }), [state, actions]);
}
