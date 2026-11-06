/** Untrusted discovery metadata: it names candidates, not authenticated daemon facts. */
export interface IWorkspaceDaemonCandidate {
  readonly id: string;
  readonly generation?: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
  readonly control: 'available' | 'unavailable';
  readonly activity: 'working' | 'needs-input' | 'idle' | 'unknown';
}

export interface IWorkspaceDaemonProofLink {
  control(request: { readonly command: 'status'; readonly fields: Readonly<Record<string, string>> }): Promise<Readonly<Record<string, unknown>>>;
  close(): void;
}

export interface IProvenWorkspaceDaemon extends IWorkspaceDaemonCandidate {
  readonly generation: string;
  readonly daemon: true;
  readonly cwd: string;
  readonly restricted?: true;
}

export interface IWorkspaceDaemonProofAttempt {
  readonly result: Promise<IProvenWorkspaceDaemon | undefined>;
  /** The owner handover must remain alive until this resolves; rejection permanently faults the prover. */
  readonly settled: Promise<void>;
}

type TOpenProofLink = (selected: { readonly id: string; readonly generation: string }, signal: AbortSignal) => Promise<IWorkspaceDaemonProofLink>;
type TProofInput = { readonly workspace: string; readonly candidates: readonly IWorkspaceDaemonCandidate[]; readonly signal?: AbortSignal; readonly timeoutMs?: number };

/** Own one authenticated handover: do not reuse it until the attempt's settlement resolves. */
export function createWorkspaceDaemonProver(options: { readonly open: TOpenProofLink }): {
  start(input: TProofInput): IWorkspaceDaemonProofAttempt;
} {
  let busy = false;
  let fault: Error | undefined;
  return {
    start(input): IWorkspaceDaemonProofAttempt {
      if (fault) throw new Error('Secure daemon proof cleanup previously failed.');
      if (busy) throw new Error('Secure daemon proof is busy.');
      busy = true;
      const openingTasks: Promise<void>[] = [];
      const cleanupFailed = (): void => { fault ??= new Error('Secure daemon proof cleanup failed.'); };
      const result = scanWorkspaceDaemon({ ...input, open: options.open }, openingTasks, cleanupFailed, () => fault);
      const settled = result.then(() => {}, () => {}).then(async () => {
        await Promise.all(openingTasks);
        if (fault) throw fault;
        busy = false;
      });
      void settled.catch(() => {});
      return { result, settled };
    },
  };
}

/** The opener must authenticate the selected binding before returning a link. */
async function scanWorkspaceDaemon(
  options: TProofInput & { readonly open: TOpenProofLink },
  openingTasks: Promise<void>[],
  cleanupFailed: () => void,
  cleanupError: () => Error | undefined,
): Promise<IProvenWorkspaceDaemon | undefined> {
  const { workspace, signal } = options;
  const candidates = options.candidates.map(({ id, generation, liveness, control, activity }) =>
    ({ id, generation, liveness, control, activity }));
  const controller = new AbortController();
  let reason: 'cancelled' | 'timed out' | undefined;
  const cancel = (why: 'cancelled' | 'timed out'): void => {
    if (controller.signal.aborted) return;
    reason = why;
    controller.abort();
  };
  const abortError = (): Error => new Error(`Secure daemon proof ${reason ?? 'cancelled'}.`);
  const onExternalAbort = (): void => cancel('cancelled');
  if (signal?.aborted) cancel('cancelled');
  else signal?.addEventListener('abort', onExternalAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = async <T>(pending: Promise<T>): Promise<T> => {
    if (controller.signal.aborted) throw abortError();
    let abort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => reject(abortError());
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const value = await Promise.race([pending, interrupted]);
      if (controller.signal.aborted) throw abortError();
      return value;
    } finally { controller.signal.removeEventListener('abort', abort); }
  };
  try {
    if (controller.signal.aborted) throw abortError();
    if (!candidates.length) return undefined;
    timer = setTimeout(() => cancel('timed out'), options.timeoutMs ?? 5_000);
    let found: IProvenWorkspaceDaemon | undefined;
    for (const row of candidates) {
      if (row.liveness === 'dead') continue;
      if (row.liveness !== 'alive' || row.control !== 'available' || !row.id || !row.generation) {
        throw new Error('An unproven runtime registration prevents secure daemon discovery.');
      }
      if (controller.signal.aborted) throw abortError();
      try {
        let claimed = false;
        let unclaimed: IWorkspaceDaemonProofLink | undefined;
        let discarded = false;
        const discard = (): void => {
          if (claimed || discarded || !unclaimed) return;
          discarded = true;
          try { unclaimed.close(); } catch { cleanupFailed(); }
        };
        const pending = options.open({ id: row.id, generation: row.generation }, controller.signal);
        openingTasks.push(pending.then((late) => {
          unclaimed = late;
          if (controller.signal.aborted) discard();
        }, () => {}));
        let link: IWorkspaceDaemonProofLink;
        try { link = await wait(pending); } catch (error) { discard(); throw error; }
        claimed = true;
        let closed = false;
        let closeFailed = false;
        const close = (): void => {
          if (closed) return;
          closed = true;
          try { link.close(); } catch { closeFailed = true; cleanupFailed(); }
        };
        controller.signal.addEventListener('abort', close, { once: true });
        try {
          if (controller.signal.aborted) throw abortError();
          const result = await wait(link.control({ command: 'status', fields: {} }));
          if (result.status !== 'running' || (result.daemon !== undefined && result.daemon !== true) ||
              (result.daemon === true && typeof result.cwd !== 'string') ||
              (result.restricted !== undefined && result.restricted !== true)) {
            throw new Error('The authenticated runtime returned an incomplete status.');
          }
          if (result.daemon === true && result.cwd === workspace && found === undefined) {
            found = { ...row, generation: row.generation, daemon: true, cwd: workspace,
              ...(result.restricted === true ? { restricted: true as const } : {}) };
          }
        } finally {
          controller.signal.removeEventListener('abort', close);
          close();
        }
        if (closeFailed) throw cleanupError();
      } catch {
        if (cleanupError()) throw cleanupError();
        if (controller.signal.aborted) throw abortError();
        throw new Error('An unproven runtime registration prevents secure daemon discovery.');
      }
    }
    if (controller.signal.aborted) throw abortError();
    return found;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
