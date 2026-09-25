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

export function useKeybindingActions<
  TContext extends TKeybindingContext,
  TFallback extends TKeybindingContext = TContext,
>(
  context: TContext,
  handler: (
    actions: readonly (TKeybindingAction<TContext> | TKeybindingAction<TFallback>)[],
    input: string,
    key: IKeyInput,
    consumed: boolean,
    resolvedContext: TContext | TFallback,
  ) => void,
  options: {
    readonly isActive?: boolean;
    /**
     * A key `context` does not bind is resolved again here, so a surface layered over an editor (the
     * autocomplete menu over the chat input) leaves every key it does not use to the editor's bindings.
     */
    readonly fallbackContext?: TFallback;
  } = {},
): void {
  const snapshot = useKeybindings();
  const stateRef = useRef<IChordState>(createEmptyChordState());
  const fallbackStateRef = useRef<IChordState>(createEmptyChordState());
  const { fallbackContext } = options;
  useEffect(() => {
    stateRef.current = createEmptyChordState();
    fallbackStateRef.current = createEmptyChordState();
  }, [context, fallbackContext, snapshot.generation]);
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
      if (fallbackContext === undefined || result.consumed) {
        fallbackStateRef.current = createEmptyChordState();
        handler(
          result.actions as readonly TKeybindingAction<TContext>[],
          input,
          key,
          result.consumed,
          context,
        );
        return;
      }
      const fallback = resolveKeybindingInput({
        snapshot,
        state: fallbackStateRef.current,
        context: fallbackContext,
        input,
        key,
        now: Date.now(),
      });
      fallbackStateRef.current = fallback.state;
      handler(
        fallback.actions as readonly TKeybindingAction<TFallback>[],
        input,
        key,
        fallback.consumed,
        fallbackContext,
      );
    },
    { isActive: options.isActive ?? true },
  );
}
