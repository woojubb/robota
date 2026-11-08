/**
 * CLI-2004 — the one place a component asks "is screen-reader mode on?".
 *
 * The mode is a single resolved boolean threaded from the CLI into `renderApp`, handed to Ink as
 * `isScreenReaderEnabled` AND published here. Two sources of truth for one fact is the hazard this
 * design accepts (Ink's option and this context); both are set from the same resolved value in
 * `render.tsx`, and no component takes the mode as a prop from its parent — it reads it here — so a
 * missed prop cannot silently leave one component in the wrong mode.
 *
 * Default `false`: a component rendered outside the provider (every existing test) behaves exactly
 * as it does today.
 */

import React, { createContext, useContext } from 'react';

const ScreenReaderContext = createContext<boolean>(false);

/** Publish the resolved mode to the tree. */
export function ScreenReaderProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return <ScreenReaderContext.Provider value={enabled}>{children}</ScreenReaderContext.Provider>;
}

/** Read the resolved mode. `false` outside a provider. */
export function useScreenReader(): boolean {
  return useContext(ScreenReaderContext);
}
