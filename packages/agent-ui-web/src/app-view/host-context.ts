import { createContext } from 'react';

import { APP_VIEW_MAX_HEIGHT_PX, type IAppViewHostContext } from './bridge.js';

import type { TAppToolArguments, TAppToolOutcome, TAppView } from './types.js';

/**
 * What a session surface offers the app views under it. A surface that has no frame leaves the
 * context unprovided, or provides it without a `sandboxUrl`: its views then show one plain line.
 */
export interface IAppViewHost {
  /**
   * The static page, from this page's own origin, that holds a view's document in a second frame.
   * The host page's policy needs only `frame-src 'self'` for it.
   */
  sandboxUrl?: string;
  /** Both take the view's key as `appViewKey(tool)` gives it; the key is opaque to the host. */
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

/** What the view is told about the place it is shown in, read when it initializes. */
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
