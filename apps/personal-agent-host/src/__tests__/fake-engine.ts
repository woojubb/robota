import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { cidrsOverlap } from '../runtime/container/names.js';
import { tempDir } from './harness.js';

interface IHostConfigBody {
  NetworkMode?: string;
  Mounts?: Array<{ Type?: string; Source?: string; Target?: string; ReadOnly?: boolean }>;
  [key: string]: unknown;
}

/** The parts of a create request the fake engine reads; everything else is carried untouched. */
export interface IEngineBody {
  Name?: string;
  Image?: string;
  Env?: string[];
  Entrypoint?: string[];
  Labels?: Record<string, string>;
  IPAM?: { Config?: Array<{ Subnet?: string; Gateway?: string }> };
  HostConfig?: IHostConfigBody;
  [key: string]: unknown;
}

type Json = IEngineBody;

interface IFakeVolume {
  Name: string;
  Labels: Record<string, string>;
  files: Map<string, string>;
}

interface IFakeNetwork {
  Id: string;
  Name: string;
  Labels: Record<string, string>;
  subnet: string;
  body: Json;
}

interface IFakeContainer {
  Id: string;
  name: string;
  body: Json;
  running: boolean;
  exitCode: number;
  polls: number;
  output: string;
}

export interface IRecordedRequest {
  method: string;
  path: string;
  body: Json | undefined;
}

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const ACCESS_CODE_PATH = '/state/server-access-code';

/**
 * A small engine behind a Unix socket: just the calls the container backend makes, with state held
 * in memory, every request recorded, and failures that can be injected per call.
 */
export class FakeEngine {
  readonly requests: IRecordedRequest[] = [];
  private readonly volumes = new Map<string, IFakeVolume>();
  private readonly networks = new Map<string, IFakeNetwork>();
  private readonly containers = new Map<string, IFakeContainer>();
  private readonly failures: Array<{ match: RegExp; status: number; message: string }> = [];
  private server!: Server;
  socketPath!: string;
  apiVersion = '1.52';
  minApiVersion = '1.24';
  /** Rules last applied by the guard helper; undefined while no table exists. */
  guardRules: string | undefined;
  /** Makes the apply helper exit with this code and the message as its output. */
  guardApplyFailure: { code: number; output: string } | undefined;
  /** Routes of the engine host as `/proc/net/route` shows them; the default route is always there. */
  hostRoutes: Array<{ iface: string; cidr: string }> = [];
  /** Reading the routes fails with this exit code. */
  routesFailure: number | undefined;
  resolvConf = 'nameserver 192.0.2.53\nnameserver 127.0.0.11\nnameserver 192.0.2.54\n';
  /** Polls of a started unit's inspect before it reports healthy; Infinity never. */
  healthyAfterPolls = 1;
  /** Starting a unit leaves it exited with this code when set. */
  startExit: number | undefined;
  /** Images the engine knows by name; empty accepts any. */
  images = new Set<string>();
  /** Retaining references the control plane has put on images, as `repo:tag`. */
  retained = new Set<string>();
  /** The id each image name currently resolves to; a name not listed gets a derived one. */
  imageIds = new Map<string, string>();

  /** The id a name resolves to. */
  imageIdOf(name: string): string {
    return this.imageIds.get(name) ?? `sha256:${createHash('sha256').update(name).digest('hex')}`;
  }

  async listen(): Promise<void> {
    const dir = await tempDir();
    this.socketPath = `${dir}/engine.sock`;
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(this.socketPath, resolve));
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  get endpoint(): string {
    return `unix://${this.socketPath}`;
  }

  /** The next call matching `METHOD /path` (container ids shown as names, `name=` for a create) fails once. */
  failNext(match: RegExp, status = 500, message = 'injected engine failure'): void {
    this.failures.push({ match, status, message });
  }

  hasObjects(): boolean {
    return this.volumes.size + this.networks.size + this.containers.size > 0;
  }

  containerNames(): string[] {
    return [...this.containers.values()].map((c) => c.name);
  }

  volumeNames(): string[] {
    return [...this.volumes.keys()];
  }

  networkNames(): string[] {
    return [...this.networks.keys()];
  }

  container(name: string): Json | undefined {
    return this.find(name)?.body;
  }

  network(name: string): Json | undefined {
    return this.networks.get(name)?.body;
  }

  volume(name: string): Json | undefined {
    return this.volumes.get(name)?.Labels;
  }

  /** Every request body, serialized: the text secrets must never appear in outside the unit's environment. */
  recordedBodies(): string {
    return JSON.stringify(this.requests.map((r) => r.body ?? null));
  }

