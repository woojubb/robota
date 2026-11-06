/**
 * Which product processes are using this state root's conversation stores right now, and whether a
 * `secure migrate` is running over them (#3679).
 *
 * Nothing else ties a store to a live process: the stores have no cross-process lock, and the
 * supervised registry covers daemons only. So each side marks itself under `<userRoot>/presence/`, in a
 * process-scoped directory whose owner record names the process (pid, start time, boot, pid
 * namespace); it is removed when its process ends, and swept once its owner is provably gone:
 *
 * - a process that builds a conversation store creates its presence the first time it does, then
 *   looks for a running migration and, finding one — or a marker whose owner it cannot check —
 *   refuses to open stores. A compaction's marker is not one: a compaction holds no store, since
 *   terminals append to the history by path and it catches up what they append;
 * - a migration (or a compaction) writes its own marker first, its owner record flushed, then looks at
 *   every other presence and marker, and refuses outright at any other marker it does not know to be
 *   gone.
 *
 * Whichever comes second sees the first, so at least one side always refuses, and two migrations or
 * compactions both do. A presence holds metadata only — the owner record and the process's mode —
 * never a prompt, an argument or a path. One without an owner record is a crash's once the moment of
 * its creation is past, since creating it writes the record at once; it counts as gone. Starting
 * processes sweep presences whose pid has ended without reading start times (on macOS that takes a
 * `ps` per presence); a migration classifies every one fully, and sweeps the rest that are gone.
 *
 * What it cannot see: a process of a build that records no presence, and one whose presence could not
 * be created (it says so on stderr and keeps working). A same-user program can plant or remove these
 * directories like any other file of this account: presence keeps cooperating processes apart; it is
 * never a trust anchor.
 */
import { lstatSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  createProcessScopedDirectory,
  inspectProcessScopedDirectories,
  ownerOnThisMachine,
  readCurrentProcessIdentity,
  readProcessStartTime,
  removeDirectoryOnProcessExit,
  writeOwnerOnlyFile,
  type IOwnerOnlyDurability,
  type IProcessIdentity,
  type IProcessScopedDirectoryEntry,
  type ISweepProcessScopedDirectoriesOptions,
  type TProcessOwnerLiveness,
} from '@robota-sdk/agent-core/node';

import { readWindowsProcessStartTime } from '@robota-sdk/agent-local-host';

import type { ICliRuntimeContext } from './runtime-context.js';

const PROCESS_PREFIX = 'process-';
const MIGRATION_PREFIX = 'migration-';
const MODE_FILE = 'mode';
const MAX_MODE_BYTES = 64;
const UNRECORDED_MODE = 'mode not recorded';
/**
 * How long a presence or marker may stand without its owner record: creating one writes the record
 * at once, so one still without it after this is a crash's. Generous, since the directory's time is
 * the filesystem's clock and now is this process's.
 */
const OWNER_RECORD_WINDOW_MS = 60_000;

/** What a marker's process runs: a migration, or a compaction of the prompt history alone. */
export type TProductMigrationMode = 'secure migrate' | 'secure compact';

const COMPACTION_MODE: TProductMigrationMode = 'secure compact';
const MIGRATION_MODES: ReadonlySet<string> = new Set<TProductMigrationMode>([
  'secure migrate',
  COMPACTION_MODE,
]);
/** What an older marker, which recorded no mode, ran. */
const DEFAULT_MIGRATION_MODE: TProductMigrationMode = 'secure migrate';

/** How a process that builds conversation stores was started, as its presence names it. */
export type TProductProcessMode =
  'interactive' | 'print' | 'serve' | 'acp' | 'mcp serve' | 'subagent' | 'command';

const MODES: ReadonlySet<string> = new Set<TProductProcessMode>([
  'interactive',
  'print',
  'serve',
  'acp',
  'mcp serve',
  'subagent',
  'command',
]);

/** The fixed refusal of a store construction while a migration runs. */
export const MIGRATION_RUNNING_MESSAGE = 'A migration is running; try again when it finishes.';

/**
 * A store construction refused because a migration of this state root is running — or may be: its
 * marker's owner cannot be checked from here (another pid namespace, or no owner record yet), and a
 * migration that may be running is treated as one that is.
 */
export class ProductMigrationRunningError extends Error {
  constructor(unchecked?: string) {
    super(
      unchecked === undefined
        ? MIGRATION_RUNNING_MESSAGE
        : `A migration may be running: its marker ${unchecked} cannot be checked from here. Try again when it finishes, or remove that directory if you are sure none is running.`,
    );
    this.name = 'ProductMigrationRunningError';
  }
}

