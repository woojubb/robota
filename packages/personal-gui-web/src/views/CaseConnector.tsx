import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api.js';
import { caseRequest } from './case-request.js';
import { Button, errorText } from './ui.js';

import type { ICaseConnectorBinding, IConnectorView, IPersonalApi } from '../api.js';

const REFRESH_MS = 3_000;
/** The owner chooses this independently of any origin written in case content. */
export function CaseConnector({
  api,
  caseId,
  caseConfirmed = true,
}: {
  readonly api: IPersonalApi;
  readonly caseId: string;
  readonly caseConfirmed?: boolean;
}): React.ReactElement | null {
  const [binding, setBinding] = useState<ICaseConnectorBinding | undefined>(undefined);
  const [choices, setChoices] = useState<readonly IConnectorView[] | undefined>(undefined);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [inventoryProblem, setInventoryProblem] = useState<string | undefined>(undefined);
  const [pollProblem, setPollProblem] = useState(false);
  const current = useRef<ICaseConnectorBinding | undefined>(undefined);
  const mounted = useRef(false);
  const sequence = useRef(0);
  const working = useRef(false);
  const polling = useRef<symbol | undefined>(undefined);
  const inventory = useRef<symbol | undefined>(undefined);
  const dirty = useRef(false);
  const pending = useRef<string | undefined>(undefined);
  const recovery = useRef<string | undefined>(undefined);

  const apply = useCallback((next: ICaseConnectorBinding, fromPoll = false): void => {
    const choiceChanged =
      current.current?.connectorId !== next.connectorId || current.current?.error !== next.error;
    if (fromPoll && dirty.current && choiceChanged) {
      setProblem('This choice changed in another page. Choose again before saving.');
    }
    if (!fromPoll || choiceChanged || !dirty.current) {
      setDraft(next.connectorId ?? '');
      dirty.current = false;
    }
    current.current = next;
    setBinding(next);
  }, []);

  const open = useCallback(async (): Promise<void> => {
    if (working.current) return;
    const ticket = ++sequence.current;
    working.current = true;
    setBusy(true);
    try {
      const initial = await caseRequest((signal) => api.caseConnector(caseId, signal));
      if (!mounted.current || ticket !== sequence.current) return;
      const settled =
        initial.error === true
          ? initial
          : await caseRequest((signal) => api.fenceCaseConnector(caseId, initial.revision, signal));
      if (!mounted.current || ticket !== sequence.current) return;
      apply(settled);
      recovery.current = undefined;
      setProblem(undefined);
      setPollProblem(false);
      setReady(true);
    } catch (caught) {
      if (!mounted.current || ticket !== sequence.current) return;
      if (caught instanceof ApiError && caught.status === 404) setUnsupported(true);
      else setProblem(errorText(caught));
    } finally {
      if (ticket === sequence.current) {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }, [api, caseId, apply]);

  const settle = useCallback(
    async (revision: string, ticket: number): Promise<ICaseConnectorBinding | undefined> => {
      const result = await caseRequest((signal) =>
        api.fenceCaseConnector(caseId, revision, signal),
      );
      if (!mounted.current || ticket !== sequence.current) return undefined;
      apply(result);
      recovery.current = undefined;
      setPollProblem(false);
      setReady(true);
      return result;
    },
    [api, caseId, apply],
  );

  const save = async (connectorId: string | null): Promise<void> => {
    if (
      working.current ||
      current.current === undefined ||
      (connectorId !== null && !caseConfirmed)
    )
      return;
    const revision = current.current.revision;
    const ticket = ++sequence.current;
    working.current = true;
    pending.current = revision;
    setBusy(true);
    setProblem(undefined);
    try {
      const result = await caseRequest((signal) =>
        api.setCaseConnector(caseId, connectorId, revision, signal),
      );
      if (!mounted.current || ticket !== sequence.current) return;
      apply(result);
      setPollProblem(false);
    } catch (caught) {
      if (!mounted.current || ticket !== sequence.current) return;
      recovery.current = revision;
      setReady(false);
      setProblem(
        connectorId === null
          ? 'The removal could not be confirmed. Refresh the setting and try again.'
          : errorText(caught),
      );
      try {
        const result = await settle(revision, ticket);
        if (connectorId === null && mounted.current && ticket === sequence.current) {
          setProblem(
            result?.connectorId !== undefined || result?.error === true
              ? 'The choice is still selected. Review it and choose Remove choice again.'
              : undefined,
          );
        }
      } catch {
        // Keep the setting closed until its conditional fence succeeds.
      }
    } finally {
      if (ticket === sequence.current) {
        pending.current = undefined;
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const cancel = async (): Promise<void> => {
    const revision = pending.current ?? recovery.current;
    if (revision === undefined) {
      await open();
      return;
    }
    const ticket = ++sequence.current;
    const previous = current.current?.connectorId;
    working.current = true;
    pending.current = undefined;
    recovery.current = revision;
    setBusy(true);
    setReady(false);
    try {
      const result = await settle(revision, ticket);
      if (mounted.current && ticket === sequence.current) {
        setProblem(
          result?.connectorId !== previous
            ? 'The choice was already saved or changed in another page. Review it below.'
            : undefined,
        );
      }
    } catch (caught) {
      if (mounted.current && ticket === sequence.current) setProblem(errorText(caught));
    } finally {
      if (ticket === sequence.current) {
        working.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  };

  const refreshChoices = useCallback(async (): Promise<void> => {
    if (inventory.current !== undefined) return;
    const token = Symbol();
    inventory.current = token;
    try {
      const listing = await caseRequest((signal) => api.connectorInventory(signal));
      if (mounted.current && inventory.current === token) {
        setChoices(listing.connectors);
        setInventoryProblem(undefined);
      }
    } catch (caught) {
      if (mounted.current && inventory.current === token) setInventoryProblem(errorText(caught));
    } finally {
      if (inventory.current === token) inventory.current = undefined;
    }
  }, [api]);

  const refreshBinding = useCallback(async (): Promise<void> => {
    if (
      working.current ||
      polling.current !== undefined ||
      current.current === undefined ||
      recovery.current !== undefined
    )
      return;
    const ticket = sequence.current;
    const token = Symbol();
    polling.current = token;
    try {
      const next = await caseRequest((signal) => api.caseConnector(caseId, signal));
      if (mounted.current && ticket === sequence.current && !working.current) {
        apply(next, true);
        setPollProblem(false);
      }
    } catch {
      if (mounted.current && ticket === sequence.current && !working.current) setPollProblem(true);
    } finally {
      if (polling.current === token) polling.current = undefined;
    }
  }, [api, caseId, apply]);

  useEffect(() => {
    mounted.current = true;
    if (typeof api.caseConnector !== 'function') {
      setUnsupported(true);
      return () => {
        mounted.current = false;
      };
    }
    void open();
    void refreshChoices();
    const timer = setInterval(() => {
      void refreshChoices();
      void refreshBinding();
    }, REFRESH_MS);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      working.current = false;
      polling.current = undefined;
      inventory.current = undefined;
      pending.current = undefined;
      clearInterval(timer);
    };
  }, [api, caseId, open, refreshChoices, refreshBinding]);

  if (unsupported) return null;
  const draftAvailable = draft === '' || choices?.some((choice) => choice.id === draft) === true;
  return (
    <section aria-label="Service for this case" className="rounded-lg border border-border p-3">
      <h3 className="text-[13px] font-semibold">Service for this case</h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">
        Choose a service yourself. When case actions are available, they can request only tools you
        allow for that service, and each action still needs your approval.
      </p>
      {problem !== undefined && (
        <p role="alert" className="mt-1 text-destructive">
          {problem}
        </p>
      )}
      {!caseConfirmed && (
        <p className="mt-1 text-destructive">
          The case status cannot be confirmed. You can remove its choice while it is unavailable.
        </p>
      )}
      {pollProblem && (
        <div className="mt-1 text-destructive" role="alert">
          The current choice cannot be confirmed. Refresh it before relying on what is shown.
          <Button onClick={() => void refreshBinding()}>Refresh case setting</Button>
        </div>
      )}
      {inventoryProblem !== undefined && (
        <div className="mt-1 text-destructive" role="alert">
          The service list could not be loaded. It will be retried.
          <Button onClick={() => void refreshChoices()}>Retry services</Button>
        </div>
      )}
      {choices === undefined && inventoryProblem === undefined && (
        <p className="mt-1 text-muted-foreground" role="status">
          Loading services…
        </p>
      )}
      {binding?.error === true && (
        <p className="mt-1 text-destructive">
          This choice could not be read. Remove it to reset the setting.
        </p>
      )}
      {binding !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-[13px]" htmlFor={`case-service-${caseId}`}>
            Service
          </label>
          <select
            id={`case-service-${caseId}`}
            className="max-w-full rounded-md border border-border bg-background px-2 py-1.5 text-[13px]"
            value={draft}
            disabled={
              !ready ||
              busy ||
              !caseConfirmed ||
              pollProblem ||
              binding.error === true ||
              choices === undefined
            }
            onChange={(event) => {
              dirty.current = true;
              setDraft(event.target.value);
            }}
          >
            <option value="">None</option>
            {!draftAvailable && <option value={draft}>{draft} (unavailable)</option>}
            {choices?.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.title} — {choice.endpoint} ({choice.id})
              </option>
            ))}
          </select>
          <Button
            disabled={
              !ready ||
              busy ||
              !caseConfirmed ||
              pollProblem ||
              !draftAvailable ||
              binding.error === true ||
              draft === (binding.connectorId ?? '')
            }
            onClick={() => void save(draft === '' ? null : draft)}
          >
            Save choice
          </Button>
          {(binding.connectorId !== undefined ||
            binding.error === true ||
            pollProblem ||
            !caseConfirmed) && (
            <Button disabled={!ready || busy} onClick={() => void save(null)}>
              Remove choice
            </Button>
          )}
        </div>
      )}
      {busy && pending.current !== undefined && (
        <Button onClick={() => void cancel()}>Cancel pending choice</Button>
      )}
      {!ready && !busy && <Button onClick={() => void cancel()}>Retry case setting</Button>}
    </section>
  );
}
