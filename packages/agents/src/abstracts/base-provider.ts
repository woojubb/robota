/**
 * Base abstract class for providers
 */
export abstract class BaseProvider {
    abstract readonly name: string;

    protected initialized = false;

    async initialize(): Promise<void> {
        this.initialized = true;
    }

    async dispose(): Promise<void> {
        this.initialized = false;
    }

    isInitialized(): boolean {
        return this.initialized;
    }
} 