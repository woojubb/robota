/**
 * Base abstract class for all managers
 * Provides common manager functionality and lifecycle
 * @internal
 */
export abstract class BaseManager {
    protected initialized = false;

    /**
     * Initialize the manager
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.doInitialize();
        this.initialized = true;
    }

    /**
     * Actual initialization logic - to be implemented by subclasses
     */
    protected abstract doInitialize(): Promise<void>;

    /**
     * Cleanup manager resources
     */
    async dispose(): Promise<void> {
        await this.doDispose();
        this.initialized = false;
    }

    /**
     * Actual disposal logic - to be implemented by subclasses
     */
    protected abstract doDispose(): Promise<void>;

    /**
     * Check if manager is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Ensure manager is initialized before operations
     */
    protected ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error(`${this.constructor.name} is not initialized`);
        }
    }
} 