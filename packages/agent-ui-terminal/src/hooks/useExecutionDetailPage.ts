/**
 * Loads the inline detail page for the selected background-execution entry.
 *
 * Extracted from `App.tsx`: three pieces of state and one async effect that exist only
 * for the detail pane, sitting in the middle of the component's input handlers. One responsibility,
 * one module — and the App keeps room for the concerns that actually belong to it.
 */

import { useEffect, useRef, useState } from 'react';

import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';

export interface IExecutionDetailState {
  page: IExecutionDetailPage | null;
  error: string | undefined;
  loading: boolean;
}

export interface IUseExecutionDetailPageInputs {
  /** The selected entry, or undefined / the main thread when no detail is shown. */
  entry: IExecutionWorkspaceEntry | undefined;
  /** Re-read trigger: the snapshot the entry came from. */
  snapshot: IExecutionWorkspaceSnapshot | null;
  read: (entryId: string) => Promise<IExecutionDetailPage>;
}

const REFRESH_INTERVAL_MS = 250;

/** Load the selected detail and coalesce updates without cancelling an in-flight read. */
export function useExecutionDetailPage(
  inputs: IUseExecutionDetailPageInputs,
): IExecutionDetailState {
  const [page, setPage] = useState<IExecutionDetailPage | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const { entry, snapshot, read } = inputs;
  const controller = useRef<{
    snapshot: IExecutionWorkspaceSnapshot | null;
    refresh: () => void;
  } | null>(null);
  const entryId = entry?.kind === 'main_thread' ? undefined : entry?.id;

  useEffect(() => {
    if (entryId === undefined) {
      controller.current = null;
      setPage(null);
      setError(undefined);
      setLoading(false);
      return;
    }
    const selectedId = entryId;

    let active = true;
    let busy = false;
    let dirty = false;
    let initial = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (): void => {
      dirty = true;
      if (timer !== undefined || busy) return;
      timer = setTimeout(() => {
        timer = undefined;
        void load();
      }, REFRESH_INTERVAL_MS);
    };
    async function load(): Promise<void> {
      if (!active || busy) return;
      dirty = false;
      busy = true;
      if (initial) setLoading(true);
      setError(undefined);
      try {
        const loaded = await read(selectedId);
        if (active) setPage(loaded);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read detail.');
      } finally {
        busy = false;
        if (active) {
          initial = false;
          setLoading(false);
          if (dirty) schedule();
        }
      }
    }
    setPage(null);
    controller.current = { snapshot, refresh: schedule };
    void load();
    return () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      controller.current = null;
    };
  }, [entryId, read]);

  useEffect(() => {
    const current = controller.current;
    if (current && current.snapshot !== snapshot) {
      current.snapshot = snapshot;
      current.refresh();
    }
  }, [snapshot]);

  return { page, error, loading };
}
