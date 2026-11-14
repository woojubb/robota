/**
 * The one place the app says "keys typed so far can be delivered now".
 *
 * The renderer defers what a person types from the moment it owns stdin, because the first frames
 * are drawn before the screen that takes keys has attached its listeners. The app calls this once its
 * start has settled; the renderer then hands the deferred keys to Ink, whose listeners the same commit
 * has attached by then. Outside a provider (every test that renders a component alone) nothing is
 * deferred, so the call does nothing.
 */

import React, { createContext, useContext } from 'react';

const InputReadinessContext = createContext<(() => void) | undefined>(undefined);

/** Publish the renderer's "deliver deferred keys" action to the tree. */
export function InputReadinessProvider({
  onReady,
  children,
}: {
  onReady: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <InputReadinessContext.Provider value={onReady}>{children}</InputReadinessContext.Provider>
  );
}

/** The action to call when the app can take keys; a no-op outside a provider. */
export function useSignalInputReady(): () => void {
  return useContext(InputReadinessContext) ?? noop;
}

function noop(): void {
  // Nothing was deferred outside a provider.
}
