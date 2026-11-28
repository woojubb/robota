import { createHash, randomBytes } from 'node:crypto';

import { encodeEntry, readTar, TAR_TRAILER } from '../archive/tar.js';
import {
  type GuardState,
  type IAccessCode,
  type IRuntimeDescription,
  type IRuntimePort,
  type IUnitEndpoints,
  type IUnitSecrets,
  type IUnitSpec,
  type IUnitStatus,
  RuntimePortError,
  type StateArchive,
  type UnitRunState,
} from './port.js';

export type FakeStep =
  | 'describe'
  | 'resolveImage'
  | 'releaseImage'
  | 'provision'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'inspect'
  | 'list'
  | 'accessCode'
  | 'exportState'
  | 'importState'
  /** After the old state is gone and before the new one is complete. */
  | 'importStateWiped';

const ACCESS_CODE_FILE = 'server-access-code';
const GUI_PORT = 8360;
const WS_PORT = 8361;
const FIRST_HOST = 10;
const LAST_HOST = 254;

interface IFakeUnit {
  spec: IUnitSpec;
  state: UnitRunState;
  host: string;
  /** The state directory: relative path to file content, which is also where the access code lives. */
  files: Map<string, Buffer>;
  startedWithKey?: string;
}

/**
 * An in-memory runtime. Endpoints are documentation-range addresses so nothing can come to assume
 * loopback. It records which key started which unit and answers only whether a given key did.
 */
export class FakeRuntime implements IRuntimePort {
  private readonly units = new Map<string, IFakeUnit>();
  private readonly failures = new Map<FakeStep, Error[]>();
  private readonly images = new Map<string, string>();
  private readonly imageGenerations = new Map<string, number>();
  private guardState: GuardState = 'verified';
  private nextHost = FIRST_HOST;
  /** Every call as `step:account`, in order. */
  readonly calls: string[] = [];

  /** Makes the next call of a step throw once. */
  failNext(step: FakeStep, error: Error = new Error(`injected ${step} failure`)): void {
    const queue = this.failures.get(step) ?? [];
    queue.push(error);
    this.failures.set(step, queue);
  }

  /** Points a reference at a new image id, as rebuilding a tag does; returns the id. */
  rebuildImage(reference: string): string {
    const generation = (this.imageGenerations.get(reference) ?? 0) + 1;
    this.imageGenerations.set(reference, generation);
    const id = `sha256:${createHash('sha256').update(`${reference}#${generation}`).digest('hex')}`;
    this.images.set(reference, id);
    return id;
  }

  /** The image id a unit was last started from. */
  imageOf(account: string): string | undefined {
    return this.units.get(account)?.spec.image;
  }

  setGuard(state: GuardState): void {
    this.guardState = state;
  }

  /** A running unit exits on its own. */
  crash(account: string): void {
    const unit = this.units.get(account);
    if (unit?.state === 'running') unit.state = 'exited';
  }

  has(account: string): boolean {
    return this.units.has(account);
  }

  unitCount(): number {
    return this.units.size;
  }

  wasStartedWithKey(account: string, key: string): boolean {
    return this.units.get(account)?.startedWithKey === key;
  }

  private enter(step: FakeStep, account = ''): void {
    this.calls.push(`${step}:${account}`);
    const queue = this.failures.get(step);
    const error = queue?.shift();
    if (error) throw error;
  }

  private unit(account: string): IFakeUnit {
    const unit = this.units.get(account);
    if (!unit) throw new RuntimePortError('unknown-account', `No unit for account ${account}`);
    return unit;
  }

  private status(account: string, unit: IFakeUnit): IUnitStatus {
    const endpoints: IUnitEndpoints = { host: unit.host, guiPort: GUI_PORT, wsPort: WS_PORT };
    return {
      account,
      state: unit.state,
      healthy: unit.state === 'running',
      endpoints,
      imageId: unit.spec.image,
      keyConfigured: unit.startedWithKey !== undefined,
    };
  }

  async describe(): Promise<IRuntimeDescription> {
    this.enter('describe');
    return {
      backend: 'container',
      guard: { state: this.guardState },
      isolation: ['in-memory test double: no isolation'],
    };
  }

  async resolveImage(reference: string): Promise<string> {
    this.enter('resolveImage', reference);
    return this.images.get(reference) ?? this.rebuildImage(reference);
  }