export interface IPresenceOptions {
  /** The platform whose start-time reader judges liveness; defaults to this one. */
  readonly platform?: NodeJS.Platform;
  /** Liveness probes, for tests that need no real pids. */
  readonly probes?: ISweepProcessScopedDirectoriesOptions;
}

/** Why an entry's owner could be shown neither alive nor gone. */
export type TPresenceUnknownReason =
  /** Its owner record names another host name or machine id: another machine, which this one cannot probe. */
  | 'other-machine'
  /** Its owner runs in another pid namespace (another container) of this same boot, as both boot ids say. */
  | 'other-pid-namespace'
  /** Its owner runs in another pid namespace, and whether in this boot cannot be told (a boot id is missing). */
  | 'other-pid-namespace-unknown-boot'
  /** It holds no readable owner record (one being created, or damaged). */
  | 'no-owner-record'
  /** Its owner record carries no start time, or the live pid's cannot be read. */
  | 'no-start-time';

/** Another process's presence or migration marker, as found. */
export interface IPresenceEntry {
  readonly kind: 'process' | 'migration';
  readonly pid: number;
  /** The start time its owner record carries, in the platform's own form. */
  readonly startTime?: string;
  readonly mode: string;
  /** `gone` entries are never returned: they are swept, or left out of a read-only listing. */
  readonly liveness: Exclude<TProcessOwnerLiveness, 'gone'>;
  /** Set for an `unknown` entry. */
  readonly unknownBecause?: TPresenceUnknownReason;
  /** The host name its owner record carries, when it says so: what names another machine. */
  readonly ownerHostname?: string;
  readonly path: string;
}

/** The directories this process created: a process never stands in its own way. */
const ownDirectories = new Set<string>();

interface IRuntimePresence {
  mode: TProductProcessMode;
  directory: string | undefined;
  /** Creating the presence failed once; it is not attempted again for this runtime. */
  failed: boolean;
  cancelRemoval: (() => void) | undefined;
}

const runtimePresences = new WeakMap<ICliRuntimeContext, IRuntimePresence>();

function presenceOf(runtime: ICliRuntimeContext): IRuntimePresence {
  let presence = runtimePresences.get(runtime);
  if (presence === undefined) {
    presence = { mode: 'command', directory: undefined, failed: false, cancelRemoval: undefined };
    runtimePresences.set(runtime, presence);
  }
  return presence;
}

/** agent-core's start-time reader, with this product's Windows reader (the one agent-core cannot carry). */
function startTimeReader(platform: NodeJS.Platform): (pid: number) => string | undefined {
  return (pid) => readProcessStartTime(pid, { platform, readWindows: readWindowsProcessStartTime });
}

/** This process on Windows, as its own records state it there: with the Windows reader's start time. */
const windowsIdentities = new Map<number, IProcessIdentity>();

function windowsCurrentIdentity(): IProcessIdentity {
  let identity = windowsIdentities.get(process.pid);
  if (identity === undefined) {
    const { startTime: _ignored, ...current } = readCurrentProcessIdentity();
    const startTime = startTimeReader('win32')(process.pid);
    identity = startTime === undefined ? current : { ...current, startTime };
    windowsIdentities.set(process.pid, identity);
  }
  return identity;
}

function probesOf(options: IPresenceOptions): ISweepProcessScopedDirectoriesOptions {
  const platform = options.platform ?? process.platform;
  return {
    readStartTime: startTimeReader(platform),
    // agent-core reads no Windows start time of its own, so on Windows this process is stated with the
    // reader its records were written with; elsewhere agent-core's own reading of it is the same.
    ...(platform === 'win32' ? { current: windowsCurrentIdentity() } : {}),
    ...options.probes,
  };
}

function unknownReason(
  owner: IProcessIdentity | undefined,
  current: IProcessIdentity,
): TPresenceUnknownReason {
  if (owner === undefined) return 'no-owner-record';
  // Pids, boots and namespaces of another machine mean nothing here, so this is told first.
  if (!ownerOnThisMachine(owner, current)) return 'other-machine';
  if (owner.pidNamespace === current.pidNamespace) return 'no-start-time';
  // Two boot ids that differ make the owner gone, so here they are equal or one is missing.
  return owner.bootId !== undefined && owner.bootId === current.bootId
    ? 'other-pid-namespace'
    : 'other-pid-namespace-unknown-boot';
}

/**
 * Whether an entry never got the owner record its creation writes at once, and that moment is long
 * past: a crash's, gone like an entry whose owner provably is.
 */
