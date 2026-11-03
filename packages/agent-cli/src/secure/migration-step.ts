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
}

/** One kind of stored artifact a migration converts, planned read-only and then run. */
export interface IMigrationStep {
  /** What it converts, as the summary names a step that stopped. */
  readonly title: string;
  /** What it would do; writes nothing, and is accurate in a dry run. */
  plan(context: IMigrationContext): IMigrationStepReport | Promise<IMigrationStepReport>;
  run(context: IMigrationContext): Promise<IMigrationStepOutcome>;
}
