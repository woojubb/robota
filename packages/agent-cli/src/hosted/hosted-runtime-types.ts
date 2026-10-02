import type { TConfigEnvironment } from '@robota-sdk/product-config';

export interface IHostedIdentity {
  readonly tenant: string;
  readonly task: string;
  readonly rootTask: string;
  readonly actor: string;
  readonly runtime: string;
}

export interface IHostedBackend {
  readonly endpoint: string;
  readonly resource: string;
  readonly publicKey: string;
}

export interface IHostedSnapshot {
  readonly id: string;
  readonly digest: string;
}

/** Operator-owned deployment input; no project settings or model output can supply it. */
export interface IHostedRuntimeConfig {
  readonly version: 3;
  readonly identity: IHostedIdentity;
  readonly epoch: number;
  readonly worker: IHostedBackend;
  readonly broker: IHostedBackend;
  readonly snapshot: IHostedSnapshot | null;
  readonly lifetimeMs: number;
  readonly probeTimeoutMs: number;
  /** Owner-selected supervisory ceilings; broker reservations bound individual requests. */
  readonly limits: IHostedRuntimeUsage;
}

export type THostedBackendRole = 'worker' | 'broker';

/** Signed by the operator's trusted issuer outside the task worker. */
export interface IHostedAdmissionProof {
  readonly version: 3;
  readonly identity: IHostedIdentity;
  readonly role: THostedBackendRole;
  readonly resource: string;
  readonly nonce: string;
  readonly epoch: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly snapshot: IHostedSnapshot | null;
  readonly ready: true;
  readonly limits: IHostedRuntimeUsage;
  /** Only the broker supplies cumulative current-epoch accounting; worker proofs carry null. */
  readonly usage: IHostedRuntimeUsage | null;
  readonly signature: string;
}

export interface IHostedAdmission {
  readonly config: IHostedRuntimeConfig;
  readonly worker: IHostedAdmissionProof;
  readonly broker: IHostedAdmissionProof;
  readonly expiresAt: number;
}

/** A complete hosted composition must own execution and teardown, not only return a health flag. */
export interface IHostedRuntimeExecutor {
  run(admission: IHostedAdmission, control: IHostedRuntimeControl): Promise<void>;
  stop(reason: string): Promise<void>;
  release(): Promise<void>;
}

/** Requested execution data; CLI flags grant no worker or company authority. */
export interface IHostedRuntimeInvocation {
  readonly mode: 'headless' | 'serve' | 'mcp' | 'interactive' | 'command';
  /** Validated, immutable CLI arguments; no host environment or state is projected. */
  readonly argv: readonly string[];
  readonly resume: boolean;
}

/** The operator installs a complete adapter; the CLI never substitutes a local worker. */
export type THostedRuntimeExecutorFactory = (
  admission: IHostedAdmission,
  signal: AbortSignal,
  invocation: IHostedRuntimeInvocation,
) => Promise<IHostedRuntimeExecutor>;

export interface IHostedRuntimeUsage {
  readonly sessions: number;
  readonly modelCalls: number;
  readonly modelTokens: number;
  readonly costMicros: number;
}

export interface IHostedRuntimeControl {
  readonly signal: AbortSignal;
  /** Trusted runtime instrumentation reports cumulative observations, not worker-selected budgets. */
  observe(usage: IHostedRuntimeUsage): void;
}

export interface IHostedAdmissionOptions {
  readonly environment: TConfigEnvironment;
  readonly resume: boolean;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}
