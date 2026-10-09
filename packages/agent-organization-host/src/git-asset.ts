import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { organizationCanonical } from './canonical.js';
import { OrganizationRefused } from './types.js';
import { integer, record } from './verification.js';

export interface IOrganizationGitIntent {
  readonly asset: string;
  readonly digest: string;
  readonly expectedRevision: number;
  readonly fence: number;
  readonly expectedOid: string;
  readonly candidateOid: string;
  readonly publishedOid: string;
}

export interface IOrganizationGitAssetOptions {
  /** Owner-provisioned private bare repository; workers must not mount or write this directory. */
  readonly path: string;
  readonly ref: string;
  /** Absolute owner-pinned executable. No worker parameters reach the command or environment. */
  readonly gitPath: string;
  /** Aggregate subprocess deadline per phase, not a physical worker/OS containment guarantee. */
  readonly phaseTimeoutMs?: number;
}

export function gitOid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value) ||
    /^0+$/.test(value)
  )
    throw new OrganizationRefused('invalid-schema');
  return value;
}

export function gitParameters(value: unknown): {
  expectedRevision: number;
  fence: number;
  expectedOid: string;
  candidateOid: string;
} {
  const params = record(value, ['expectedRevision', 'fence', 'expectedOid', 'candidateOid']);
  return {
    expectedRevision: integer(params.expectedRevision),
    fence: integer(params.fence, 1),
    expectedOid: gitOid(params.expectedOid),
    candidateOid: gitOid(params.candidateOid),
  };
}

/** Trusted asset-owner plumbing only. This class never clones/fetches, checks out, merges or runs user code. */
export class OrganizationGitAsset {
  readonly identity: string;
  readonly phaseTimeoutMs: number;
  private readonly path: string;
  private readonly ino: number;
  private readonly dev: number;
  private readonly ref: string;
  private readonly gitPath: string;

