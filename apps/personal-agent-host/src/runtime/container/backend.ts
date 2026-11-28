import type { ISubnetPool } from '../../config.js';
import { errorMessage, scrub } from '../../errors.js';
import {
  type IAccessCode,
  type IRuntimeDescription,
  type IRuntimePort,
  type IUnitSecrets,
  type IUnitSpec,
  type IUnitStatus,
  RuntimePortError,
  type UnitRunState,
} from '../port.js';
import { networkBody, unitContainerBody, volumeBody } from './bodies.js';
import { type EngineClient, isNotFound } from './engine-client.js';
import { NetworkGuard } from './guard.js';
import { runHelper } from './helper.js';
import {
  ACCESS_CODE_FILE,
  accountNetwork,
  API_KEY_VARIABLE,
  cidrsOverlap,
  GUI_PORT,
  LABEL_ACCOUNT,
  LABEL_IMAGE,
  LABEL_INSTALL,
  LABEL_SLOT,
  objectName,
  slotOfAddress,
  volumeName,
  WS_PORT,
} from './names.js';

const DEFAULT_READY_MS = 90_000;
const DEFAULT_HELPER_MS = 60_000;
const DEFAULT_POLL_MS = 500;
const STOP_GRACE_SECONDS = '10';
const READ_MOUNT = '/state';
const ACCESS_CODE = /^[A-Za-z0-9_-]{32,}$/u;

const ISOLATION: string[] = [
  'one bridge network per account: a /29, IPv4 only, no traffic between containers',
  'the image user with every capability dropped, no-new-privileges and a read-only root',
  'memory without swap, CPUs, process count and rotated logs limited per unit',
  'the state volume is the only mount; no ports are published',
  'a firewall guard on the engine host: no new connection into a unit except from the host, ' +
    'no account-to-account traffic, DNS only to the host resolvers, no private, link-local or ' +
    'carrier-grade NAT ranges',
  'one shared kernel and no disk quota: for trusted accounts only',
];

export interface IContainerRuntimeOptions {
  engine: EngineClient;
  installId: string;
  subnetPool: ISubnetPool;
  guardImage: string;
  /** Resolvers the guard allows DNS to; discovered from the engine host when absent. */
  resolvers?: readonly string[];
  readyTimeoutMs?: number;
  helperTimeoutMs?: number;
  pollMs?: number;
}

interface IEngineContainer {
  Id: string;
  State: { Status: string; Running: boolean; ExitCode: number; Health?: { Status: string } };
  Config: { Env?: string[] | null; Labels?: Record<string, string> | null };
}

interface IEngineVolume {
  Name: string;
  Labels?: Record<string, string> | null;
}

interface IEngineNetwork {
  Name: string;
  Labels?: Record<string, string> | null;
  IPAM?: { Config?: Array<{ Subnet?: string }> | null } | null;
}

interface IResources {
  container?: IEngineContainer;
  volume?: IEngineVolume;
  network?: IEngineNetwork;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function optional<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function runState(status: string): UnitRunState {
  if (status === 'running') return 'running';
  if (status === 'exited' || status === 'dead') return 'exited';
  return 'stopped';
}

/**
 * Runs units as containers on a local or remote engine. Every object carries the install's labels,
 * so a unit is found, listed and verified removed by label and never by guess. The container is
 * created at start with the key in its environment and removed at stop, so a stopped unit holds no
 * secret.
 */
export class ContainerRuntime implements IRuntimePort {
  private readonly engine: EngineClient;
  private readonly guard: NetworkGuard;
  private readonly helperMs: number;

  constructor(private readonly options: IContainerRuntimeOptions) {
    this.engine = options.engine;
    this.helperMs = options.helperTimeoutMs ?? DEFAULT_HELPER_MS;
    this.guard = new NetworkGuard({
      engine: options.engine,
      installId: options.installId,
      guardImage: options.guardImage,
      ...(options.resolvers ? { resolvers: options.resolvers } : {}),
      helperTimeoutMs: this.helperMs,
    });
  }

