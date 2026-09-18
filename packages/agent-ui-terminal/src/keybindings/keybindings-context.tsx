import { useInput } from 'ink';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

import {
  createEmptyChordState,
  keybindingHints,
  parseKeybindingsDocument,
  resolveKeybindingInput,
  type IChordState,
  type IKeybindingSnapshot,
  type IKeyInput,
  type TKeybindingAction,
  type TKeybindingContext,
} from './keybinding-registry.js';

import type { IKeybindingsSource } from './node-keybindings-source.js';

const parsedDefault = parseKeybindingsDocument('{"version":1,"bindings":{}}', '<defaults>');
if (!parsedDefault.ok) throw new Error(parsedDefault.diagnostic.message);
const DEFAULT_SNAPSHOT = parsedDefault.snapshot;

const KeybindingsContext = createContext<IKeybindingSnapshot>(DEFAULT_SNAPSHOT);

export function KeybindingsProvider({
  source,
  children,
}: {
  source?: IKeybindingsSource;
  children: React.ReactNode;
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState(() => source?.getSnapshot() ?? DEFAULT_SNAPSHOT);
  useEffect(() => {
    if (source === undefined) return;
    setSnapshot(source.getSnapshot());
    return source.subscribe(setSnapshot);
  }, [source]);
  return <KeybindingsContext.Provider value={snapshot}>{children}</KeybindingsContext.Provider>;
}

export function useKeybindings(): IKeybindingSnapshot {
  return useContext(KeybindingsContext);
}

export function useKeybindingHints<TContext extends TKeybindingContext>(
  context: TContext,
  actions: readonly (readonly [
    TKeybindingAction<TContext> | readonly TKeybindingAction<TContext>[],
    string,
  ])[],
): { keys: string; label: string }[] {
  return keybindingHints(useKeybindings(), context, actions);
}

export function useKeybindingActions<TContext extends TKeybindingContext>(
  context: TContext,
  handler: (
    actions: readonly TKeybindingAction<TContext>[],
    input: string,
    key: IKeyInput,
    consumed: boolean,
  ) => void,
  options: { readonly isActive?: boolean } = {},
): void {
  const snapshot = useKeybindings();
  const stateRef = useRef<IChordState>(createEmptyChordState());
  useEffect(() => {
    stateRef.current = createEmptyChordState();
  }, [context, snapshot.generation]);
  useInput(
    (input, key) => {
      const result = resolveKeybindingInput({
        snapshot,
        state: stateRef.current,
        context,
        input,
        key,
        now: Date.now(),
      });
      stateRef.current = result.state;
      handler(
        result.actions as readonly TKeybindingAction<TContext>[],
        input,
        key,
        result.consumed,
      );
    },
    { isActive: options.isActive ?? true },
  );
}