  constructor(options: IOrganizationGitAssetOptions) {
    if (
      !isAbsolute(options.path) ||
      !isAbsolute(options.gitPath) ||
      !/^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9/_-]{0,120}$/.test(options.ref) ||
      options.ref.endsWith('/') ||
      options.ref.includes('//')
    )
      throw new OrganizationRefused('invalid-schema');
    this.path = realpathSync(options.path);
    const root = lstatSync(this.path);
    this.ino = root.ino;
    this.dev = root.dev;
    this.ref = options.ref;
    this.gitPath = realpathSync(options.gitPath);
    this.phaseTimeoutMs = integer(options.phaseTimeoutMs ?? 1000, 1);
    if (this.phaseTimeoutMs > 1000) throw new OrganizationRefused('invalid-schema');
    this.identity = createHash('sha256')
      .update(organizationCanonical([this.path, this.dev, this.ino, this.ref]))
      .digest('hex');
    this.phase((run) => {
      if (run(['rev-parse', '--is-bare-repository']) !== 'true')
        throw new OrganizationRefused('policy-unavailable');
      this.tip(run);
    });
  }

  private verify(): void {
    try {
      const root = lstatSync(this.path);
      const uid = process.getuid?.();
      if (
        !root.isDirectory() ||
        root.ino !== this.ino ||
        root.dev !== this.dev ||
        (root.mode & 0o077) !== 0 ||
        (uid !== undefined && uid !== root.uid)
      )
        throw new Error('changed asset');
    } catch {
      throw new OrganizationRefused('policy-unavailable');
    }
  }

  private phase<T>(action: (run: (args: readonly string[], input?: string) => string) => T): T {
    const start = performance.now();
    const run = (args: readonly string[], input?: string): string => {
      this.verify();
      const remaining = this.phaseTimeoutMs - Math.ceil(performance.now() - start);
      if (remaining <= 0) throw new OrganizationRefused('outcome-unknown');
      try {
        return execFileSync(
          this.gitPath,
          [
            '--git-dir',
            this.path,
            '-c',
            'core.hooksPath=/dev/null',
            '-c',
            'core.fsmonitor=false',
            '-c',
            'gc.auto=0',
            '-c',
            'commit.gpgSign=false',
            '-c',
            'core.commitGraph=false',
            ...args,
          ],
          {
            input,
            encoding: 'utf8',
            timeout: remaining,
            killSignal: 'SIGKILL',
            maxBuffer: 64 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: {
              GIT_CONFIG_NOSYSTEM: '1',
              GIT_CONFIG_GLOBAL: '/dev/null',
              GIT_NO_REPLACE_OBJECTS: '1',
              GIT_GRAFT_FILE: '/dev/null',
              GIT_TERMINAL_PROMPT: '0',
              GIT_ATTR_NOSYSTEM: '1',
              GIT_AUTHOR_NAME: 'Organization publication',
              GIT_AUTHOR_EMAIL: 'broker@example.invalid',
              GIT_COMMITTER_NAME: 'Organization publication',
              GIT_COMMITTER_EMAIL: 'broker@example.invalid',
              GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
              GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
            },
          },
        ).trim();
      } catch (error) {
        if (
          args[0] === 'merge-base' &&
          typeof error === 'object' &&
          error !== null &&
          'status' in error &&
          error.status === 1
        )
          return '';
        // Output may contain repository content or paths. No raw Git stderr crosses the worker ingress.
        throw new OrganizationRefused('outcome-unknown');
      }
    };
    return action(run);
  }

  private tip(run: (args: readonly string[]) => string): string {
    // show-ref cannot silently dereference an unexpected symbolic branch into another target for publication.
    const raw = run(['for-each-ref', '--format=%(symref)', this.ref]);
    if (raw !== '') throw new OrganizationRefused('operation-conflict');
    return gitOid(run(['show-ref', '--verify', '--hash', this.ref]));
  }

  prepare(digest: string, parameters: ReturnType<typeof gitParameters>): IOrganizationGitIntent {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new OrganizationRefused('invalid-schema');
    const params = gitParameters(parameters);
    return this.phase((run) => {
      if (this.tip(run) !== params.expectedOid || params.expectedOid === params.candidateOid)
        throw new OrganizationRefused('operation-conflict');
      if (run(['cat-file', '-t', params.candidateOid]) !== 'commit')
        throw new OrganizationRefused('operation-conflict');
      const base = run(['merge-base', params.expectedOid, params.candidateOid]);
      if (base !== params.expectedOid) throw new OrganizationRefused('operation-conflict');
      const tree = gitOid(run(['rev-parse', '--verify', `${params.candidateOid}^{tree}`]));
      // The unpredictable owner receipt is persisted in the journal before its ref can become public.
      const message = organizationCanonical({
        domain: 'organization-git-publication-v1',
        asset: this.identity,
        digest,
        ...params,
        nonce: randomUUID(),
      });
      const publishedOid = gitOid(
        run(['commit-tree', '--no-gpg-sign', tree, '-p', params.candidateOid], `${message}\n`),
      );
      return Object.freeze({ asset: this.identity, digest, ...params, publishedOid });
    });
  }

  publish(intent: IOrganizationGitIntent): void {
    if (intent.asset !== this.identity) throw new OrganizationRefused('operation-conflict');
    const expected = gitOid(intent.expectedOid);
    const published = gitOid(intent.publishedOid);
    this.phase((run) => {
      if (this.tip(run) !== expected) throw new OrganizationRefused('operation-conflict');
      // One exact old-OID CAS. No force update, deletion or second evidence ref.
      run(['update-ref', '--no-deref', this.ref, published, expected]);
    });
  }

  wasPublished(intent: IOrganizationGitIntent): boolean {
    if (intent.asset !== this.identity) throw new OrganizationRefused('operation-conflict');
    return this.phase((run) => {
      const tip = this.tip(run);
      // An unreferenced receipt object is only an intent, never evidence that the branch changed.
      return run(['merge-base', gitOid(intent.publishedOid), tip]) === intent.publishedOid;
    });
  }
}
