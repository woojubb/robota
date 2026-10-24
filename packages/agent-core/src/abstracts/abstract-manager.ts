/**
 * @fileoverview Abstract Manager Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT IMPORT CONCRETE IMPLEMENTATIONS
 *
 * This class defines the common lifecycle contract for all manager implementations.
 * It enforces explicit initialization/disposal semantics so that subclasses can
 * provide their own resource management logic while sharing guard rails.
 *
 * Architectural rules:
 * - Depends only on abstractions (no concrete manager implementations)
 * - Provides finalize hooks (`doInitialize`, `doDispose`) for subclasses
 * - Guards public APIs via `ensureInitialized`
 */

/** Construction-time lifecycle declaration for a manager. */
export interface IManagerLifecycleOptions {
  /**
   * Declare that this manager needs no asynchronous setup, so its API works from construction.
   *
   * CORE-045: a manager whose `doInitialize` does nothing still refused every guarded call until
   * something awaited `initialize()`. That turned a public API into a trap — `registerTool` and
   * `swapDefaultProvider` threw on every freshly constructed agent — while protecting nothing,
   * because there was no asynchronous state for a caller to race. Declare this only when
   * `doInitialize` genuinely has no work to wait for; the guard remains meaningful either way,
   * since disposal returns the manager to a refusing state.
   */
  readyOnConstruction?: boolean;
}

export abstract class AbstractManager {
  protected initialized = false;
  private disposed = false;
  private initializationPromise: Promise<void> | undefined;
  private disposalPromise: Promise<void> | undefined;

  protected constructor(options: IManagerLifecycleOptions = {}) {
    this.initialized = options.readyOnConstruction === true;
  }

  /**
   * Initialize the manager (idempotent)
   */
  async initialize(): Promise<void> {
    while (this.disposalPromise) {
      await this.disposalPromise;
    }
    if (this.initialized) {
      return;
    }
    this.initializationPromise ??= Promise.resolve()
      .then(() => this.doInitialize())
      .then(() => {
        if (!this.disposalPromise) {
          this.initialized = true;
          this.disposed = false;
        }
      })
      .finally(() => {
        this.initializationPromise = undefined;
      });
    await this.initializationPromise;
  }

  /**
   * Subclass-specific initialization logic
   */
  protected abstract doInitialize(): Promise<void>;

  /**
   * Dispose manager resources (idempotent)
   */
  async dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise;
    this.initialized = false;
    this.disposed = true;
    const cleanup = () => this.doDispose();
    this.disposalPromise = (this.initializationPromise ?? Promise.resolve())
      .then(cleanup, cleanup)
      .finally(() => {
        this.initialized = false;
        this.disposed = true;
        this.disposalPromise = undefined;
      });
    await this.disposalPromise;
  }

  /**
   * Subclass-specific disposal logic
   */
  protected abstract doDispose(): Promise<void>;

  /**
   * Whether the manager completed initialization
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure manager is usable before performing operations.
   *
   * The two refusing states are reported separately because they describe different situations: an
   * uninitialized manager is waiting for its owner to call `initialize()`, while a disposed one has
   * been torn down and its resources released. Reporting both as "not initialized" sent CORE-045's
   * investigation looking for a missing await that did not exist.
   */
  protected ensureInitialized(): void {
    if (this.disposed) {
      throw new Error(
        `${this.constructor.name} was disposed — re-initialize it before use, or build a new one`,
      );
    }
    if (!this.initialized) {
      throw new Error(`${this.constructor.name} is not initialized`);
    }
  }
}