function crashedBeforeOwnerRecord(entry: IProcessScopedDirectoryEntry): boolean {
  if (entry.owner !== undefined) return false;
  try {
    return Date.now() - lstatSync(entry.path).mtimeMs > OWNER_RECORD_WINDOW_MS;
  } catch (error) {
    // allow-fallback: one removed meanwhile is gone; one that cannot be looked at is kept, as unknown.
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

function writeMode(directory: string, mode: TProductProcessMode | TProductMigrationMode): void {
  try {
    writeOwnerOnlyFile(join(directory, MODE_FILE), mode);
  } catch {
    // allow-fallback: the presence still names its process; only the mode is then not recorded.
  }
}

function readMode(directory: string, known: ReadonlySet<string>, otherwise: string): string {
  try {
    const path = join(directory, MODE_FILE);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_MODE_BYTES) return otherwise;
    const mode = readFileSync(path, 'utf8');
    return known.has(mode) ? mode : otherwise;
  } catch {
    // allow-fallback: a presence made a moment ago may not have written its mode yet.
    return otherwise;
  }
}

function createDirectory(
  runtime: ICliRuntimeContext,
  prefix: string,
  options: IWriteProductMigrationMarkerOptions,
  durable: boolean,
): { readonly directory: string; readonly cancelRemoval: () => void } {
  const directory = createProcessScopedDirectory(runtime.layout.userPaths.presence, prefix, {
    readStartTime: startTimeReader(options.platform ?? process.platform),
    ...(durable ? { durable, ...options.durability } : {}),
  });
  ownDirectories.add(directory);
  return { directory, cancelRemoval: removeDirectoryOnProcessExit(directory) };
}

function removeDirectory(directory: string, cancelRemoval: () => void): void {
  cancelRemoval();
  ownDirectories.delete(directory);
  rmSync(directory, { recursive: true, force: true });
}

function entriesOf(
  runtime: ICliRuntimeContext,
  prefix: string,
  kind: IPresenceEntry['kind'],
  options: IPresenceOptions,
  sweep: boolean,
): IPresenceEntry[] {
  const entries: IPresenceEntry[] = [];
  const probes = probesOf(options);
  const found = inspectProcessScopedDirectories(runtime.layout.userPaths.presence, prefix, probes);
  for (const entry of found) {
    if (ownDirectories.has(entry.path)) continue;
    if (entry.liveness === 'gone' || crashedBeforeOwnerRecord(entry)) {
      if (sweep) rmSync(entry.path, { recursive: true, force: true });
      continue;
    }
    const startTime = entry.owner?.startTime;
    entries.push({
      kind,
      pid: entry.pid,
      ...(startTime === undefined ? {} : { startTime }),
      mode:
        kind === 'migration'
          ? readMode(entry.path, MIGRATION_MODES, DEFAULT_MIGRATION_MODE)
          : readMode(entry.path, MODES, UNRECORDED_MODE),
      liveness: entry.liveness,
      ...(entry.owner?.hostname === undefined ? {} : { ownerHostname: entry.owner.hostname }),
      ...(entry.liveness === 'unknown'
        ? {
            unknownBecause: unknownReason(
              entry.owner,
              probes.current ?? readCurrentProcessIdentity(),
            ),
          }
        : {}),
      path: entry.path,
    });
  }
  return entries;
}

/**
 * Every presence and migration marker under `runtime`'s state root other than this process's own,
 * each alive or unknown. With `sweep`, the directories of owners that are gone are removed on the way;
 * without it nothing is written.
 */
export function listProductPresence(
  runtime: ICliRuntimeContext,
  options: IPresenceOptions & { readonly sweep: boolean },
): readonly IPresenceEntry[] {
  return [
    ...entriesOf(runtime, PROCESS_PREFIX, 'process', options, options.sweep),
    ...entriesOf(runtime, MIGRATION_PREFIX, 'migration', options, options.sweep),
  ];
}

/**
 * A migration marker that is alive or cannot be checked, alive ones first; `undefined` when none. A
 * compaction's marker is passed over; one that names no mode counts as a migration's.
 */
function runningMigration(
  runtime: ICliRuntimeContext,
  options: IPresenceOptions,
): IPresenceEntry | undefined {
  const markers = entriesOf(runtime, MIGRATION_PREFIX, 'migration', options, false).filter(
    (entry) => entry.mode !== COMPACTION_MODE,
  );
  return markers.find((entry) => entry.liveness === 'alive') ?? markers[0];
}

/**
 * Removes, as a starting process does for its other scratch, the presences and migration markers
 * whose pid has ended (or that are from an earlier boot, or never got their owner record); never one
 * alive or unknown. No start time is read, so a recycled pid's entry is left for a migration to
 * judge. Best effort: one that cannot be removed is left for the next start.
 */
export function sweepGoneProductPresence(
  runtime: ICliRuntimeContext,
  options: IPresenceOptions = {},
): void {
  const probes: ISweepProcessScopedDirectoriesOptions = {
    readStartTime: () => undefined,
    ...options.probes,
  };
  for (const prefix of [PROCESS_PREFIX, MIGRATION_PREFIX]) {
    for (const entry of inspectProcessScopedDirectories(
      runtime.layout.userPaths.presence,
      prefix,
      probes,
    )) {
      const gone = entry.liveness === 'gone' || crashedBeforeOwnerRecord(entry);
      if (ownDirectories.has(entry.path) || !gone) continue;
      try {
        rmSync(entry.path, { recursive: true, force: true });
      } catch {
        // allow-fallback: one that cannot be removed now is retried by the next start.
      }
    }
  }
}

/**
 * Says how this process was started, for its presence to name: recorded at once where the presence
 * already exists (a store may have been built before the mode was known), and at its creation
 * otherwise. A process that never says is a `command`.
 */
export function declareProductProcessMode(
  runtime: ICliRuntimeContext,
  mode: TProductProcessMode,
): void {
  const presence = presenceOf(runtime);
  presence.mode = mode;
  if (presence.directory !== undefined) writeMode(presence.directory, mode);
}

export interface IEnterProductStoresOptions extends IPresenceOptions {
  /** Where a presence that could not be created is reported; defaults to this process's stderr. */
  readonly stderr?: (text: string) => void;
}

/**
 * What every conversation store construction does first. The first call for `runtime` creates this
 * process's presence and then refuses — {@link ProductMigrationRunningError}, with the presence
 * removed again — while a migration is running; once it has passed, a running migration has seen
 * this presence and refuses itself, so later constructions need not look again. A presence that
 * cannot be created is reported on stderr once and the stores are still built, so a state root this
 * process cannot write to does not cost the session; every construction then looks for a migration.
 */
export function enterProductStores(
  runtime: ICliRuntimeContext,
  options: IEnterProductStoresOptions = {},
): void {
  const presence = presenceOf(runtime);
  if (presence.directory !== undefined) return;
  if (!presence.failed) {
    try {
      const created = createDirectory(runtime, PROCESS_PREFIX, options, false);
      presence.directory = created.directory;
      presence.cancelRemoval = created.cancelRemoval;
      writeMode(created.directory, presence.mode);
    } catch (error) {
      presence.failed = true;
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      (options.stderr ?? ((text: string) => process.stderr.write(text)))(
        `Could not mark this process in ${runtime.layout.userPaths.presence} (${code}): a migration ` +
          'of the stored conversations started while it runs would not see it.\n',
      );
    }
  }
  const migration = runningMigration(runtime, options);
  if (migration === undefined) return;
  if (presence.directory !== undefined && presence.cancelRemoval !== undefined) {
    removeDirectory(presence.directory, presence.cancelRemoval);
    presence.directory = undefined;
    presence.cancelRemoval = undefined;
  }
  throw new ProductMigrationRunningError(
    migration.liveness === 'alive' ? undefined : migration.path,
  );
}

/** A running migration's marker. */
export interface IProductMigrationMarker {
  readonly directory: string;
  /**
   * When the marker was written, in milliseconds by the clock of the filesystem it is on: what a
   * migration judges a leftover temp file's age against.
   */
  readonly writtenAt: number;
  /** Every other presence and marker now, alive or unknown; the directories of gone owners are swept. */
  others(): readonly IPresenceEntry[];
  /** Removes the marker. Idempotent. */
  release(): void;
}

export interface IWriteProductMigrationMarkerOptions extends IPresenceOptions {
  /** What the marker's process runs; a migration by default. */
  readonly mode?: TProductMigrationMode;
  /** Seams for the flushes of the owner record, for tests that check them. */
  readonly durability?: IOwnerOnlyDurability;
}

/**
 * Writes this process's migration marker, naming what it runs, before it looks at anything else, so
 * a process that builds a store from now on refuses; then {@link IProductMigrationMarker.others}
 * says whether any other process was already there. The owner record is flushed first, file and
 * directory: a marker that lost it in a crash would count as running until it was swept as a crash's.
 */
export function writeProductMigrationMarker(
  runtime: ICliRuntimeContext,
  options: IWriteProductMigrationMarkerOptions = {},
): IProductMigrationMarker {
  const { directory, cancelRemoval } = createDirectory(runtime, MIGRATION_PREFIX, options, true);
  writeMode(directory, options.mode ?? DEFAULT_MIGRATION_MODE);
  let writtenAt: number;
  try {
    writtenAt = lstatSync(directory).mtimeMs;
  } catch (error) {
    removeDirectory(directory, cancelRemoval);
    throw error;
  }
  let released = false;
  return {
    directory,
    writtenAt,
    others: () => listProductPresence(runtime, { ...options, sweep: true }),
    release: () => {
      if (released) return;
      released = true;
      removeDirectory(directory, cancelRemoval);
    },
  };
}
