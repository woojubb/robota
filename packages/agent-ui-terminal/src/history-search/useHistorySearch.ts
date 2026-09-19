/**
 * SCREEN-1993 — the reverse prompt-history search overlay's state.
 *
 * One loader per open: opening starts one read of the injected source under one `AbortController`,
 * and every close — insert, execute or cancel — aborts it. Blocks arrive newest-first and are appended
 * as they land, so the first frame shows the newest prompts before the rest of the file is read. The
 * `session` scope never touches the file: it is the live prompt list the composer already holds.
 *
 * The composer's draft is restored by construction, not by copying: the overlay never writes the
 * input while it is open, so a cancel leaves text and cursor exactly as they were.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useKeybindingActions } from '../keybindings/keybindings-context.js';
import { useScreenReader } from '../screen-reader-context.js';
import {
  collapseToNewest,
  cycleScope,
  filterPrompts,
  inScope,
  type IHistorySearchMatch,
  type THistorySearchScope,
} from './history-search-flow.js';

import type { IKeyInput } from '../keybindings/keybinding-registry.js';
import type {
  IPromptHistoryEntry,
  IPromptHistorySource,
} from '@robota-sdk/agent-interface-session';

/** What the surface injects to turn the overlay on; absent ⇒ `ctrl+r` does nothing. */
export interface IHistorySearchSurface {
  readonly source: IPromptHistorySource;
  readonly sessionId: string;
  readonly project: string;
}

export interface IUseHistorySearchOptions {
  readonly surface: IHistorySearchSurface | undefined;
  /** The composer's live prompt list, oldest-first — the `session` scope. */
  readonly sessionPrompts: readonly string[];
  readonly onInsert: (text: string) => void;
  readonly onExecute: (text: string) => void;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
}

export interface IHistorySearchView {
  readonly open: boolean;
  readonly query: string;
  readonly scope: THistorySearchScope;
  readonly selectedIndex: number;
  readonly matches: readonly IHistorySearchMatch[];
  readonly loading: boolean;
  readonly skippedLines: number;
  readonly error: string | undefined;
}

interface ILoadedState {
  readonly entries: readonly IPromptHistoryEntry[];
  readonly skippedLines: number;
}

const EMPTY_LOADED: ILoadedState = { entries: [], skippedLines: 0 };

function isPrintable(input: string, key: IKeyInput): boolean {
  const special =
    key.ctrl === true ||
    key.meta === true ||
    Boolean(key.return || key.escape || key.tab) ||
    Boolean(key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) ||
    Boolean(key.backspace || key.delete);
  return input.length > 0 && !special;
}

function liveEntries(
  prompts: readonly string[],
  surface: IHistorySearchSurface,
): IPromptHistoryEntry[] {
  return [...prompts]
    .reverse()
    .map((text) => ({ at: '', sessionId: surface.sessionId, project: surface.project, text }));
}

interface ILoader {
  readonly loaded: ILoadedState;
  readonly loading: boolean;
  readonly error: string | undefined;
  readonly start: () => void;
  readonly stop: () => void;
  /** Screen-reader mode: the list is published only here — per keystroke or at load end. */
  readonly publish: () => void;
}

interface ILoaderRun {
  readonly source: IPromptHistorySource;
  readonly signal: AbortSignal;
  readonly pending: { current: ILoadedState };
  readonly publishEachBlock: boolean;
  readonly publish: () => void;
  readonly setError: (message: string) => void;
  readonly setLoading: (loading: boolean) => void;
}

async function runLoader(run: ILoaderRun): Promise<void> {
  try {
    for await (const block of run.source.read({ signal: run.signal })) {
      if (run.signal.aborted) return;
      run.pending.current = {
        entries: [...run.pending.current.entries, ...block.entries],
        skippedLines: run.pending.current.skippedLines + block.skippedLines,
      };
      if (run.publishEachBlock) run.publish();
    }
    if (!run.signal.aborted) run.publish();
  } catch (cause) {
    if (!run.signal.aborted) run.setError(cause instanceof Error ? cause.message : String(cause));
  } finally {
    if (!run.signal.aborted) run.setLoading(false);
  }
}

/** Reads the source once per open under one abort signal. */
function useHistoryLoader(
  surface: IHistorySearchSurface | undefined,
  screenReader: boolean,
): ILoader {
  const [loaded, setLoaded] = useState<ILoadedState>(EMPTY_LOADED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const controller = useRef<AbortController | undefined>(undefined);
  const pending = useRef<ILoadedState>(EMPTY_LOADED);
  const publish = useCallback(() => setLoaded(pending.current), []);
  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = undefined;
  }, []);
  const start = useCallback(() => {
    stop();
    pending.current = EMPTY_LOADED;
    setLoaded(EMPTY_LOADED);
    setError(undefined);
    if (surface === undefined) return;
    const own = new AbortController();
    controller.current = own;
    setLoading(true);
    void runLoader({
      source: surface.source,
      signal: own.signal,
      pending,
      publishEachBlock: !screenReader,
      publish,
      setError,
      setLoading,
    });
  }, [publish, screenReader, stop, surface]);
  useEffect(() => stop, [stop]);
  return { loaded, loading, error, start, stop, publish };
}

