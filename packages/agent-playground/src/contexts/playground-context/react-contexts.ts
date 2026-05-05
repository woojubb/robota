import { createContext } from 'react';

import type { IPlaygroundState } from '../playground-reducer';
import type { IPlaygroundActionsValue } from './types';

export const PlaygroundStateContext = createContext<IPlaygroundState | undefined>(undefined);
export const PlaygroundActionsContext = createContext<IPlaygroundActionsValue | undefined>(
  undefined,
);