  /** The guard table disappears, as when another firewall manager flushes the ruleset. */
  flushGuard(): void {
    this.guardRules = undefined;
  }

  /** Something else edits the guard table. */
  tamperGuard(): void {
    if (this.guardRules !== undefined) this.guardRules += '\n# edited\n';
  }

  /** A unit exits on its own. */
  crash(name: string, exitCode = 1): void {
    const container = this.find(name);
    if (container) {
      container.running = false;
      container.exitCode = exitCode;
    }
  }

  private find(idOrName: string): IFakeContainer | undefined {
    return (
      this.containers.get(idOrName) ??
      [...this.containers.values()].find((c) => c.name === idOrName || c.Id.startsWith(idOrName))
    );
  }

  private labelFilter(url: URL): Array<[string, string]> {
    const raw = url.searchParams.get('filters');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { label?: string[] };
    return (parsed.label ?? []).map((entry) => {
      const [key, ...rest] = entry.split('=');
      return [key, rest.join('=')];
    });
  }

  private matches(labels: Record<string, string>, filter: Array<[string, string]>): boolean {
    return filter.every(([key, value]) => labels[key] === value);
  }

  private async body(req: IncomingMessage): Promise<Json | undefined> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    return text === '' ? undefined : (JSON.parse(text) as Json);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://engine');
    const method = req.method ?? 'GET';
    const path = url.pathname.replace(/^\/v\d+\.\d+/u, '');
    const body = await this.body(req);
    this.requests.push({ method, path, body });
    const send = (status: number, payload?: unknown, raw = false): void => {
      res.writeHead(status, { 'content-type': raw ? 'text/plain' : 'application/json' });
      res.end(payload === undefined ? '' : raw ? String(payload) : JSON.stringify(payload));
    };
    try {
      // Failures match on names, not engine ids, so a test can aim at one unit's container.
      const named = path.replace(/\/containers\/([0-9a-f]{64})/u, (whole, id: string) =>
        this.containers.has(id) ? `/containers/${this.containers.get(id)?.name}` : whole,
      );
      const queryName = url.searchParams.get('name');
      const label = `${method} ${named}${queryName ? ` name=${queryName}` : ''}`;
      const failure = this.failures.findIndex((f) => f.match.test(label));
      if (failure >= 0) {
        const [hit] = this.failures.splice(failure, 1);
        throw new Refusal(hit.status, hit.message);
      }
      await this.route(method, path, url, body, send);
    } catch (error) {
      if (error instanceof Refusal) send(error.status, { message: error.message });
      else send(500, { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private async route(
    method: string,
    path: string,
    url: URL,
    body: Json | undefined,
    send: (status: number, payload?: unknown, raw?: boolean) => void,
  ): Promise<void> {
    const is = (m: string, pattern: RegExp): RegExpExecArray | null =>
      method === m ? pattern.exec(path) : null;
    let match: RegExpExecArray | null;

    if (is('GET', /^\/version$/u)) {
      return send(200, { ApiVersion: this.apiVersion, MinAPIVersion: this.minApiVersion });
    }

    // ---- images ----
    if ((match = is('GET', /^\/images\/(.+)\/json$/u))) {
      const name = decodeURIComponent(match[1]);
      if (this.images.size > 0 && !this.images.has(name)) {
        throw new Refusal(404, `No such image: ${name}`);
      }
      return send(200, { Id: this.imageIdOf(name) });
    }

    if ((match = is('POST', /^\/images\/(.+)\/tag$/u))) {
      const id = decodeURIComponent(match[1]);
      if (
        this.images.size > 0 &&
        !this.images.has(id) &&
        ![...this.images].some((n) => this.imageIdOf(n) === id)
      ) {
        throw new Refusal(404, `No such image: ${id}`);
      }
      this.retained.add(`${url.searchParams.get('repo')}:${url.searchParams.get('tag')}`);
      return send(201);
    }
    if ((match = is('DELETE', /^\/images\/(.+)$/u))) {
      const name = decodeURIComponent(match[1]);
      if (!this.retained.delete(name)) throw new Refusal(404, `No such image: ${name}`);
      return send(200, []);
    }

    // ---- volumes ----
    if (is('POST', /^\/volumes\/create$/u)) {
      const name = String(body?.Name);
      const volume = this.volumes.get(name) ?? {
        Name: name,
        Labels: (body?.Labels ?? {}) as Record<string, string>,
        files: new Map<string, string>(),
      };
      this.volumes.set(name, volume);
      return send(201, { Name: volume.Name, Labels: volume.Labels });
    }
    if ((match = is('GET', /^\/volumes\/([^/]+)$/u))) {
      const volume = this.volumes.get(match[1]);
      if (!volume) throw new Refusal(404, `get ${match[1]}: no such volume`);
      return send(200, { Name: volume.Name, Labels: volume.Labels });
    }
    if (is('GET', /^\/volumes$/u)) {
      const filter = this.labelFilter(url);
      const Volumes = [...this.volumes.values()]
        .filter((v) => this.matches(v.Labels, filter))
        .map((v) => ({ Name: v.Name, Labels: v.Labels }));
      return send(200, { Volumes: Volumes.length > 0 ? Volumes : null });
    }
    if ((match = is('DELETE', /^\/volumes\/([^/]+)$/u))) {
      if (!this.volumes.has(match[1])) throw new Refusal(404, `get ${match[1]}: no such volume`);
      const inUse = [...this.containers.values()].some((c) =>
        JSON.stringify(c.body).includes(`"Source":"${match?.[1]}"`),
      );
      if (inUse) throw new Refusal(409, 'volume is in use');
      this.volumes.delete(match[1]);
      return send(204);
    }

    // ---- networks ----
    if (is('POST', /^\/networks\/create$/u)) {
      const name = String(body?.Name);
      if (this.networks.has(name))
        throw new Refusal(409, `network with name ${name} already exists`);
      const subnet = String(body?.IPAM?.Config?.[0]?.Subnet);
      for (const other of this.networks.values()) {
        if (cidrsOverlap(other.subnet, subnet)) {
          throw new Refusal(
            403,
            'invalid pool request: Pool overlaps with other one on this address space',
          );
        }
      }
      const network = {
        Id: randomBytes(16).toString('hex'),
        Name: name,
        Labels: (body?.Labels ?? {}) as Record<string, string>,
        subnet,
        body: body ?? {},
      };
      this.networks.set(name, network);
      return send(201, { Id: network.Id });
    }
    if ((match = is('GET', /^\/networks\/([^/]+)$/u))) {
      const network = this.networks.get(match[1]);
      if (!network) throw new Refusal(404, `network ${match[1]} not found`);
      return send(200, this.networkView(network));
    }
    if (is('GET', /^\/networks$/u)) {
      const filter = this.labelFilter(url);
      return send(
        200,
        [...this.networks.values()]
          .filter((n) => this.matches(n.Labels, filter))
          .map((n) => this.networkView(n)),
      );
    }
    if ((match = is('DELETE', /^\/networks\/([^/]+)$/u))) {
      const network = this.networks.get(match[1]);
      if (!network) throw new Refusal(404, `network ${match[1]} not found`);
      const active = [...this.containers.values()].some(
        (c) => c.body.HostConfig?.NetworkMode === network.Name,
      );
      if (active) throw new Refusal(403, 'network has active endpoints');
      this.networks.delete(match[1]);
      return send(204);
    }

    // ---- containers ----
    if (is('POST', /^\/containers\/create$/u)) {
      const name = url.searchParams.get('name') ?? `anon-${randomBytes(4).toString('hex')}`;
      if (this.find(name))
        throw new Refusal(409, `Conflict. The container name "${name}" is already in use`);
      const image = String(body?.Image);
      const known =
        this.images.has(image) || [...this.images].some((n) => this.imageIdOf(n) === image);
      if (this.images.size > 0 && !known) throw new Refusal(404, `No such image: ${image}`);
      const container: IFakeContainer = {
        Id: randomBytes(32).toString('hex'),
        name,
        body: body ?? {},
        running: false,
        exitCode: 0,
        polls: 0,
        output: '',
      };
      this.containers.set(container.Id, container);
      return send(201, { Id: container.Id });
    }
    if ((match = is('POST', /^\/containers\/([^/]+)\/start$/u))) {
      const container = this.need(match[1]);
      this.startContainer(container);
      return send(204);
    }
    if ((match = is('POST', /^\/containers\/([^/]+)\/stop$/u))) {
      const container = this.need(match[1]);
      if (!container.running) return send(304);
      container.running = false;
      return send(204);
    }
    if ((match = is('POST', /^\/containers\/([^/]+)\/wait$/u))) {
      const container = this.need(match[1]);
      return send(200, { StatusCode: container.exitCode });
    }
    if ((match = is('GET', /^\/containers\/([^/]+)\/logs$/u))) {
      return send(200, this.need(match[1]).output, true);
    }
    if ((match = is('GET', /^\/containers\/([^/]+)\/json$/u))) {
      return send(200, this.containerView(this.need(match[1])));
    }
    if ((match = is('DELETE', /^\/containers\/([^/]+)$/u))) {
      const container = this.need(match[1]);
      this.containers.delete(container.Id);
      return send(204);
    }
    if (is('GET', /^\/containers\/json$/u)) {
      const filter = this.labelFilter(url);
      const rows = [...this.containers.values()]
        .filter((c) => this.matches((c.body.Labels ?? {}) as Record<string, string>, filter))
        .map((c) => ({ Id: c.Id, Names: [`/${c.name}`], Labels: c.body.Labels ?? {} }));
      return send(200, rows.length > 0 ? rows : null);
    }
    throw new Refusal(404, `page not found: ${method} ${path}`);
  }

  private need(idOrName: string): IFakeContainer {
    const container = this.find(idOrName);
    if (!container) throw new Refusal(404, `No such container: ${idOrName}`);
    return container;
  }

  private networkView(network: IFakeNetwork): Json {
    return {
      Id: network.Id,
      Name: network.Name,
      Labels: network.Labels,
      IPAM: { Config: [{ Subnet: network.subnet }] },
    };
  }

  private containerView(container: IFakeContainer): Json {
    container.polls += 1;
    const healthy = container.running && container.polls > this.healthyAfterPolls;
    const status = container.running
      ? 'running'
      : container.exitCode === 0 && container.output === ''
        ? 'created'
        : 'exited';
    return {
      Id: container.Id,
      Name: `/${container.name}`,
      State: {
        Status: status,
        Running: container.running,
        ExitCode: container.exitCode,
        Health: { Status: healthy ? 'healthy' : 'starting' },
      },
      Config: { Env: container.body.Env ?? [], Labels: container.body.Labels ?? {} },
    };
  }

  private startContainer(container: IFakeContainer): void {
    const labels = (container.body.Labels ?? {}) as Record<string, string>;
    if (labels['robota.personal-agent-host.kind'] === 'helper') {
      this.runHelper(container);
      return;
    }
    container.output = 'started';
    if (this.startExit !== undefined) {
      container.running = false;
      container.exitCode = this.startExit;
      return;
    }
    container.running = true;
    container.polls = 0;
    const source = String(container.body.HostConfig?.Mounts?.[0]?.Source);
    const volume = this.volumes.get(source);
    if (volume && !volume.files.has('server-access-code')) {
      volume.files.set('server-access-code', randomBytes(32).toString('base64url'));
    }
  }

  private runHelper(container: IFakeContainer): void {
    const entry = (container.body.Entrypoint ?? []) as string[];
    const finish = (exitCode: number, output: string): void => {
      container.exitCode = exitCode;
      container.output = output;
      container.running = false;
    };
    const joined = entry.join(' ');
    if (joined.startsWith('nft list table')) {
      return this.guardRules === undefined
        ? finish(1, 'Error: No such file or directory')
        : finish(0, this.listing());
    }
    if (joined.includes('nft -f')) {
      if (this.guardApplyFailure)
        return finish(this.guardApplyFailure.code, this.guardApplyFailure.output);
      const env = (container.body.Env ?? []) as string[];
      this.guardRules =
        env.find((e) => e.startsWith('GUARD_RULES='))?.slice('GUARD_RULES='.length) ?? '';
      return finish(0, this.listing());
    }
    if (joined === 'cat /proc/net/route') {
      if (this.routesFailure !== undefined) return finish(this.routesFailure, 'cat: error');
      return finish(0, this.routeTable());
    }
    if (joined === 'cat /etc/resolv.conf') return finish(0, this.resolvConf);
    if (joined === `cat ${ACCESS_CODE_PATH}`) {
      const source = String(container.body.HostConfig?.Mounts?.[0]?.Source);
      const code = this.volumes.get(source)?.files.get('server-access-code');
      return code === undefined
        ? finish(1, 'cat: No such file or directory')
        : finish(0, `${code}\n`);
    }
    finish(127, `unknown helper: ${joined}`);
  }

  private routeTable(): string {
    const hex = (value: number): string =>
      value.toString(16).padStart(8, '0').match(/../gu)!.reverse().join('').toUpperCase();
    const row = (iface: string, destination: number, mask: number): string =>
      `${iface}\t${hex(destination)}\t00000000\t0001\t0\t0\t0\t${hex(mask)}\t0\t0\t0`;
    const rows = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      row('eth0', 0, 0),
    ];
    for (const { iface, cidr } of this.hostRoutes) {
      const [base, bits] = cidr.split('/');
      const destination = base.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
      rows.push(row(iface, destination, (2 ** 32 - 2 ** (32 - Number(bits))) >>> 0));
    }
    return `${rows.join('\n')}\n`;
  }

  private listing(): string {
    return `table inet fake {\n${this.guardRules ?? ''}\n}\n`;
  }
}