  // ---- helpers -----------------------------------------------------------------------------

  private async attempt<T>(work: () => Promise<T>, secrets: readonly string[] = []): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof RuntimePortError) throw error;
      throw new RuntimePortError('failed', scrub(errorMessage(error), secrets));
    }
  }

  private checkSpec(spec: IUnitSpec): void {
    if (spec.installId !== this.options.installId) {
      throw new RuntimePortError('invalid-spec', 'The unit belongs to a different install');
    }
    if (accountNetwork(this.options.subnetPool, spec.subnetSlot) === undefined) {
      throw new RuntimePortError(
        'invalid-spec',
        `Subnet slot ${spec.subnetSlot} is outside the pool`,
      );
    }
  }

  private filters(account?: string): { filters: string } {
    const label = [`${LABEL_INSTALL}=${this.options.installId}`];
    if (account !== undefined) label.push(`${LABEL_ACCOUNT}=${account}`);
    return { filters: JSON.stringify({ label }) };
  }

  private async resources(account: string): Promise<IResources> {
    const id = this.options.installId;
    const [container, volume, network] = await Promise.all([
      optional(
        this.engine.json<IEngineContainer>('GET', `/containers/${objectName(id, account)}/json`),
      ),
      optional(this.engine.json<IEngineVolume>('GET', `/volumes/${volumeName(id, account)}`)),
      optional(this.engine.json<IEngineNetwork>('GET', `/networks/${objectName(id, account)}`)),
    ]);
    return { container, volume, network };
  }

  private statusOf(account: string, found: IResources): IUnitStatus {
    const { container, volume, network } = found;
    const labelled = volume?.Labels ?? network?.Labels ?? container?.Config.Labels ?? {};
    const slot =
      labelled[LABEL_SLOT] !== undefined && /^\d+$/u.test(labelled[LABEL_SLOT])
        ? Number(labelled[LABEL_SLOT])
        : slotOfAddress(
            this.options.subnetPool,
            network?.IPAM?.Config?.[0]?.Subnet?.split('/')[0] ?? '',
          );
    const addresses =
      slot === undefined ? undefined : accountNetwork(this.options.subnetPool, slot);
    if (!addresses) {
      throw new RuntimePortError('failed', `Unit ${account} has no readable subnet slot`);
    }
    const keyConfigured = (container?.Config.Env ?? []).some(
      (entry) =>
        entry.startsWith(`${API_KEY_VARIABLE}=`) && entry.length > API_KEY_VARIABLE.length + 1,
    );
    return {
      account,
      state: container ? runState(container.State.Status) : 'stopped',
      healthy: container?.State.Running === true && container.State.Health?.Status === 'healthy',
      endpoints: { host: addresses.unit, guiPort: GUI_PORT, wsPort: WS_PORT },
      keyConfigured: container?.State.Running === true ? keyConfigured : false,
    };
  }

  private async existing(account: string): Promise<{ found: IResources; status: IUnitStatus }> {
    const found = await this.resources(account);
    if (!found.container && !found.volume && !found.network) {
      throw new RuntimePortError('unknown-account', `No unit for account ${account}`);
    }
    return { found, status: this.statusOf(account, found) };
  }

  private async removeContainer(name: string): Promise<void> {
    await optional(
      this.engine.text('POST', `/containers/${name}/stop`, { query: { t: STOP_GRACE_SECONDS } }),
    ).catch(() => undefined);
    await optional(this.engine.text('DELETE', `/containers/${name}`, { query: { force: '1' } }));
  }

  // ---- the port ----------------------------------------------------------------------------

  async describe(): Promise<IRuntimeDescription> {
    const guard = await this.guard.ensure();
    return {
      backend: 'container',
      guard:
        guard.detail === undefined
          ? { state: guard.state }
          : { state: guard.state, detail: guard.detail },
      isolation: ISOLATION,
    };
  }

  async provision(spec: IUnitSpec): Promise<IUnitStatus> {
    this.checkSpec(spec);
    return this.attempt(async () => {
      const id = this.options.installId;
      const address = accountNetwork(this.options.subnetPool, spec.subnetSlot);
      if (!address) throw new RuntimePortError('invalid-spec', 'Subnet slot is outside the pool');
      const { account } = spec;
      const created: Array<() => Promise<unknown>> = [];
      try {
        if (!(await optional(this.engine.json('GET', `/volumes/${volumeName(id, account)}`)))) {
          await this.engine.json('POST', '/volumes/create', { body: volumeBody(spec) });
          created.push(() => this.engine.text('DELETE', `/volumes/${volumeName(id, account)}`));
        }
        const network = await optional(
          this.engine.json<IEngineNetwork>('GET', `/networks/${objectName(id, account)}`),
        );
        if (network) {
          const subnet = network.IPAM?.Config?.[0]?.Subnet;
          if (subnet !== address.cidr) {
            throw new RuntimePortError(
              'failed',
              `The network of ${account} is ${subnet ?? 'unreadable'}, expected ${address.cidr}`,
            );
          }
        } else {
          const others = await this.engine.json<IEngineNetwork[]>('GET', '/networks');
          for (const other of others) {
            for (const config of other.IPAM?.Config ?? []) {
              if (config.Subnet && cidrsOverlap(config.Subnet, address.cidr)) {
                throw new RuntimePortError(
                  'failed',
                  `${address.cidr} overlaps the engine network ${other.Name} (${config.Subnet}); ` +
                    'choose another subnet pool',
                );
              }
            }
          }
          await this.engine.json('POST', '/networks/create', { body: networkBody(spec, address) });
          created.push(() => this.engine.text('DELETE', `/networks/${objectName(id, account)}`));
        }
      } catch (error) {
        for (const undo of created.reverse()) await undo().catch(() => undefined);
        throw error;
      }
      return this.statusOf(account, await this.resources(account));
    });
  }

  async start(spec: IUnitSpec, secrets: IUnitSecrets): Promise<IUnitStatus> {
    this.checkSpec(spec);
    const known = secrets.modelApiKey ? [secrets.modelApiKey] : [];
    return this.attempt(async () => {
      const address = accountNetwork(this.options.subnetPool, spec.subnetSlot);
      if (!address) throw new RuntimePortError('invalid-spec', 'Subnet slot is outside the pool');
      const { found } = await this.existing(spec.account);
      if (!found.volume || !found.network) {
        throw new RuntimePortError('unknown-account', `Unit ${spec.account} is not provisioned`);
      }
      const guard = await this.guard.ensure();
      if (guard.state !== 'verified') {
        throw new RuntimePortError(
          'guard-unverified',
          scrub(
            `The network guard is not verified${guard.detail ? ` (${guard.detail})` : ''}`,
            known,
          ),
        );
      }
      const name = objectName(this.options.installId, spec.account);
      if (found.container?.State.Running) return this.statusOf(spec.account, found);
      if (found.container) await this.removeContainer(name);
      await this.engine.json('POST', '/containers/create', {
        query: { name },
        body: unitContainerBody(spec, secrets, address),
      });
      try {
        await this.engine.text('POST', `/containers/${name}/start`);
        await this.waitUntilHealthy(name);
      } catch (error) {
        await this.removeContainer(name).catch(() => undefined);
        throw error;
      }
      return this.statusOf(spec.account, await this.resources(spec.account));
    }, known);
  }

  private async waitUntilHealthy(name: string): Promise<void> {
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? DEFAULT_READY_MS);
    const poll = this.options.pollMs ?? DEFAULT_POLL_MS;
    for (;;) {
      const container = await this.engine.json<IEngineContainer>('GET', `/containers/${name}/json`);
      if (!container.State.Running) {
        throw new Error(`The unit exited while starting (exit code ${container.State.ExitCode})`);
      }
      if (container.State.Health?.Status === 'healthy') return;
      if (Date.now() >= deadline) throw new Error('The unit did not become healthy in time');
      await sleep(poll);
    }
  }

  async stop(account: string): Promise<void> {
    await this.attempt(async () => {
      await this.existing(account);
      await this.removeContainer(objectName(this.options.installId, account));
    });
  }

  async destroy(account: string): Promise<void> {
    await this.attempt(async () => {
      const id = this.options.installId;
      await this.removeContainer(objectName(id, account));
      await optional(this.engine.text('DELETE', `/networks/${objectName(id, account)}`));
      await optional(this.engine.text('DELETE', `/volumes/${volumeName(id, account)}`));
      const query = this.filters(account);
      const [containers, volumes, networks] = await Promise.all([
        this.engine.json<unknown[] | null>('GET', '/containers/json', {
          query: { all: '1', ...query },
        }),
        this.engine.json<{ Volumes?: unknown[] | null }>('GET', '/volumes', { query }),
        this.engine.json<unknown[] | null>('GET', '/networks', { query }),
      ]);
      const left = [
        ...(containers ?? []).map(() => 'container'),
        ...(volumes.Volumes ?? []).map(() => 'volume'),
        ...(networks ?? []).map(() => 'network'),
      ];
      if (left.length > 0) {
        throw new RuntimePortError(
          'failed',
          `Destroying ${account} left ${left.join(', ')} behind in the engine`,
        );
      }
    });
  }

  async inspect(account: string): Promise<IUnitStatus> {
    return this.attempt(async () => (await this.existing(account)).status);
  }

  async list(): Promise<IUnitStatus[]> {
    return this.attempt(async () => {
      const query = this.filters();
      const [containers, volumes, networks] = await Promise.all([
        this.engine.json<Array<{ Labels?: Record<string, string> | null }> | null>(
          'GET',
          '/containers/json',
          {
            query: { all: '1', ...query },
          },
        ),
        this.engine.json<{ Volumes?: IEngineVolume[] | null }>('GET', '/volumes', { query }),
        this.engine.json<IEngineNetwork[] | null>('GET', '/networks', { query }),
      ]);
      const accounts = new Set<string>();
      for (const labels of [
        ...(containers ?? []).map((c) => c.Labels),
        ...(volumes.Volumes ?? []).map((v) => v.Labels),
        ...(networks ?? []).map((n) => n.Labels),
      ]) {
        const account = labels?.[LABEL_ACCOUNT];
        if (account) accounts.add(account);
      }
      const statuses: IUnitStatus[] = [];
      for (const account of [...accounts].sort()) {
        const found = await this.resources(account);
        if (found.container || found.volume || found.network) {
          statuses.push(this.statusOf(account, found));
        }
      }
      return statuses;
    });
  }

  async accessCode(account: string): Promise<IAccessCode> {
    return this.attempt(async () => {
      const { found } = await this.existing(account);
      const image = found.volume?.Labels?.[LABEL_IMAGE];
      if (!found.volume || !image) {
        throw new RuntimePortError('no-access-code', `Unit ${account} has no state yet`);
      }
      // The volume is read by a throwaway container, so the code is available stopped or running.
      const result = await runHelper(
        this.engine,
        this.options.installId,
        {
          image,
          entrypoint: ['cat', `${READ_MOUNT}/${ACCESS_CODE_FILE}`],
          mounts: [{ volume: found.volume.Name, target: READ_MOUNT }],
        },
        this.helperMs,
      );
      const code = result.output.trim();
      if (result.exitCode !== 0) {
        throw new RuntimePortError('no-access-code', `Unit ${account} has not started yet`);
      }
      if (!ACCESS_CODE.test(code)) {
        throw new RuntimePortError('failed', `Unit ${account} holds an unreadable access code`);
      }
      return { code };
    });
  }
}
