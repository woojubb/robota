import { randomUUID } from 'node:crypto';

import type {
  IQueuedInput,
  SessionExecutionController,
} from './interactive-session-execution-controller.js';
import type { IToolExecutionResult, IToolSchema, TToolParameters } from '@robota-sdk/agent-core';
import type {
  IRuntimeToolInvokeOptions,
  ISessionRuntimeTools,
} from '@robota-sdk/agent-interface-session';

interface IRuntimeToolsDeps {
  readonly controller: () => SessionExecutionController;
  readonly ensureInitialized: () => Promise<void>;
  readonly session: () => ISessionRuntimeTools;
  /** Starts a queued turn; a submission that arrived during the call runs when the call ends. */
  readonly resumeQueuedTurn: (entry: IQueuedInput) => Promise<void>;
}

/** Admits direct calls through the same foreground owner as prompt turns. */
export class InteractiveSessionRuntimeTools implements ISessionRuntimeTools {
  private inFlight: Promise<IToolExecutionResult> | undefined;

  constructor(private readonly deps: IRuntimeToolsDeps) {}

  async listRuntimeTools(): Promise<IToolSchema[]> {
    this.assertOpen();
    await this.deps.ensureInitialized();
    this.assertOpen();
    return this.deps.session().listRuntimeTools();
  }

  async invokeRuntimeTool(
    name: string,
    parameters: TToolParameters,
    options?: IRuntimeToolInvokeOptions,
  ): Promise<IToolExecutionResult> {
    this.assertOpen();
    options?.signal?.throwIfAborted();
    const controller = this.deps.controller();
    if (controller.pendingCount() > 0) throw new Error('A submission is already queued.');
    const claim = controller.executionClaim.acquire('runtime-tool');
    // The claim is exclusive, so no turn is active meanwhile: the driver this call acts for is the
    // one the permission prompt and the tool events it raises are attributed to.
    controller.activeDriverId = options?.driverId ?? null;
    // This call's events are recognised by their id, not by the claim: a model's call can end while
    // this one holds the claim, and only this call's own events are a direct call's.
    const executionId = options?.executionId ?? randomUUID();
    controller.directCallIds.add(executionId);
    const execution = (async () => {
      await this.deps.ensureInitialized();
      this.assertOpen();
      options?.signal?.throwIfAborted();
      return this.deps.session().invokeRuntimeTool(name, parameters, { ...options, executionId });
    })();
    this.inFlight = execution;
    try {
      return await execution;
    } finally {
      this.inFlight = undefined;
      controller.activeDriverId = null;
      controller.directCallIds.delete(executionId);
      controller.completeRuntimeTool(claim, this.deps.resumeQueuedTurn);
    }
  }

  async drain(): Promise<void> {
    // The caller observes the failure; shutdown waits for settlement, not a successful result.
    await this.inFlight?.then(
      () => {},
      () => {},
    );
  }

  private assertOpen(): void {
    if (this.deps.controller().shuttingDown)
      throw new Error('Interactive session is shutting down.');
  }
}
