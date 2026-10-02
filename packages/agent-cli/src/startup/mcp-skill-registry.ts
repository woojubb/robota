import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { decodeFrontmatterJson } from '@robota-sdk/agent-framework';
import type {
  IMCPSkillEntry,
  IMCPSkillsSession,
  IMCPVerifiedSkillResource,
} from '@robota-sdk/agent-mcp';
import type { TCommandInvocationSource } from '@robota-sdk/agent-interface-command';

export interface IMcpSkillHostSource {
  readonly serverId: string;
  /** Host identity including the admitted definition, provenance and workspace; never a peer-provided label. */
  readonly securityIdentity: string;
  readonly skills: IMCPSkillsSession;
  isCurrent(): boolean | Promise<boolean>;
}

export interface IMcpSkillApproval {
  readonly scope: string;
  readonly namespace: string;
  readonly serverId: string;
  readonly uri: string;
  readonly fingerprint: string;
}

export interface IMcpSkillApprovalStore {
  list(): readonly IMcpSkillApproval[];
  put(approval: IMcpSkillApproval): void;
  remove(namespace: string): void;
}

export function createMemoryMcpSkillApprovalStore(): IMcpSkillApprovalStore {
  const approvals = new Map<string, IMcpSkillApproval>();
  return {
    list: () => [...approvals.values()],
    put: (value) => {
      approvals.set(value.namespace, { ...value });
    },
    remove: (namespace) => {
      approvals.delete(namespace);
    },
  };
}

export class McpSkillActivationError extends Error {
  constructor(
    readonly reason:
      | 'user-only'
      | 'unavailable'
      | 'source-changed'
      | 'invalid-frontmatter'
      | 'frontmatter-mismatch'
      | 'approval-required'
      | 'content-changed'
      | 'activation-ended',
  ) {
    super(
      `MCP skill activation refused: ${reason}${reason === 'approval-required' ? '. Ask the user to run /mcp skill-inspect <server> <uri>, then approve its reviewed fingerprint.' : ''}`,
    );
    this.name = 'McpSkillActivationError';
  }
}

export interface IMcpSkillPreview {
  readonly serverId: string;
  readonly namespace: string;
  readonly fingerprint: string;
  readonly entry: IMCPSkillEntry;
  readonly body: string;
  readonly content: string;
}

export interface IMcpSkillMetadata {
  readonly serverId: string;
  readonly namespace: string;
  readonly fingerprint: string;
  readonly entry: IMCPSkillEntry;
}

export interface IMcpActiveSkill extends IMcpSkillPreview {
  validate(): Promise<void>;
  /** Supporting files remain ordinary verified bytes, including a nested SKILL.md. */
  read(uri: string, signal?: AbortSignal): Promise<IMCPVerifiedSkillResource>;
  close(): void;
}

/** A reversible virtual namespace bound to both host origin and URI; never a filesystem or network destination. */
function namespaceFor(source: IMcpSkillHostSource, uri: string, scope: string): string {
  return `mcp-skill:${Buffer.from(JSON.stringify([source.serverId, source.securityIdentity, uri, scope])).toString('base64url')}`;
}

function contentFingerprint(namespace: string, entry: IMCPSkillEntry): string {
  return createHash('sha256')
    .update(JSON.stringify([namespace, entry.manifestFingerprint]))
    .digest('hex');
}

function markdown(resource: IMCPVerifiedSkillResource): string {
  if (resource.text !== undefined) return resource.text;
  if (resource.blob === undefined) throw new McpSkillActivationError('invalid-frontmatter');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(resource.blob, 'base64'));
  } catch {
    throw new McpSkillActivationError('invalid-frontmatter');
  }
}

/** The host's consent gate, separate from protocol, server admission and the session's activation lifecycle. */
export class McpSkillRegistry {
  private readonly revisions = new Map<string, number>();
  private readonly catalog = new Map<string, readonly IMcpSkillMetadata[]>();

  /** Metadata only; no instruction bytes or activation authority are retained here. */
  listMetadata(): readonly IMcpSkillMetadata[] {
    return [...this.catalog.values()].flat();
  }

  private key(serverId: string, uri: string): string {
    return JSON.stringify([serverId, uri]);
  }
  private advance(serverId: string, uri: string): number {
    const key = this.key(serverId, uri);
    const next = (this.revisions.get(key) ?? 0) + 1;
    this.revisions.set(key, next);
    return next;
  }

