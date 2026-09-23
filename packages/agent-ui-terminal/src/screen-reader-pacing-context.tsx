/**
 * SCREEN-2670 — the one place a component reaches the owned write path.
 *
 * Mirrors `screen-reader-context.tsx`: the port is published from `render.tsx`, no component takes
 * it as a prop from its parent, so a missed prop cannot silently leave one component writing past
 * the queue. It also keeps a live writer handle out of the presentation tree, which declares itself
 * free of channels, sessions and mutable state.
 *
 * Outside a provider (every existing test, and every run with the mode off) the port is inert:
 * arming does nothing and writes go straight to the process's own stdout, exactly as today.
 */

import React, { createContext, useContext } from 'react';

export interface IScreenReaderPacingPort {
  /** Arm the echo flag for the batch the current keystroke's commit will open. */
  armEchoRelease(): void;
  /** Write a positional sequence (an OSC 133 mark) through the same ordered path. */
  write(text: string): void;
}

const inertPort: IScreenReaderPacingPort = {
  armEchoRelease(): void {},
  write(text: string): void {
    process.stdout.write(text);
  },
};

const ScreenReaderPacingContext = createContext<IScreenReaderPacingPort>(inertPort);

/** Publish the owned write path to the tree. */
export function ScreenReaderPacingProvider({
  port,
  children,
}: {
  port: IScreenReaderPacingPort;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ScreenReaderPacingContext.Provider value={port}>{children}</ScreenReaderPacingContext.Provider>
  );
}

/** Read the port. Inert outside a provider. */
export function useScreenReaderPacing(): IScreenReaderPacingPort {
  return useContext(ScreenReaderPacingContext);
}
