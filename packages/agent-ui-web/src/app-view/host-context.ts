import { createContext } from 'react';

import { APP_VIEW_MAX_HEIGHT_PX, type IAppViewHostContext } from './bridge.js';

import type { TAppToolArguments, TAppToolOutcome, TAppView } from './types.js';

export interface IAppViewHost {
  sandboxUrl?: string;

  readAppView: (viewKey: string, signal?: AbortSignal) => Promise<TAppView>;
  callAppTool: (
    viewKey: string,
    name: string,
    args: TAppToolArguments,
    signal?: AbortSignal,
  ) => Promise<TAppToolOutcome>;
  hostInfo: { name: string; version: string };
  platform: 'desktop' | 'web';
}

export const AppViewHostContext = createContext<IAppViewHost | null>(null);

export function readAppViewHostContext(platform: IAppViewHost['platform']): IAppViewHostContext {
  const dark =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    theme: dark ? 'dark' : 'light',
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: { maxHeight: APP_VIEW_MAX_HEIGHT_PX },
    platform,
    locale: typeof navigator === 'undefined' ? 'en-US' : navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
