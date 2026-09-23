import type { SessionExecutionController } from './interactive-session-execution-controller.js';
import type { IToolExecutionResult, IToolSchema, TToolParameters } from '@robota-sdk/agent-core';
import type { ISessionRuntimeTools } from '@robota-sdk/agent-interface-session';

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
    options?: { signal?: AbortSignal },
  ): Promise<IToolExecutionResult> {
    this.assertOpen();
    options?.signal?.throwIfAborted();
    const controller = this.deps.controller();
    if (controller.pendingCount() > 0) throw new Error('A submission is already queued.');
    const claim = controller.executionClaim.acquire('runtime-tool');
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
