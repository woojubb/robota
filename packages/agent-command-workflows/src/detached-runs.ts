import { randomUUID } from 'node:crypto';

import type { ICommandResult } from '@robota-sdk/agent-interface-command';

import { tokenize } from './args.js';

type TPhase = 'running' | 'completed' | 'failed' | 'cancelled';

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

  start(run: (signal: AbortSignal) => Promise<ICommandResult>): ICommandResult {
    const id = randomUUID();
    const controller = new AbortController();
    const entry: IRunEntry = { id, controller, phase: 'running', settled: Promise.resolve() };
    this.entries.set(id, entry);
    entry.settled = Promise.resolve()
      .then(() => run(controller.signal))
      .then((result) => {
        entry.result = controller.signal.aborted
          ? { success: false, message: 'Workflow cancelled.' }
          : result;
        entry.phase = controller.signal.aborted
          ? 'cancelled'
          : result.success
            ? 'completed'
            : 'failed';
      })
      .catch((error: unknown) => {
        entry.result = {
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
        entry.phase = controller.signal.aborted ? 'cancelled' : 'failed';
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

  private find(args: string, command: 'status' | 'cancel'): IRunEntry | ICommandResult {
    const tokens = tokenize(args);
    if (tokens.length !== 1 || !tokens[0]) {
      return { success: false, message: `Usage: /workflows ${command} <run-id>` };
    }
    const entry = this.entries.get(tokens[0]);
    return entry ?? { success: false, message: `Unknown workflow run ID: ${tokens[0]}` };
  }
}
