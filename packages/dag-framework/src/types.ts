import type {
  IClockPort,
  IDagNodeDefinition,
  ILeasePort,
  IPromptBackendPort,
  IQueuePort,
  IRunDraftStore,
  IRunDraftOperationsPort,
  IStoragePort,
  ITaskExecutorPort,
  IAssetStore,
  IDagValidationPort,
  IDagNodeCatalogPort,
  IDagDefinitionReadPort,
  IDagDefinitionMutationPort,
} from '@robota-sdk/dag-core';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IRunAdvancementCoordinator, IWorkerLoopPolicyOptions } from '@robota-sdk/dag-worker';
import type {
  IDagControllerComposition,
  IRuntimeRunCancellerPort,
  IRuntimeRunCreatorPort,
  IRuntimeRunProgressEventBusPort,
  IRuntimeRunReaderPort,
  IDagRunLifecyclePort,
} from '@robota-sdk/dag-api';
import type { ICostMetaOperationsPort } from '@robota-sdk/dag-cost';
import type { IDagBuildPort } from '@robota-sdk/dag-builder';

/** Framework-owned assembly result for one in-process execution composition. */
export interface IDagExecutionComposition {
  readonly runOrchestrator: IRuntimeRunCreatorPort;
  readonly runQuery: IRuntimeRunReaderPort;
  readonly runCancel: IRuntimeRunCancellerPort;
  readonly runAdvancement: IRunAdvancementCoordinator;
  readonly runProgressEventBus: IRuntimeRunProgressEventBusPort;
}

/** Lifecycle-aware in-process DAG framework instance. */
export interface IDagFramework {
  /** In-process run lifecycle without HTTP responses. */
  readonly runs: IDagRunLifecyclePort;

  /** Pipeline authoring returns a domain result without an HTTP envelope. */
  readonly build: IDagBuildPort;

  /** Definition validation returns a domain result without an HTTP envelope. */
  readonly validation: IDagValidationPort;

  /** Registered node manifests without an HTTP envelope. */
  readonly catalog: IDagNodeCatalogPort;

  /** Definition summaries and lookup without an HTTP envelope. */
  readonly definitionReads: IDagDefinitionReadPort;

  /** Definition lifecycle changes without an HTTP envelope. */
  readonly definitionMutations: IDagDefinitionMutationPort;

  /** Cost metadata management is an independent domain capability. */
  readonly costMeta: ICostMetaOperationsPort;

  /** Run-draft editing is an independent domain capability. */
  readonly runDrafts: IRunDraftOperationsPort;

  /** Domain asset storage and content streaming, independent of HTTP. */
  readonly assets: IAssetStore;

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

  /** Starts the queue-scoped advancement actor. Idempotent until the framework is stopped. */
  start(): Promise<void>;

  /** Closes prompt admission, quiesces the current worker step, and drains owned observers. */
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
  /** Trusted absolute filesystem root. Defaults only at this product boundary to process.cwd(). */
  readonly executionRoot?: string;
  /** Node definitions to register. Defaults to the lazily-loaded catalog from `@robota-sdk/dag-nodes-default`. */
  readonly nodes?: readonly IDagNodeDefinition[];
  /**
   * Provider-definition registry injected into the collapsed `llm-text` node (ARCH-PROVIDER-003).
   * Defaults to a lazily-loaded `createDefaultProviderDefinitions()`. **Ignored when `nodes` is supplied**
   * — custom node sets carry their own provider wiring.
   */
  readonly providers?: readonly IProviderDefinition[];
  /** Host-minted bounded filesystem sources used by default skill-node resolution. */
  readonly contributionSources?: readonly IDagContributionSource[];
  /** Ordered host-selected directories scanned by the default skill node. */
  readonly skillRoots?: readonly IDagSkillRootDescriptor[];
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

/** Structural host source contract, kept free of an agent-framework dependency in dag-framework. */
export interface IDagContributionSource {
  readonly kind: 'host' | 'project';
  readonly displayName: string;
  readText(relativePath: string, purpose: string): string | undefined;
  listDirectory(
    relativePath: string,
    purpose: string,
  ): readonly { readonly name: string; readonly kind: 'file' | 'directory' | 'link' | 'other' }[];
  inspectKind(
    relativePath: string,
    purpose: string,
  ): 'file' | 'directory' | 'link' | 'other' | undefined;
}

/** Host-selected skill or legacy-command root, ordered by precedence. */
export interface IDagSkillRootDescriptor {
  readonly root: string;
  readonly kind: 'skills' | 'commands';
}