  private advanceServer(serverId: string): void {
    for (const [key, revision] of this.revisions)
      if ((JSON.parse(key) as string[])[0] === serverId) this.revisions.set(key, revision + 1);
  }
  constructor(
    private readonly resolveSource: (serverId: string) => Promise<IMcpSkillHostSource | undefined>,
    private readonly approvals: IMcpSkillApprovalStore = createMemoryMcpSkillApprovalStore(),
    private readonly scope: string = 'user',
  ) {}

  private revoke(serverId: string, uri: string): void {
    for (const record of this.approvals.list())
      if (record.scope === this.scope && record.serverId === serverId && record.uri === uri)
        this.approvals.remove(record.namespace);
  }

  private async source(serverId: string, signal?: AbortSignal): Promise<IMcpSkillHostSource> {
    signal?.throwIfAborted();
    const source = await this.resolveSource(serverId);
    signal?.throwIfAborted();
    if (!source || source.serverId !== serverId) throw new McpSkillActivationError('unavailable');
    if (!(await source.isCurrent())) throw new McpSkillActivationError('source-changed');
    return source;
  }

  /** Discovery discloses metadata only and grants no instruction or supporting-file activation. */
  async list(
    serverId: string,
    maxPages: number,
    signal?: AbortSignal,
  ): Promise<readonly IMCPSkillEntry[]> {
    return (await this.refreshMetadata(serverId, maxPages, signal)).map(
      (metadata) => metadata.entry,
    );
  }

  async refreshMetadata(
    serverId: string,
    maxPages: number,
    signal?: AbortSignal,
  ): Promise<readonly IMcpSkillMetadata[]> {
    let source: IMcpSkillHostSource;
    let entries: readonly IMCPSkillEntry[];
    try {
      source = await this.source(serverId, signal);
      entries = await source.skills.list({ maxPages, signal });
      if (!(await source.isCurrent())) throw new McpSkillActivationError('source-changed');
    } catch (error) {
      if (!signal?.aborted) {
        this.catalog.delete(serverId);
        this.advanceServer(serverId);
        for (const record of this.approvals.list())
          if (record.scope === this.scope && record.serverId === serverId)
            this.approvals.remove(record.namespace);
      }
      throw error;
    }
    this.advanceServer(serverId);
    for (const entry of entries) {
      this.advance(serverId, entry.uri);
      const namespace = namespaceFor(source, entry.uri, this.scope);
      const fingerprint = contentFingerprint(namespace, entry);
      for (const record of this.approvals.list())
        if (
          record.scope === this.scope &&
          record.serverId === serverId &&
          record.uri === entry.uri &&
          (record.namespace !== namespace || record.fingerprint !== fingerprint)
        )
          this.approvals.remove(record.namespace);
    }
    for (const record of this.approvals.list())
      if (
        record.scope === this.scope &&
        record.serverId === serverId &&
        !entries.some((entry) => entry.uri === record.uri)
      ) {
        this.advance(serverId, record.uri);
        this.approvals.remove(record.namespace);
      }
    const metadata = entries.map((entry) => {
      const namespace = namespaceFor(source, entry.uri, this.scope);
      return { serverId, namespace, fingerprint: contentFingerprint(namespace, entry), entry };
    });
    this.catalog.set(serverId, metadata);
    return metadata;
  }

