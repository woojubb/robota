import type { SessionExecutionController } from './interactive-session-execution-controller.js';
import type { IToolExecutionResult, IToolSchema, TToolParameters } from '@robota-sdk/agent-core';
import type { ISessionRuntimeTools, TDriverId } from '@robota-sdk/agent-interface-session';

interface IRuntimeToolsDeps {
  readonly controller: () => SessionExecutionController;
  readonly ensureInitialized: () => Promise<void>;
  readonly session: () => ISessionRuntimeTools;
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
    options?: { signal?: AbortSignal; driverId?: TDriverId },
  ): Promise<IToolExecutionResult> {
    this.assertOpen();
    options?.signal?.throwIfAborted();
    const controller = this.deps.controller();
    if (controller.pendingCount() > 0) throw new Error('A submission is already queued.');
    const claim = controller.executionClaim.acquire('runtime-tool');
    // The caller drives the session while its direct call runs, as a turn's driver does: a prompt
    // the call raises is stamped with this id, so the surface that made the call can tell it is its own.
    controller.activeDriverId = options?.driverId ?? null;
    const execution = (async () => {
      await this.deps.ensureInitialized();
      this.assertOpen();
      options?.signal?.throwIfAborted();
      return this.deps.session().invokeRuntimeTool(name, parameters, options);
    })();
    this.inFlight = execution;
    try {
      return await execution;
    } finally {
      this.inFlight = undefined;
      controller.activeDriverId = null;
      controller.executionClaim.complete(claim, () => {});
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
