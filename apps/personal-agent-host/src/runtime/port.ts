/**
 * The runtime port: everything the control plane asks of a place that runs units. Arguments and
 * results are plain JSON (no handles, paths, callbacks or local addresses) so a backend on another
 * host is transport only. A unit's address always comes from the port, never from localhost.
 */

export type RuntimeBackend = 'container' | 'vm';

export interface IUnitLimits {
  memoryMb: number;
  cpus: number;
  pids: number;
}

export interface IProviderInfo {
  type: string;
  model?: string;
  baseUrl?: string;
}

/** What a unit is built from. Carries no secret. */
export interface IUnitSpec {
  account: string;
  installId: string;
  /** An engine image id, never a mutable tag. */
  image: string;
  subnetSlot: number;
  limits: IUnitLimits;
  hostname: string;
  publicOrigin: string;
  provider: IProviderInfo;
}

/** Secrets handed to a unit at start only, typed instead of an environment map. */
export interface IUnitSecrets {
  modelApiKey?: string;
}

export interface IUnitEndpoints {
  host: string;
  guiPort: number;
  wsPort: number;
}

export type UnitRunState = 'provisioned' | 'running' | 'stopped' | 'exited';

export interface IUnitStatus {
  account: string;
  state: UnitRunState;
  healthy: boolean;
  endpoints: IUnitEndpoints;
  /** Whether the unit was started with a model key; never the key. */
  keyConfigured: boolean;
}

export type GuardState = 'verified' | 'unverified';

export interface IRuntimeDescription {
  backend: RuntimeBackend;
  /** Checked live each time it is asked for. */
  guard: { state: GuardState; detail?: string };
  isolation: string[];
}

export interface IAccessCode {
  code: string;
}

export type RuntimePortErrorCode =
  'unknown-account' | 'no-access-code' | 'guard-unverified' | 'invalid-spec' | 'failed';

export class RuntimePortError extends Error {
  constructor(
    readonly code: RuntimePortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimePortError';
  }
}

export interface IRuntimePort {
  describe(): Promise<IRuntimeDescription>;
  /** The image id a reference (a tag) names right now; fails when the image does not exist. */
  resolveImage(reference: string): Promise<string>;
  /** Creates the unit's volume, network and container without starting it. Idempotent. */
  provision(spec: IUnitSpec): Promise<IUnitStatus>;
  /** Starts a provisioned unit with its secrets. Refused while the guard is not verified. */
  start(spec: IUnitSpec, secrets: IUnitSecrets): Promise<IUnitStatus>;
  /** Stops a unit and keeps its state. */
  stop(account: string): Promise<void>;
  /** Removes everything of the unit and verifies nothing remains. An absent unit is fine. */
  destroy(account: string): Promise<void>;
  inspect(account: string): Promise<IUnitStatus>;
  /** Every unit of this install, recorded or not. */
  list(): Promise<IUnitStatus[]>;
  /**
   * Reads the access code from the unit's state, stopped or running, with the image the account
   * is recorded to run.
   */
  accessCode(spec: IUnitSpec): Promise<IAccessCode>;
}
