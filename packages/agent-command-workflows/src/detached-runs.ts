import { randomUUID } from 'node:crypto';

import type { ICommandResult } from '@robota-sdk/agent-interface-command';

import { tokenize } from './args.js';

type TPhase = 'running' | 'completed' | 'failed' | 'cancelled';
const MAX_ACTIVE_RUNS = 4;
const MAX_TERMINAL_RUNS = 100;
const MAX_RETAINED_RESULT_BYTES = 16 * 1024;
const TRUNCATED_RESULT_SUFFIX = '\n[Workflow result truncated for status]';

function retainResult(result: ICommandResult): ICommandResult {
  const message = result.message;
  if (Buffer.byteLength(message, 'utf8') <= MAX_RETAINED_RESULT_BYTES) {
    return { success: result.success, message };
  }
  const prefixBytes =
    MAX_RETAINED_RESULT_BYTES - Buffer.byteLength(TRUNCATED_RESULT_SUFFIX, 'utf8');
  const buffer = new Uint8Array(prefixBytes);
  const { written } = new TextEncoder().encodeInto(message, buffer);
  return {
    success: result.success,
    message: new TextDecoder().decode(buffer.subarray(0, written)) + TRUNCATED_RESULT_SUFFIX,
  };
}

interface IRunEntry {
  readonly id: string;
  readonly controller: AbortController;
  phase: TPhase;
  result?: ICommandResult;
  settled: Promise<void>;
}

/** Live, module-owned execution handles. IDs are valid for this CLI process only. */
export class DetachedWorkflowRuns {
  private readonly entries = new Map<string, IRunEntry>();
  private closed = false;
  private shutdownPromise?: Promise<void>;

  start(run: (signal: AbortSignal) => Promise<ICommandResult>): ICommandResult {
    if (this.closed) {
      return { success: false, message: 'This workflow session is shutting down.' };
    }
    if (
      [...this.entries.values()].filter((entry) => entry.phase === 'running').length >=
      MAX_ACTIVE_RUNS
    ) {
      return {
        success: false,
        message: 'Too many active detached workflow runs; wait for a run to finish or cancel one.',
      };
    }
    const id = randomUUID();
    const controller = new AbortController();
    const entry: IRunEntry = { id, controller, phase: 'running', settled: Promise.resolve() };
    this.entries.set(id, entry);
    entry.settled = Promise.resolve()
      .then(() => run(controller.signal))
      .then((result) => {
        entry.result = controller.signal.aborted
          ? { success: false, message: 'Workflow cancelled.' }
          : retainResult(result);
        entry.phase = controller.signal.aborted
          ? 'cancelled'
          : result.success
            ? 'completed'
            : 'failed';
        this.pruneTerminals();
      })
      .catch((error: unknown) => {
        entry.result = retainResult({
          success: false,
          message: error instanceof Error ? error.message : String(error),
        });
        entry.phase = controller.signal.aborted ? 'cancelled' : 'failed';
        this.pruneTerminals();
      });
    return {
      success: true,
      message: `Workflow started. Run ID: ${id}\nStatus: /workflows status ${id}\nCancel: /workflows cancel ${id}\nThis run ID is available only in this CLI session.`,
    };
  }

  status(args: string): ICommandResult {
    const entry = this.find(args, 'status');
    if ('success' in entry) return entry;
    return {
      success: true,
      message: `Run ${entry.id}: ${entry.phase}${entry.result ? `\n${entry.result.message}` : ''}`,
    };
  }

  async cancel(args: string): Promise<ICommandResult> {
    const entry = this.find(args, 'cancel');
    if ('success' in entry) return entry;
    if (entry.phase !== 'running') {
      return { success: false, message: `Run ${entry.id} is already ${entry.phase}.` };
    }
    entry.controller.abort();
    await entry.settled;
    return this.cancellationResult(entry);
  }

  private cancellationResult(entry: IRunEntry): ICommandResult {
    return { success: entry.phase === 'cancelled', message: `Run ${entry.id}: ${entry.phase}` };
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.closed = true;
    const active = [...this.entries.values()].filter((entry) => entry.phase === 'running');
    for (const entry of active) entry.controller.abort();
    this.shutdownPromise = Promise.all(active.map((entry) => entry.settled)).then(() => {
      this.entries.clear();
    });
    return this.shutdownPromise;
  }

  private pruneTerminals(): void {
    let terminalCount = [...this.entries.values()].filter(
      (entry) => entry.phase !== 'running',
    ).length;
    for (const [id, entry] of this.entries) {
      if (terminalCount <= MAX_TERMINAL_RUNS) break;
      if (entry.phase === 'running') continue;
      this.entries.delete(id);
      terminalCount--;
    }
  }

  private find(args: string, command: 'status' | 'cancel'): IRunEntry | ICommandResult {
    const tokens = tokenize(args);
    if (tokens.length !== 1 || !tokens[0]) {
      return { success: false, message: `Usage: /workflows ${command} <run-id>` };
    }
    const entry = this.entries.get(tokens[0]);
    return entry ?? { success: false, message: `Unknown workflow run ID: ${tokens[0]}` };
  }
}
