/** Owner-selected connector tools a case may propose, kept separately from service content. */
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';
import { ownerHasExited, removeDirectoryGuard, tryDirectoryLock } from './directory-lock.js';

export class CaseActionMigrationError extends ConnectorRefusedError {}

export interface ICaseActionSnapshot {
  readonly revision: string;
  /** Changes when authority changes, not when an unchanged setting is fenced. */
  readonly generation: string;
  readonly tools: readonly string[];
}

export interface ICaseActionScope {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Serialize an owner block while case settings remain closed for offline migration. */
  exclusiveBlock<T>(work: () => Promise<T>): Promise<T>;
  /** Serialize a connection check and its completion for one connector without blocking others. */
  exclusiveConnector<T>(connectorId: string, work: () => Promise<T>): Promise<T>;
  /** Hold `exclusive` while using this result to authorize an action. */
  tools(connectorId: string): Promise<readonly string[]>;
  /** Read the allowed tools and their shared revision as one snapshot. */
  snapshot(connectorId: string): ICaseActionSnapshot;
  /** The previously displayed owner choices while an allow is still being confirmed. */
  pendingSnapshot(connectorId: string): ICaseActionSnapshot | undefined;
  /** Issue a stable recovery revision while this connector's scope is unreadable. Caller holds the lock. */
  errorRevision(connectorId: string): string;
  /** Mark a disconnect immediately and keep the marker locked until the attempt ends. */
  beginDisconnect(connectorId: string): { complete(): void; release(): void };
  /** Fence interrupted or completed disconnects before reopening settings. Caller holds the lock. */
  settleDisconnects(connectorId: string, disconnected?: boolean): Promise<void>;
  transitioning(connectorId: string): boolean;
  /** Fence a revision without changing a newer setting. Caller holds the lock. */
  fence(connectorId: string, expected?: string): Promise<void>;
  /** Establish an empty scope only when none exists; caller holds the settings lock. */
  initialize(connectorId: string): Promise<void>;
  /** Captured synchronously before a request yields to another settings change. */
  version(connectorId: string, tool: string): string;
  /** Stage an allow without exposing it; caller holds the settings lock. */
  stageAllow(connectorId: string, tool: string, expected: string): string;
  /** Commit a staged allow only after connection verification; caller holds the settings lock. */
  finishAllow(connectorId: string, revision: string, connected: boolean): void;
  set(
    connectorId: string,
    tool: string,
    allowed: boolean,
    expected?: string,
  ): Promise<string | undefined>;
  reset(connectorId: string, expected?: string): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

type IScopeState = ICaseActionSnapshot;

interface IPendingAllow {
  readonly previous: IScopeState;
  readonly next: string;
  readonly recovery: string;
}

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const MAX_TOOL_NAME = 128;
const MAX_TOOLS = 200;

/** A missing scope grants nothing; an unreadable or malformed scope is never replaced by a guess. */
export function createCaseActionScope(directory: string): ICaseActionScope {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // Keep the lock beside scope data so an unreadable scope cannot stop the owner blocking a tool.
  // Atomic directory creation works across the host and a Linux VM sharing this volume.
  const canonical = realpathSync(directory);
  const lockPath = join(dirname(canonical), `.${basename(canonical)}-connector-settings.lock`);
  const legacyPath = join(dirname(canonical), `.${basename(canonical)}-connector-settings.sqlite`);
  const recoveryDirectory = join(dirname(canonical), `.${basename(canonical)}-recovery`);
  const transitionDirectory = join(dirname(canonical), `.${basename(canonical)}-transitions`);
  const guardText = 'case-action-directory-lock-v1\n';
  const migrationMessage =
    'Connector settings need offline migration. Stop every agent using this state folder and follow the case-request recovery instructions in the Personal Agent guide.';
  const legacyGuardExists = (): boolean => {
    try {
      if (!lstatSync(legacyPath).isDirectory()) {
        throw new CaseActionMigrationError(migrationMessage);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      if (error instanceof ConnectorRefusedError) throw error;
      throw new ConnectorRefusedError('The previous settings lock cannot be checked');
    }
    try {
      if (readFileSync(join(legacyPath, 'format'), 'utf8') !== guardText) throw new Error();
    } catch {
      throw new CaseActionMigrationError(migrationMessage);
    }
    return true;
  };
  const ensureLegacyGuard = (): void => {
    if (legacyGuardExists()) return;
    const candidate = `${legacyPath}.${randomUUID()}.candidate`;
    try {
      mkdirSync(candidate, { mode: 0o700 });
      writeFileSync(join(candidate, 'format'), guardText, { mode: 0o600, flag: 'wx' });
      // An old SQLite file cannot be replaced by a directory. The non-empty directory then
      // prevents older agents from opening their incompatible lock path.
      renameSync(candidate, legacyPath);
    } catch {
      if (!legacyGuardExists()) {
        throw new ConnectorRefusedError('The previous settings lock cannot be secured');
      }
    } finally {
      try {
        rmSync(join(candidate, 'format'), { force: true });
        rmdirSync(candidate);
      } catch {
        // Preserve an unexpected candidate; it does not grant authority.
      }
    }
  };
  const pathOf = (connectorId: string): string => {
    if (!CONNECTOR_ID.test(connectorId)) throw new ConnectorRefusedError('Invalid connector id');
    return join(directory, connectorId);
  };
  const lock = async <T>(
    path: string,
    attempts: number,
    work: () => Promise<T>,
    requireMigration = true,
  ): Promise<T> => {
    if (requireMigration) ensureLegacyGuard();
    let held: { release(): void } | undefined;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      held = tryDirectoryLock(path);
      if (held !== undefined) break;
      if (attempt === attempts)
        throw new ConnectorRefusedError(
          'Connector settings are busy or require recovery. If they remain unavailable, stop every agent using this state folder and follow the case-request recovery instructions in the Personal Agent guide.',
        );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    if (held === undefined) throw new ConnectorRefusedError('Connector settings cannot be locked');
    try {
      return await work();
    } finally {
      held.release();
    }
  };
  const validTool = (tool: unknown): tool is string =>
    typeof tool === 'string' && tool.length > 0 && tool.length <= MAX_TOOL_NAME;
  const pendingPath = (connectorId: string): string =>
    join(pathOf(connectorId), 'pending-allow.json');
  const hasPending = (connectorId: string): boolean => {
    try {
      statSync(pendingPath(connectorId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ConnectorRefusedError('The pending case action setting cannot be read');
    }
  };
  const recoveryPath = (connectorId: string): string => {
    pathOf(connectorId);
    return join(recoveryDirectory, connectorId);
  };
  const clearRecovery = (connectorId: string): void => {
    try {
      rmSync(recoveryPath(connectorId), { force: true });
    } catch {
      throw new ConnectorRefusedError('The case action recovery setting could not be saved');
    }
  };
  const hasRecovery = (connectorId: string): boolean => {
    try {
      statSync(recoveryPath(connectorId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ConnectorRefusedError('The case action recovery setting cannot be read');
    }
  };
  const read = (connectorId: string): IScopeState => {
    const path = pathOf(connectorId);
    try {
      if (!statSync(directory).isDirectory()) throw new Error('not a directory');
      try {
        readdirSync(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (!statSync(directory).isDirectory()) throw new Error('not a directory');
          return { revision: '0', generation: '0', tools: [] };
        }
        throw error;
      }
      // An existing directory without its state file is damaged, not a fresh empty scope.
      const value: unknown = JSON.parse(readFileSync(join(path, 'scope.json'), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        throw new Error('invalid scope');
      const { revision, generation, tools } = value as {
        revision?: unknown;
        generation?: unknown;
        tools?: unknown;
      };
      if (
        typeof revision !== 'string' ||
        !VERSION.test(revision) ||
        (generation !== undefined &&
          (typeof generation !== 'string' || !VERSION.test(generation))) ||
        !Array.isArray(tools) ||
        tools.length > MAX_TOOLS ||
        !tools.every(validTool) ||
        new Set(tools).size !== tools.length
      ) {
        throw new Error('invalid scope');
      }
      return { revision, generation: generation ?? revision, tools: tools as string[] };
    } catch {
      throw new ConnectorRefusedError('The case action settings cannot be read');
    }
  };
  const write = (connectorId: string, next: IScopeState): void => {
    const path = pathOf(connectorId);
    const temporary = join(path, `.${randomUUID()}.tmp`);
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600 });
      renameSync(temporary, join(path, 'scope.json'));
    } catch {
      throw new ConnectorRefusedError('The case action settings could not be saved');
    } finally {
      try {
        rmSync(temporary, { force: true });
      } catch {
        /* An unfinished file grants nothing. */
      }
    }
  };
  const transitionPaths = (connectorId: string): string[] => {
    pathOf(connectorId);
    try {
      // If a disconnect marker could not be created, authority cannot be confirmed.
      accessSync(dirname(canonical), constants.W_OK);
      try {
        accessSync(transitionDirectory, constants.W_OK);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
      return readdirSync(transitionDirectory)
        .filter(
          (name) =>
            name.startsWith(`${connectorId}.`) &&
            (name.endsWith('.active') || name.endsWith('.done') || name.endsWith('.interrupted')),
        )
        .map((name) => join(transitionDirectory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ConnectorRefusedError('Connector transition settings cannot be read');
    }
  };
  const transitioning = (connectorId: string): boolean => {
    ensureLegacyGuard();
    return transitionPaths(connectorId).length > 0;
  };
  const authorized = (connectorId: string, duringDisconnect = false): IScopeState => {
    if (!duringDisconnect && transitioning(connectorId)) {
      throw new ConnectorRefusedError('The connector is disconnecting');
    }
    if (hasRecovery(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    if (hasPending(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    const current = read(connectorId);
    if (hasRecovery(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    if (hasPending(connectorId)) {
      throw new ConnectorRefusedError('The case action settings require recovery');
    }
    if (!duringDisconnect && transitioning(connectorId)) {
      throw new ConnectorRefusedError('The connector is disconnecting');
    }
    return current;
  };
  const readPending = (connectorId: string): IPendingAllow => {
    try {
      const value: unknown = JSON.parse(readFileSync(pendingPath(connectorId), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const entry = value as { previous?: unknown; next?: unknown; recovery?: unknown };
      if (
        typeof entry.previous !== 'object' ||
        entry.previous === null ||
        Array.isArray(entry.previous)
      )
        throw new Error();
      const previous = entry.previous as {
        revision?: unknown;
        generation?: unknown;
        tools?: unknown;
      };
      if (
        typeof previous.revision !== 'string' ||
        !VERSION.test(previous.revision) ||
        (previous.generation !== undefined &&
          (typeof previous.generation !== 'string' || !VERSION.test(previous.generation))) ||
        !Array.isArray(previous.tools) ||
        !previous.tools.every(validTool) ||
        previous.tools.length > MAX_TOOLS ||
        new Set(previous.tools).size !== previous.tools.length ||
        typeof entry.next !== 'string' ||
        !VERSION.test(entry.next) ||
        typeof entry.recovery !== 'string' ||
        !VERSION.test(entry.recovery)
      )
        throw new Error();
      return {
        previous: {
          revision: previous.revision,
          generation: previous.generation ?? previous.revision,
          tools: previous.tools as string[],
        },
        next: entry.next,
        recovery: entry.recovery,
      };
    } catch {
      throw new ConnectorRefusedError('The pending case action setting cannot be read');
    }
  };
  const writePending = (connectorId: string, pending: IPendingAllow): void => {
    const path = pendingPath(connectorId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    } catch {
      throw new ConnectorRefusedError('The pending case action setting could not be saved');
    } finally {
      rmSync(temporary, { force: true });
    }
  };
  const recoverPending = (connectorId: string): void => {
    if (!hasPending(connectorId)) return;
    try {
      const pending = readPending(connectorId);
      const current = read(connectorId);
      if (![pending.previous.revision, pending.next, pending.recovery].includes(current.revision)) {
        throw new ConnectorRefusedError('The pending case action setting cannot be recovered');
      }
      write(connectorId, { ...pending.previous, revision: pending.recovery });
      rmSync(pendingPath(connectorId), { force: true });
    } catch (error) {
      if (error instanceof ConnectorRefusedError) throw error;
      throw new ConnectorRefusedError('The pending case action setting could not be recovered');
    }
  };
  const isBroken = (connectorId: string): boolean => {
    try {
      const current = read(connectorId);
      if (hasPending(connectorId)) {
        const pending = readPending(connectorId);
        if (![pending.previous.revision, pending.next, pending.recovery].includes(current.revision))
          throw new ConnectorRefusedError('The pending case action setting cannot be recovered');
      }
      return false;
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return true;
    }
  };
  const errorRevision = (connectorId: string): string => {
    if (!isBroken(connectorId)) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    try {
      mkdirSync(recoveryDirectory, { recursive: true, mode: 0o700 });
      const path = recoveryPath(connectorId);
      try {
        const token = readFileSync(path, 'utf8').trim();
        if (VERSION.test(token)) return `broken:${token}`;
      } catch {
        /* A fresh token also invalidates any recovery that could not be read. */
      }
      const token = randomUUID();
      const temporary = `${path}.${token}.tmp`;
      try {
        writeFileSync(temporary, `${token}\n`, { mode: 0o600 });
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      return `broken:${token}`;
    } catch {
      throw new ConnectorRefusedError('The case action recovery setting cannot be read');
    }
  };
  const beginDisconnect = (connectorId: string): { complete(): void; release(): void } => {
    ensureLegacyGuard();
    pathOf(connectorId);
    const token = randomUUID();
    const prefix = join(transitionDirectory, `${connectorId}.${token}`);
    const marker = `${prefix}.active`;
    try {
      mkdirSync(transitionDirectory, { recursive: true, mode: 0o700 });
      if (tryDirectoryLock(marker) === undefined) throw new Error('marker already exists');
    } catch {
      throw new ConnectorRefusedError('The connector transition could not be secured');
    }
    let completed = false;
    return {
      complete: () => {
        renameSync(marker, `${prefix}.done`);
        completed = true;
      },
      release: () => {
        if (!completed) renameSync(marker, `${prefix}.interrupted`);
      },
    };
  };
  const settleDisconnects = async (connectorId: string, disconnected = false): Promise<void> => {
    recoverPending(connectorId);
    const markers = transitionPaths(connectorId);
    if (markers.length === 0) return;
    try {
      for (const marker of markers) {
        if (marker.endsWith('.done')) continue;
        if (disconnected && (marker.endsWith('.interrupted') || ownerHasExited(marker))) continue;
        throw new ConnectorRefusedError(
          'The connector change is still in progress or was interrupted',
        );
      }
      const current = read(connectorId);
      if (current.revision !== '0')
        write(connectorId, { ...current, revision: randomUUID(), generation: randomUUID() });
      for (const marker of markers) removeDirectoryGuard(marker);
    } catch (error) {
      if (error instanceof ConnectorRefusedError) throw error;
      throw new ConnectorRefusedError('The connector transition could not be settled');
    }
  };
  const reset = async (connectorId: string, expected?: string): Promise<void> => {
    if (expected?.startsWith('broken:') === true) {
      if (errorRevision(connectorId) !== expected) {
        throw new ConnectorRefusedError('Case action settings changed; try again');
      }
    } else if (expected !== undefined && authorized(connectorId).revision !== expected) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    write(connectorId, { revision: randomUUID(), generation: randomUUID(), tools: [] });
    // Keep authority closed by the marker until the replacement is durable.
    clearRecovery(connectorId);
    const path = pathOf(connectorId);
    try {
      for (const file of readdirSync(path)) {
        if (file !== 'scope.json') rmSync(join(path, file), { recursive: true, force: true });
      }
    } catch {
      throw new ConnectorRefusedError('The case action settings could not be reset');
    }
  };
  const stageAllow = (connectorId: string, tool: string, expected: string): string => {
    if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
    const current = authorized(connectorId);
    if (current.revision === '0' || current.revision !== expected) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    const tools = new Set(current.tools);
    tools.add(tool);
    if (tools.size > MAX_TOOLS) throw new ConnectorRefusedError('Too many case action tools');
    const next = { revision: randomUUID(), generation: randomUUID(), tools: [...tools].sort() };
    writePending(connectorId, { previous: current, next: next.revision, recovery: randomUUID() });
    write(connectorId, next);
    return next.revision;
  };
  const finishAllow = (connectorId: string, revision: string, connected: boolean): void => {
    if (!hasPending(connectorId))
      throw new ConnectorRefusedError('Case action settings changed; try again');
    const pending = readPending(connectorId);
    if (pending.next !== revision || read(connectorId).revision !== revision) {
      throw new ConnectorRefusedError('Case action settings changed; try again');
    }
    if (!connected || transitioning(connectorId)) {
      recoverPending(connectorId);
      throw new ConnectorRefusedError('Choose a connected writable tool for case requests');
    }
    try {
      rmSync(pendingPath(connectorId), { force: true });
    } catch {
      throw new ConnectorRefusedError('The case action setting could not be completed');
    }
  };
  return {
    exclusive: (work) => lock(lockPath, 100, work),
    exclusiveBlock: (work) => lock(lockPath, 100, work, false),
    exclusiveConnector: (connectorId, work) => {
      pathOf(connectorId);
      return lock(
        join(dirname(canonical), `.${basename(canonical)}-${connectorId}.lock`),
        300,
        work,
      );
    },
    tools: async (connectorId) => authorized(connectorId).tools,
    snapshot: (connectorId) => authorized(connectorId),
    pendingSnapshot: (connectorId) => {
      if (!hasPending(connectorId)) return undefined;
      const pending = readPending(connectorId);
      const current = read(connectorId);
      if (![pending.previous.revision, pending.next, pending.recovery].includes(current.revision)) {
        throw new ConnectorRefusedError('The pending case action setting cannot be read');
      }
      return pending.previous;
    },
    errorRevision,
    beginDisconnect,
    settleDisconnects,
    transitioning,
    stageAllow,
    finishAllow,
    fence: async (connectorId, expected) => {
      if (expected?.startsWith('broken:') === true) {
        if (isBroken(connectorId) && errorRevision(connectorId) === expected) {
          await reset(connectorId, expected);
        }
        return;
      }
      if (hasPending(connectorId)) {
        const pending = readPending(connectorId);
        if (expected !== undefined && expected !== pending.previous.revision) return;
        recoverPending(connectorId);
        if (expected !== undefined) return;
      }
      const current = read(connectorId);
      if (hasRecovery(connectorId)) {
        write(connectorId, { ...current, revision: randomUUID(), generation: randomUUID() });
        clearRecovery(connectorId);
        return;
      }
      if (current.revision === '0' || (expected !== undefined && expected !== current.revision))
        return;
      clearRecovery(connectorId);
      write(connectorId, { ...current, revision: randomUUID() });
    },
    initialize: async (connectorId) => {
      if (hasPending(connectorId))
        throw new ConnectorRefusedError('The case action change is still in progress');
      await settleDisconnects(connectorId);
      const current = read(connectorId);
      if (current.revision === '0') {
        write(connectorId, { revision: randomUUID(), generation: randomUUID(), tools: [] });
        clearRecovery(connectorId);
      } else if (hasRecovery(connectorId)) {
        write(connectorId, { ...current, revision: randomUUID(), generation: randomUUID() });
        clearRecovery(connectorId);
      }
    },
    version: (connectorId, tool) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      const current = authorized(connectorId);
      if (current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      return current.revision;
    },
    set: async (connectorId, tool, allowed, expected) => {
      if (!validTool(tool)) throw new ConnectorRefusedError('Invalid tool name');
      let expectedRevision = expected;
      if (!allowed && hasPending(connectorId)) {
        const pending = readPending(connectorId);
        if (expectedRevision !== undefined && expectedRevision !== pending.previous.revision) {
          throw new ConnectorRefusedError('Case action settings changed; try again');
        }
        recoverPending(connectorId);
        if (expectedRevision !== undefined) expectedRevision = pending.recovery;
      }
      const current = authorized(connectorId, !allowed);
      if (allowed && current.revision === '0') {
        throw new ConnectorRefusedError('Open the connector settings before allowing case actions');
      }
      if (expectedRevision !== undefined && expectedRevision !== current.revision) {
        throw new ConnectorRefusedError('Case action settings changed; try again');
      }
      if (allowed) {
        const staged = stageAllow(connectorId, tool, expectedRevision ?? current.revision);
        finishAllow(connectorId, staged, true);
        return staged;
      }
      const tools = new Set(current.tools);
      tools.delete(tool);
      if (tools.size > MAX_TOOLS) throw new ConnectorRefusedError('Too many case action tools');
      // A revoke advances the revision even when the tool is absent, cancelling older allows.
      const next = { revision: randomUUID(), generation: randomUUID(), tools: [...tools].sort() };
      write(connectorId, next);
      return undefined;
    },
    reset,
    clear: async (connectorId) => {
      try {
        if (!statSync(directory).isDirectory()) throw new Error('not a directory');
        rmSync(pathOf(connectorId), { recursive: true, force: true });
        clearRecovery(connectorId);
      } catch {
        throw new ConnectorRefusedError('The case action settings could not be cleared');
      }
    },
  };
}
