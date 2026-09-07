/**
 * Loads the inline detail page for the selected background-execution entry.
 *
 * Extracted from `App.tsx` (CLI-2004): three pieces of state and one async effect that exist only
 * for the detail pane, sitting in the middle of the component's input handlers. One responsibility,
 * one module — and the App keeps room for the concerns that actually belong to it.
 */

import { useEffect, useState } from 'react';

import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
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
  snapshot: unknown;
  read: (entryId: string) => Promise<IExecutionDetailPage>;
}

/** Load (and cancel-on-change) the detail page for the selected entry. */
export function useExecutionDetailPage(
  inputs: IUseExecutionDetailPageInputs,
): IExecutionDetailState {
  const [page, setPage] = useState<IExecutionDetailPage | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const { entry, snapshot, read } = inputs;

  useEffect(() => {
    if (!entry || entry.kind === 'main_thread') {
      setPage(null);
      setError(undefined);
      setLoading(false);
      return;
    }

    let isCurrent = true;
    setLoading(true);
    setError(undefined);
    read(entry.id)
      .then((loaded) => {
        if (!isCurrent) return;
        setPage(loaded);
        setLoading(false);
      })
      .catch((cause: Error) => {
        if (!isCurrent) return;
        setError(cause.message);
        setLoading(false);
      });

    return () => {
      isCurrent = false;
    };
  }, [snapshot, read, entry]);

  return { page, error, loading };
}