interface ISearchKeysDeps {
  readonly open: boolean;
  readonly matches: readonly IHistorySearchMatch[];
  readonly selected: number;
  readonly scope: THistorySearchScope;
  readonly screenReader: boolean;
  readonly loader: ILoader;
  readonly close: () => void;
  readonly setScope: (scope: THistorySearchScope) => void;
  readonly setSelectedIndex: (index: number) => void;
  readonly setQuery: (update: (current: string) => string) => void;
  readonly onInsert: (text: string) => void;
  readonly onExecute: (text: string) => void;
}

/** The overlay's keys: the bound actions, and otherwise plain typing into the query. */
function useHistorySearchKeys(deps: ISearchKeysDeps): void {
  const editQuery = (update: (current: string) => string): void => {
    deps.setQuery(update);
    deps.setSelectedIndex(0);
    if (deps.screenReader) deps.loader.publish();
  };
  const take = (action: 'insert' | 'execute'): void => {
    const text = deps.matches[deps.selected]?.entry.text;
    if (text === undefined) return;
    deps.close();
    (action === 'insert' ? deps.onInsert : deps.onExecute)(text);
  };
  const move = (step: number): void => {
    if (deps.matches.length === 0) return;
    deps.setSelectedIndex((deps.selected + step + deps.matches.length) % deps.matches.length);
  };
  useKeybindingActions(
    'history-search',
    (actions, input, key, consumed) => {
      const action = actions[0];
      if (action === 'cancel') deps.close();
      else if (action === 'insert' || action === 'execute') take(action);
      else if (action === 'previous') move(-1);
      else if (action === 'next') move(1);
      else if (action === 'cycle-scope') {
        deps.setScope(cycleScope(deps.scope));
        deps.setSelectedIndex(0);
      } else if (!consumed && (key.backspace || key.delete)) editQuery((q) => q.slice(0, -1));
      else if (!consumed && isPrintable(input, key)) editQuery((q) => q + input);
    },
    { isActive: deps.open },
  );
}

/** The candidate list for the scope: the live list for `session`, the collapsed file otherwise. */
function useCandidates(
  surface: IHistorySearchSurface | undefined,
  scope: THistorySearchScope,
  sessionPrompts: readonly string[],
  entries: readonly IPromptHistoryEntry[],
): IPromptHistoryEntry[] {
  return useMemo(() => {
    if (surface === undefined) return [];
    if (scope === 'session') return liveEntries(sessionPrompts, surface);
    return collapseToNewest(entries.filter((entry) => inScope(entry, scope, surface)));
  }, [entries, scope, sessionPrompts, surface]);
}

interface IQueryState {
  readonly query: string;
  readonly scope: THistorySearchScope;
  readonly selectedIndex: number;
}

const FRESH_QUERY: IQueryState = { query: '', scope: 'all', selectedIndex: 0 };

/** Open and close: one loader start per open, one stop per close, the app told of both. */
function useOverlayVisibility(
  loader: ILoader,
  canOpen: boolean,
  reset: () => void,
  onOpenChange: ((open: boolean) => void) | undefined,
): { readonly open: boolean; readonly openSearch: () => void; readonly closeSearch: () => void } {
  const [open, setOpen] = useState(false);
  const openSearch = useCallback(() => {
    if (!canOpen || open) return;
    reset();
    setOpen(true);
    onOpenChange?.(true);
    loader.start();
  }, [canOpen, loader, onOpenChange, open, reset]);
  const closeSearch = useCallback(() => {
    loader.stop();
    setOpen(false);
    onOpenChange?.(false);
  }, [loader, onOpenChange]);
  return { open, openSearch, closeSearch };
}

export function useHistorySearch(options: IUseHistorySearchOptions): {
  readonly view: IHistorySearchView;
  readonly openSearch: () => void;
  readonly closeSearch: () => void;
} {
  const screenReader = useScreenReader();
  const loader = useHistoryLoader(options.surface, screenReader);
  const [state, setState] = useState<IQueryState>(FRESH_QUERY);
  const { query, scope } = state;
  const { surface, onInsert, onExecute } = options;
  const reset = useCallback(() => setState(FRESH_QUERY), []);
  const { open, openSearch, closeSearch } = useOverlayVisibility(
    loader,
    surface !== undefined,
    reset,
    options.onOpenChange,
  );

  const candidates = useCandidates(surface, scope, options.sessionPrompts, loader.loaded.entries);
  const matches = useMemo(() => filterPrompts(candidates, query), [candidates, query]);
  const selected = Math.min(state.selectedIndex, Math.max(0, matches.length - 1));
  const setScope = (next: THistorySearchScope): void => setState((s) => ({ ...s, scope: next }));
  const setSelectedIndex = (index: number): void =>
    setState((s) => ({ ...s, selectedIndex: index }));
  const setQuery = (update: (current: string) => string): void =>
    setState((s) => ({ ...s, query: update(s.query) }));
  useHistorySearchKeys({
    ...{ open, matches, selected, scope, screenReader, loader, close: closeSearch },
    ...{ setScope, setSelectedIndex, setQuery, onInsert, onExecute },
  });

  const { loading, error } = loader;
  const { skippedLines } = loader.loaded;
  const view = {
    open,
    query,
    scope,
    selectedIndex: selected,
    matches,
    loading,
    skippedLines,
    error,
  };
  return { view, openSearch, closeSearch };
}
