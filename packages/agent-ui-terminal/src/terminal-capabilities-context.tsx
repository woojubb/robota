import React, { createContext, useContext } from 'react';

/** Host-selected overrides; absent values leave terminal detection in charge. */
export interface ITerminalCapabilityOverrides {
  readonly imeCursorPositioning?: boolean | undefined;
  readonly turnMarks?: boolean | undefined;
}

const TerminalCapabilitiesContext = createContext<ITerminalCapabilityOverrides>({});

export function TerminalCapabilitiesProvider({
  overrides,
  children,
}: {
  overrides: ITerminalCapabilityOverrides | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <TerminalCapabilitiesContext.Provider value={overrides ?? {}}>
      {children}
    </TerminalCapabilitiesContext.Provider>
  );
}

export function useTerminalCapabilityOverrides(): ITerminalCapabilityOverrides {
  return useContext(TerminalCapabilitiesContext);
}