  async releaseImage(imageId: string): Promise<void> {
    this.enter('releaseImage', imageId);
  }

  async provision(spec: IUnitSpec): Promise<IUnitStatus> {
    this.enter('provision', spec.account);
    let unit = this.units.get(spec.account);
    if (!unit) {
      if (this.nextHost > LAST_HOST)
        throw new RuntimePortError('failed', 'Fake address range is full');
      unit = {
        spec,
        state: 'provisioned',
        host: `198.51.100.${this.nextHost++}`,
        files: new Map(),
      };
      this.units.set(spec.account, unit);
    }
    return this.status(spec.account, unit);
  }

  async start(spec: IUnitSpec, secrets: IUnitSecrets): Promise<IUnitStatus> {
    this.enter('start', spec.account);
    const unit = this.unit(spec.account);
    if (this.guardState !== 'verified') {
      throw new RuntimePortError('guard-unverified', 'The network guard is not verified');
    }
    unit.spec = spec;
    unit.state = 'running';
    unit.startedWithKey = secrets.modelApiKey;
    if (!unit.files.has(ACCESS_CODE_FILE)) {
      unit.files.set(ACCESS_CODE_FILE, Buffer.from(randomBytes(12).toString('base64url')));
    }
    return this.status(spec.account, unit);
  }

  async stop(account: string): Promise<void> {
    this.enter('stop', account);
    const unit = this.unit(account);
    if (unit.state === 'running' || unit.state === 'exited') unit.state = 'stopped';
    unit.startedWithKey = undefined;
  }

  async destroy(account: string): Promise<void> {
    this.enter('destroy', account);
    this.units.delete(account);
  }

  async inspect(account: string): Promise<IUnitStatus> {
    this.enter('inspect', account);
    return this.status(account, this.unit(account));
  }

  async list(): Promise<IUnitStatus[]> {
    this.enter('list');
    return [...this.units.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([account, unit]) => this.status(account, unit));
  }

  async accessCode(spec: IUnitSpec): Promise<IAccessCode> {
    this.enter('accessCode', spec.account);
    const unit = this.unit(spec.account);
    const code = unit.files.get(ACCESS_CODE_FILE);
    if (!code) {
      throw new RuntimePortError('no-access-code', `Unit ${spec.account} has not started yet`);
    }
    return { code: code.toString('utf8') };
  }

  async exportState(spec: IUnitSpec): Promise<StateArchive> {
    this.enter('exportState', spec.account);
    const unit = this.unit(spec.account);
    if (unit.state === 'running') {
      throw new RuntimePortError('failed', `Unit ${spec.account} is running; stop it first`);
    }
    const files = [...unit.files.entries()].sort(([a], [b]) => a.localeCompare(b));
    return (async function* () {
      for (const [path, data] of files) {
        yield encodeEntry(
          {
            path,
            kind: 'file',
            flag: '0',
            mode: 0o600,
            uid: 1000,
            gid: 1000,
            size: data.length,
            mtime: 0,
            linkname: '',
          },
          data,
        );
      }
      yield TAR_TRAILER;
    })();
  }

  async importState(spec: IUnitSpec, archive: StateArchive): Promise<void> {
    this.enter('importState', spec.account);
    const unit = this.unit(spec.account);
    if (unit.state === 'running') {
      throw new RuntimePortError('failed', `Unit ${spec.account} is running; stop it first`);
    }
    unit.files = new Map();
    for await (const entry of readTar(archive)) {
      const chunks: Buffer[] = [];
      for await (const chunk of entry.body()) chunks.push(chunk);
      if (entry.header.kind === 'file') {
        unit.files.set(entry.header.path, Buffer.concat(chunks));
      } else if (entry.header.kind === 'hardlink') {
        const target = unit.files.get(entry.header.linkname);
        if (target) unit.files.set(entry.header.path, target);
      }
      this.enter('importStateWiped', spec.account);
    }
  }

  /** Writes a file into a unit's state, as the agent running in it would. */
  writeState(account: string, path: string, content: string): void {
    this.unit(account).files.set(path, Buffer.from(content));
  }

  readState(account: string, path: string): string | undefined {
    return this.units.get(account)?.files.get(path)?.toString('utf8');
  }

  stateFiles(account: string): string[] {
    return [...(this.units.get(account)?.files.keys() ?? [])].sort();
  }
}