  /** Prepare the exact content a person may approve; no instructions or frontmatter take effect. */
  async inspect(serverId: string, uri: string, signal?: AbortSignal): Promise<IMcpSkillPreview> {
    const revision = this.advance(serverId, uri);
    try {
      const source = await this.source(serverId, signal);
      const entry = await source.skills.get(uri, { signal });
      if (entry.identity.serverId !== serverId) throw new McpSkillActivationError('source-changed');
      const content = markdown(await source.skills.read(entry, uri, { signal }));
      const decoded = decodeFrontmatterJson(uri, content);
      if (!decoded?.ok) throw new McpSkillActivationError('invalid-frontmatter');
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(decoded.frontmatter)), entry.frontmatter))
        throw new McpSkillActivationError('frontmatter-mismatch');
      if (!(await source.isCurrent())) throw new McpSkillActivationError('source-changed');
      if (this.revisions.get(this.key(serverId, uri)) !== revision)
        throw new McpSkillActivationError('content-changed');
      const namespace = namespaceFor(source, uri, this.scope);
      const fingerprint = contentFingerprint(namespace, entry);
      // Observing changed content withdraws approval permanently, including if the server later reverts it.
      for (const record of this.approvals.list())
        if (
          record.serverId === serverId &&
          record.scope === this.scope &&
          record.uri === uri &&
          (record.namespace !== namespace || record.fingerprint !== fingerprint)
        )
          this.approvals.remove(record.namespace);
      return { serverId, namespace, fingerprint, entry, body: decoded.body, content };
    } catch (error) {
      if (this.revisions.get(this.key(serverId, uri)) === revision) this.revoke(serverId, uri);
      throw error;
    }
  }

  /** The reviewed content hash is mandatory; a model or unknown caller cannot grant consent. */
  async approve(
    serverId: string,
    uri: string,
    fingerprint: string,
    source: TCommandInvocationSource | undefined,
  ): Promise<IMcpSkillPreview> {
    if (source !== 'user') throw new McpSkillActivationError('user-only');
    const preview = await this.inspect(serverId, uri);
    if (preview.fingerprint !== fingerprint) throw new McpSkillActivationError('content-changed');
    this.approvals.put({
      scope: this.scope,
      namespace: preview.namespace,
      serverId,
      uri,
      fingerprint,
    });
    return preview;
  }

  withdraw(serverId: string, uri: string, source: TCommandInvocationSource | undefined): void {
    if (source !== 'user') throw new McpSkillActivationError('user-only');
    this.advance(serverId, uri);
    this.revoke(serverId, uri);
  }

  private requireApproval(preview: IMcpSkillPreview): void {
    if (
      !this.approvals
        .list()
        .some(
          (record) =>
            record.namespace === preview.namespace &&
            record.scope === this.scope &&
            record.serverId === preview.serverId &&
            record.uri === preview.entry.uri &&
            record.fingerprint === preview.fingerprint,
        )
    )
      throw new McpSkillActivationError('approval-required');
  }

  /** Acquire verified instructions only under exact prior consent; the session must close its active window. */
  async activate(serverId: string, uri: string, signal?: AbortSignal): Promise<IMcpActiveSkill> {
    const preview = await this.inspect(serverId, uri, signal);
    this.requireApproval(preview);
    let closed = false;
    const stop = new AbortController();
    const activationSignal = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    const checkLocal = (signal: AbortSignal): void => {
      if (closed) throw new McpSkillActivationError('activation-ended');
      signal.throwIfAborted();
      this.requireApproval(preview);
    };
    const currentManifest = async (signal: AbortSignal) => {
      checkLocal(signal);
      const source = await this.source(serverId, signal);
      if (namespaceFor(source, uri, this.scope) !== preview.namespace)
        throw new McpSkillActivationError('source-changed');
      const current = await source.skills.get(uri, { signal });
      if (current.identity.serverId !== serverId)
        throw new McpSkillActivationError('source-changed');
      if (current.identity.catalogGeneration !== preview.entry.identity.catalogGeneration)
        throw new McpSkillActivationError('activation-ended');
      if (contentFingerprint(preview.namespace, current) !== preview.fingerprint)
        throw new McpSkillActivationError('content-changed');
      checkLocal(signal);
      return { source, current };
    };
    const fail = (error: unknown, signal: AbortSignal): never => {
      const cancelled = signal.aborted;
      closed = true;
      stop.abort();
      if (
        !cancelled &&
        !(error instanceof McpSkillActivationError && error.reason === 'activation-ended')
      )
        this.revoke(serverId, uri);
      throw error;
    };
    return {
      ...preview,
      close: () => {
        closed = true;
        stop.abort();
      },
      validate: async () => {
        try {
          const { source } = await currentManifest(activationSignal);
          if (!(await source.isCurrent())) throw new McpSkillActivationError('source-changed');
          checkLocal(activationSignal);
        } catch (error) {
          fail(error, activationSignal);
        }
      },
      read: async (fileUri, signal) => {
        const readSignal = signal ? AbortSignal.any([signal, activationSignal]) : activationSignal;
        if (closed) throw new McpSkillActivationError('activation-ended');
        try {
          const { source, current } = await currentManifest(readSignal);
          const resource = await source.skills.read(current, fileUri, { signal: readSignal });
          if (closed) throw new McpSkillActivationError('activation-ended');
          this.requireApproval(preview);
          if (!(await source.isCurrent())) throw new McpSkillActivationError('source-changed');
          checkLocal(readSignal);
          return resource;
        } catch (error) {
          return fail(error, readSignal);
        }
      },
    };
  }
}
