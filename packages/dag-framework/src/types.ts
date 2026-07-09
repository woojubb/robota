import type {
  IClockPort,
  IDagNodeDefinition,
  ILeasePort,
  IPromptBackendPort,
  IQueuePort,
  IRunDraftStore,
  IStoragePort,
  ITaskExecutorPort,
  IAssetStore,
} from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IWorkerLoopPolicyOptions } from '@robota-sdk/dag-worker';
import type { IDagControllerComposition, IDagExecutionComposition } from '@robota-sdk/dag-api';
import type { IDagOrchestrationPort } from '@robota-sdk/dag-orchestration-client';

/** Lifecycle-aware in-process DAG framework instance. */
export interface IDagFramework {
  /** In-process implementation of the orchestration port surface. */
  readonly client: IDagOrchestrationPort;

  /** Direct access to inner services for embedders that need progress streams, etc. */
  readonly internals: {
    readonly controllers: IDagControllerComposition;
    readonly execution: IDagExecutionComposition;
    readonly storage: IStoragePort;
    /** Prompt-API backend. Use with PromptApiController. */
    readonly promptBackend: IPromptBackendPort & {
      getPromptIdForDagRun(dagRunId: string): string | undefined;
    };
    /** Asset store for file I/O operations. */
    readonly assetStore: IAssetStore;
  };

  /** Starts the background worker loop. Idempotent. */
  start(): Promise<void>;

  /** Stops the background worker loop and drains pending tasks. Idempotent. */
  stop(): Promise<void>;
}

export interface IDagFrameworkPorts {
  readonly storage?: IStoragePort;
  readonly queue?: IQueuePort;
  readonly deadLetterQueue?: IQueuePort;
  readonly lease?: ILeasePort;
  readonly clock?: IClockPort;
  readonly executor?: ITaskExecutorPort;
  readonly assetStore?: IAssetStore;
  readonly runDraftStore?: IRunDraftStore;
}

export interface IDagFrameworkPaths {
  readonly storageRoot?: string;
  readonly assetRoot?: string;
}

export interface IDagFrameworkLogger {
  info(msg: string): void;
  error(msg: string, err?: unknown): void;
}

export interface IDagFrameworkOptions {
  /** Node definitions to register. Defaults to the lazily-loaded catalog from `@robota-sdk/dag-nodes-default`. */
  readonly nodes?: readonly IDagNodeDefinition[];
  /**
   * Provider-definition registry injected into the collapsed `llm-text` node (ARCH-PROVIDER-003).
   * Defaults to a lazily-loaded `createDefaultProviderDefinitions()`. **Ignored when `nodes` is supplied**
   * — custom node sets carry their own provider wiring.
   */
  readonly providers?: readonly IProviderDefinition[];
  /** Override individual infrastructure ports. */
  readonly ports?: IDagFrameworkPorts;
  /** Override storage and asset paths (overrides env vars). */
  readonly paths?: IDagFrameworkPaths;
  /** Worker loop policy overrides. */
  readonly worker?: Partial<IWorkerLoopPolicyOptions>;
  /** When true, auto-starts the worker loop during createDagFramework(). Default: false. */
  readonly autoStart?: boolean;
  /** Optional logger. Defaults to no-op. */
  readonly logger?: IDagFrameworkLogger;
}
