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
export abstract class AbstractManager {
  protected initialized = false;

  /**
   * Initialize the manager (idempotent)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.doInitialize();
    this.initialized = true;
  }

  /**
   * Subclass-specific initialization logic
   */
  protected abstract doInitialize(): Promise<void>;

  /**
   * Dispose manager resources (idempotent)
   */
  async dispose(): Promise<void> {
    await this.doDispose();
    this.initialized = false;
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
   * Ensure manager is initialized before performing operations
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`${this.constructor.name} is not initialized`);
    }
  }
}
