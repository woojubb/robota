import { TarError } from '../../archive/tar.js';
import { IMAGE_ID, type ISubnetPool } from '../../config.js';
import { errorMessage, scrub } from '../../errors.js';
import {
  type IAccessCode,
  type IRuntimeDescription,
  type IRuntimePort,
  type IUnitSecrets,
  type IUnitSpec,
  type IUnitStatus,
  RuntimePortError,
  type StateArchive,
  type UnitRunState,
} from '../port.js';
import { createArchiveHelper, fromEngineArchive, toEngineArchive } from './archive.js';
import { networkBody, unitContainerBody, volumeBody } from './bodies.js';
import { type EngineClient, isNotFound } from './engine-client.js';
import { NetworkGuard } from './guard.js';
import { runHelper } from './helper.js';
import { conflictingRoute, parseHostRoutes } from './routes.js';
import {
  ACCESS_CODE_FILE,
  accountNetwork,
  API_KEY_VARIABLE,
  cidrsOverlap,
  GUI_PORT,
  LABEL_ACCOUNT,
  LABEL_INSTALL,
  LABEL_SLOT,
  objectName,
  retainReference,
  slotOfAddress,
  STATE_PATH,
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
  Image?: string;
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
    if (!IMAGE_ID.test(spec.image)) {
      throw new RuntimePortError('invalid-spec', 'The unit image must be an engine image id');
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

  private statusOf(account: string, found: IResources, lenient = false): IUnitStatus {
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
    // A listing must still show a unit whose slot is not in the current pool, so a failing guard
    // can stop it; it has no usable address.
    if (!addresses && !lenient) {
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
      endpoints: addresses
        ? { host: addresses.unit, guiPort: GUI_PORT, wsPort: WS_PORT }
        : { host: '', guiPort: 0, wsPort: 0 },
      ...(container?.Image !== undefined ? { imageId: container.Image } : {}),
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

  async describe(options: { repair?: boolean } = {}): Promise<IRuntimeDescription> {
    const guard = options.repair === false ? await this.guard.verify() : await this.guard.ensure();
    return {
      backend: 'container',
      guard:
        guard.detail === undefined
          ? { state: guard.state }
          : { state: guard.state, detail: guard.detail },
      isolation: ISOLATION,
    };
  }

  /**
   * A subnet must not overlap another engine network or any route of the engine host. The engine
   * checks host routes only for subnets it picks itself, and a more specific route on an account
   * bridge would take the host's own gateway or resolver away.
   */
  private async checkSubnetFree(cidr: string): Promise<void> {
    const routes = await runHelper(
      this.engine,
      this.options.installId,
      {
        image: this.options.guardImage,
        entrypoint: ['cat', '/proc/net/route'],
        network: 'host',
      },
      this.helperMs,
    );
    if (routes.exitCode !== 0) {
      throw new RuntimePortError('failed', 'Could not read the routes of the engine host');
    }
    const route = conflictingRoute(parseHostRoutes(routes.output), this.options.installId, cidr);
    if (route) {
      throw new RuntimePortError(
        'failed',
        `${cidr} overlaps a route of the engine host (${route.cidr} on ${route.iface}); ` +
          'choose another subnet pool',
      );
    }
    const others = await this.engine.json<IEngineNetwork[]>('GET', '/networks');
    for (const other of others) {
      for (const config of other.IPAM?.Config ?? []) {
        if (config.Subnet && cidrsOverlap(config.Subnet, cidr)) {
          throw new RuntimePortError(
            'failed',
            `${cidr} overlaps the engine network ${other.Name} (${config.Subnet}); ` +
              'choose another subnet pool',
          );
        }
      }
    }
  }

  /** Tags the image so it outlives every container made from it; idempotent. */
  private async retainImage(imageId: string): Promise<void> {
    const [repo, tag] = retainReference(this.options.installId, imageId).split(':');
    try {
      await this.engine.text('POST', `/images/${imageId}/tag`, { query: { repo, tag } });
    } catch (error) {
      if (isNotFound(error)) {
        throw new RuntimePortError('failed', `The image ${imageId} does not exist on the engine`);
      }
      throw error;
    }
  }

  async releaseImage(imageId: string): Promise<void> {
    await this.attempt(async () => {
      // Only the retaining reference is removed; the engine deletes the image when nothing else
      // (a tag, a container) still uses it, and refuses while a unit runs from it.
      await optional(
        this.engine.text('DELETE', `/images/${retainReference(this.options.installId, imageId)}`),
      ).catch(() => undefined);
    });
  }

  async resolveImage(reference: string): Promise<string> {
    return this.attempt(async () => {
      try {
        const image = await this.engine.json<{ Id?: string }>(
          'GET',
          `/images/${encodeURI(reference)}/json`,
        );
        if (typeof image.Id !== 'string' || !IMAGE_ID.test(image.Id)) {
          throw new RuntimePortError('failed', `The engine returned no usable id for ${reference}`);
        }
        return image.Id;
      } catch (error) {
        if (isNotFound(error)) {
          throw new RuntimePortError(
            'failed',
            `The unit image ${reference} does not exist on the engine; build it first`,
          );
        }
        throw error;
      }
    });
  }

  async provision(spec: IUnitSpec): Promise<IUnitStatus> {
    this.checkSpec(spec);
    return this.attempt(async () => {
      const id = this.options.installId;
      const address = accountNetwork(this.options.subnetPool, spec.subnetSlot);
      if (!address) throw new RuntimePortError('invalid-spec', 'Subnet slot is outside the pool');
      const { account } = spec;
      const created: Array<() => Promise<unknown>> = [];
      // Everything that can refuse the subnet is asked before anything is created.
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
        await this.checkSubnetFree(address.cidr);
      }
      try {
        if (!(await optional(this.engine.json('GET', `/volumes/${volumeName(id, account)}`)))) {
          await this.engine.json('POST', '/volumes/create', { body: volumeBody(spec) });
          created.push(() => this.engine.text('DELETE', `/volumes/${volumeName(id, account)}`));
        }
        if (!network) {
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
      // A running unit made from another image is replaced, never kept as if it were this one.
      if (found.container?.State.Running && found.container.Image === spec.image) {
        return this.statusOf(spec.account, found);
      }
      await this.retainImage(spec.image);
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
      // Not through `existing`: a unit whose slot lies outside the current pool is listed with no
      // address, and the guard path must still be able to stop it.
      const found = await this.resources(account);
      if (!found.container && !found.volume && !found.network) {
        throw new RuntimePortError('unknown-account', `No unit for account ${account}`);
      }
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
          statuses.push(this.statusOf(account, found, true));
        }
      }
      return statuses;
    });
  }

  async accessCode(spec: IUnitSpec): Promise<IAccessCode> {
    this.checkSpec(spec);
    const account = spec.account;
    return this.attempt(async () => {
      const { found } = await this.existing(account);
      if (!found.volume) {
        throw new RuntimePortError('no-access-code', `Unit ${account} has no state yet`);
      }
      // The volume is read by a throwaway container, so the code is available stopped or running.
      const result = await runHelper(
        this.engine,
        this.options.installId,
        {
          image: spec.image,
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

  /** The unit's volume, once it is known that nothing is running from it. */
  private async idleVolume(spec: IUnitSpec): Promise<IEngineVolume> {
    const { found } = await this.existing(spec.account);
    if (!found.volume) {
      throw new RuntimePortError('unknown-account', `Unit ${spec.account} has no state volume`);
    }
    if (found.container?.State.Running) {
      throw new RuntimePortError('failed', `Unit ${spec.account} is running; stop it first`);
    }
    return found.volume;
  }

  async exportState(spec: IUnitSpec): Promise<StateArchive> {
    this.checkSpec(spec);
    const volume = await this.attempt(() => this.idleVolume(spec));
    return this.exportStream(spec, volume);
  }

  /** The helper exists only while the archive is read, and only once someone starts reading. */
  private async *exportStream(spec: IUnitSpec, volume: IEngineVolume): AsyncGenerator<Buffer> {
    let helper: Awaited<ReturnType<typeof createArchiveHelper>> | undefined;
    try {
      helper = await createArchiveHelper(this.engine, this.options.installId, {
        image: spec.image,
        volume: volume.Name,
        writable: false,
      });
      // The `/.` form names the directory's contents, so entries come as `./…` with no wrapper.
      const response = await this.engine.download('GET', `/containers/${helper.id}/archive`, {
        query: { path: `${STATE_PATH}/.` },
      });
      yield* fromEngineArchive(response);
    } catch (error) {
      if (error instanceof RuntimePortError || error instanceof TarError) throw error;
      throw new RuntimePortError('failed', errorMessage(error));
    } finally {
      await helper?.remove();
    }
  }

  async importState(spec: IUnitSpec, archive: StateArchive): Promise<void> {
    this.checkSpec(spec);
    await this.attempt(async () => {
      const volume = await this.idleVolume(spec);
      const { installId } = this.options;
      const name = objectName(installId, spec.account);
      // The volume is replaced, not merged into: an extraction only adds, so the old state goes
      // first. A stopped unit leaves no container using it, but an exited one may.
      await this.removeContainer(name);
      await this.engine.text('DELETE', `/volumes/${volume.Name}`);
      await this.engine.json('POST', '/volumes/create', { body: volumeBody(spec) });
      const helper = await createArchiveHelper(this.engine, installId, {
        image: spec.image,
        volume: volume.Name,
        writable: true,
      });
      try {
        await this.engine.upload(
          'PUT',
          `/containers/${helper.id}/archive`,
          toEngineArchive(archive),
          {
            query: { path: STATE_PATH },
          },
        );
      } finally {
        await helper.remove();
      }
    });
  }
}
