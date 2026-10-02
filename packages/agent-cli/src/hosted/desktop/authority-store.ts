import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type {
  IOrganizationLedgerAnchor,
  IOrganizationLedgerHead,
} from '@robota-sdk/agent-organization';
import { DesktopRefused } from './authorization.js';

interface IConnection {
  generation: number;
  access: string;
  approval: string | null;
  expiresAt: number;
  connected: boolean;
}
interface IState {
  version: 1;
  revision: number;
  spent: Record<string, number>;
  connections: Record<string, IConnection>;
}
export interface IDesktopAccess {
  readonly key: string;
  readonly generation: number;
  readonly token: string;
  readonly approvalToken: string | null;
  readonly expiresAt: number;
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const sameHead = (a: IOrganizationLedgerHead | undefined, b: IOrganizationLedgerHead): boolean =>
  a?.version === b.version &&
  a.ledger === b.ledger &&
  a.revision === b.revision &&
  a.digest === b.digest;

/** Replay and connection replacement survive restart; independent custody rejects restored authority. */
export class HostedDesktopAuthorityStore {
  private readonly directory: string;
  private readonly file: string;
  private readonly lock: string;
  constructor(
    options: { directory: string; anchor: IOrganizationLedgerAnchor; create?: boolean },
    private readonly now: () => number = Date.now,
  ) {
    this.anchor = options.anchor;
    if (!isAbsolute(options.directory)) throw new DesktopRefused('store-unavailable');
    this.directory = realpathSync(options.directory);
    const stat = lstatSync(this.directory);
    if (
      !stat.isDirectory() ||
      (stat.mode & 0o077) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid())
    )
      throw new DesktopRefused('store-unavailable');
    this.file = join(this.directory, 'desktop-authority.json');
    this.lock = join(this.directory, 'desktop-authority.lock');
    if (options.create === true) {
      if (existsSync(this.file) || this.anchor.read() !== undefined)
        throw new DesktopRefused('store-unavailable');
      this.locked(() =>
        this.write(undefined, { version: 1, revision: 1, spent: {}, connections: {} }),
      );
    }
    this.read();
  }
  private readonly anchor: IOrganizationLedgerAnchor;
  private head(state: IState): IOrganizationLedgerHead {
    return {
      version: 1,
      ledger: this.anchor.ledger,
      revision: state.revision,
      digest: digest(JSON.stringify(state)),
    };
  }
  private read(): IState {
    const fd = openSync(
      this.file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size > 2 * 1024 * 1024 ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && stat.uid !== process.getuid())
      )
        throw new DesktopRefused('store-unavailable');
      const state = JSON.parse(readFileSync(fd, 'utf8')) as IState;
      const head = this.anchor.read();
      if (
        state.version !== 1 ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 1 ||
        !state.spent ||
        !state.connections ||
        !sameHead(head, this.head(state))
      )
        throw new DesktopRefused('store-unavailable');
      return state;
    } finally {
      closeSync(fd);
    }
  }
  private locked<T>(work: () => T): T {
    mkdirSync(this.lock, { mode: 0o700 });
    try {
      return work();
    } finally {
      rmdirSync(this.lock);
    }
  }
  private write(expected: IState | undefined, state: IState): void {
    const temporary = join(this.directory, `desktop-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify(state));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      const next = this.head(state);
      this.anchor.compareAndSet(expected === undefined ? undefined : this.head(expected), next);
      if (!sameHead(this.anchor.read(), next)) throw new DesktopRefused('store-unavailable');
      renameSync(temporary, this.file);
      const directory = openSync(this.directory, constants.O_RDONLY);
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  private change<T>(update: (state: IState) => T): T {
    return this.locked(() => {
      const before = this.read();
      const next = structuredClone(before);
      const result = update(next);
      next.revision++;
      this.write(before, next);
      return result;
    });
  }
  pair(
    key: string,
    proofs: readonly { readonly id: string; readonly expiresAt: number }[],
    expiresAt: number,
    operator: boolean,
  ): IDesktopAccess {
    const token = randomBytes(32).toString('base64url');
    const approvalToken = operator ? randomBytes(32).toString('base64url') : null;
    return this.change((state) => {
      for (const [id, expiry] of Object.entries(state.spent))
        if (expiry <= this.now()) delete state.spent[id];
      if (
        expiresAt <= this.now() ||
        proofs.length === 0 ||
        new Set(proofs.map((proof) => proof.id)).size !== proofs.length ||
        proofs.some(
          (proof) => !Number.isSafeInteger(proof.expiresAt) || proof.expiresAt < expiresAt,
        ) ||
        Object.keys(state.spent).length + proofs.length > 4096 ||
        proofs.some((proof) => state.spent[digest(proof.id)] !== undefined)
      )
        throw new DesktopRefused('replayed-pairing');
      const hashed = digest(key);
      if (state.connections[hashed] === undefined && Object.keys(state.connections).length >= 100)
        throw new DesktopRefused('connection-capacity');
      const generation = (state.connections[hashed]?.generation ?? 0) + 1;
      state.connections[hashed] = {
        generation,
        access: digest(token),
        approval: approvalToken === null ? null : digest(approvalToken),
        expiresAt,
        connected: false,
      };
      for (const proof of proofs) state.spent[digest(proof.id)] = proof.expiresAt;
      return { key, generation, token, approvalToken, expiresAt };
    });
  }
  authorize(key: string, generation: number, token: string, operator = false): void {
    const entry = this.read().connections[digest(key)];
    if (
      !entry ||
      entry.generation !== generation ||
      entry.expiresAt <= this.now() ||
      (operator ? entry.approval : entry.access) !== digest(token)
    )
      throw new DesktopRefused('withdrawn-connection');
  }
  connect(key: string, generation: number, token: string): void {
    this.authorize(key, generation, token);
    this.change((state) => {
      const entry = state.connections[digest(key)]!;
      if (entry.generation !== generation || entry.expiresAt <= this.now() || entry.connected)
        throw new DesktopRefused('replayed-connection');
      entry.connected = true;
    });
  }
  approveOnce(key: string, generation: number, token: string, prompt: string): void {
    this.authorize(key, generation, token, true);
    this.change((state) => {
      const entry = state.connections[digest(key)]!;
      if (
        entry.generation !== generation ||
        entry.expiresAt <= this.now() ||
        entry.approval !== digest(token)
      )
        throw new DesktopRefused('withdrawn-connection');
      const nonce = digest(`approval:${key}:${prompt}`);
      if (state.spent[nonce] !== undefined) throw new DesktopRefused('replayed-approval');
      if (Object.keys(state.spent).length >= 4096) throw new DesktopRefused('approval-capacity');
      // An uncertain permission response cannot become permission to send it again after reconnect.
      state.spent[nonce] = Number.MAX_SAFE_INTEGER;
    });
  }
  revoke(key: string): void {
    this.change((state) => {
      const entry = state.connections[digest(key)];
      if (entry) {
        entry.generation++;
        entry.expiresAt = 0;
      }
    });
  }
}
