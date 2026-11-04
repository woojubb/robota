/**
 * What one step of `secure migrate` is (#3679): one kind of stored artifact, planned read-only and
 * then run, given the run's unlocked keys and the way to learn that another product process appeared.
 * The orchestration is `secure-migrate.ts`; the steps that convert the stores are
 * `migration-steps.ts`.
 */
import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { KeyHolder } from './key-holder.js';

/** What a step is given: the run's unlocked keys and the way to learn that another process appeared. */
export interface IMigrationContext {
  readonly productRuntime: ICliRuntimeContext;
  /** Unlocked for the whole run: steps seal to the key the unlock verified and open what is sealed. */
  readonly holder: KeyHolder;
  /**
   * Throws `MigrationInterruptedError` when a product process appeared since the run began. A step
   * calls it before each of its commit points; in a dry run it never throws.
   */
  readonly recheckPresence: () => void;
  /**
   * The one gate every deletion of a leftover passes — a crashed write's temp file, a hand-off being
   * received, pending memory candidates, an old scratch directory: false when some other process
   * could not be checked and the person typed `proceed` past it, since it may still be using them.
   */
  readonly mayDeleteLeftovers: boolean;
  /**
   * When the run started, in milliseconds by the filesystem's clock (its marker's time): a leftover
   * temp file's age is judged against it too. A dry run writes no marker and uses this process's
   * clock, which only changes what it counts.
   */
  readonly startedAt: number;
}

/** Lines for the plan or the summary, unindented. */
export interface IMigrationStepReport {
  readonly lines: readonly string[];
}

export interface IMigrationStepOutcome extends IMigrationStepReport {
  /** False when something the step should have converted is still plain: the run is incomplete. */
  readonly complete: boolean;
  /** The session records the step sealed from plaintext; absent when it sealed none. */
  readonly migratedSessions?: IMigratedSessions;
}

/**
 * Session records a run sealed from plaintext files any program of the user could have written:
 * sealing says nothing about who wrote them, so they stay unverified unless the person marks them as
 * theirs.
 */
export interface IMigratedSessions {
  readonly count: number;
  /**
   * Raises each to the owner's while its file is still exactly the bytes the run sealed (the keys are
   * unlocked for the whole run); a record changed since is left unverified, and a store whose records
   * could not be raised does not stop the others.
   */
  adopt(): IMigratedSessionsMarked;
}

/** What marking the migrated sessions as the owner's did. */
export interface IMigratedSessionsMarked {
  readonly adopted: number;
  /** Not marked: the keys locked during the run before they could be; each asks on its next resume. */
  readonly locked: number;
  /** Changed after the run sealed them, so left unverified. */
  readonly changed: number;
  /** The ids of sessions open in another process, which the marking left unverified. */
  readonly held: readonly string[];
  /** The sessions that could not be marked at all, by where they are; they stay unverified. */
  readonly unmarked: readonly IUnmarkedSessions[];
}

/** Sessions a marking could not reach, where they are, and the name of the error that stopped it. */
export interface IUnmarkedSessions {
  readonly where: string;
  readonly count: number;
  readonly failure: string;
}

/** One kind of stored artifact a migration converts, planned read-only and then run. */
export interface IMigrationStep {
  /** What it converts, as the summary names a step that stopped. */
  readonly title: string;
  /** What it would do; writes nothing, and is accurate in a dry run. */
  plan(context: IMigrationContext): IMigrationStepReport | Promise<IMigrationStepReport>;
  run(context: IMigrationContext): Promise<IMigrationStepOutcome>;
}
