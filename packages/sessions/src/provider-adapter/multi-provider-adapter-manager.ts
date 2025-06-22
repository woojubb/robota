// Multi-provider adapter manager for sessions

export interface IMultiProviderAdapterManager {
    addProvider(name: string, provider: any): void;
    getProvider(name: string): any | null;
    setDefaultProvider(name: string): void;
    getDefaultProvider(): string | null;
}

// Simple facade implementation that wraps core functionality
export class MultiProviderAdapterManager implements IMultiProviderAdapterManager {
    private providers: Map<string, any> = new Map();
    private defaultProvider: string | null = null;

    addProvider(name: string, provider: any): void {
        this.providers.set(name, provider);
    }

    getProvider(name: string): any | null {
        return this.providers.get(name) || null;
    }

    setDefaultProvider(name: string): void {
        if (this.providers.has(name)) {
            this.defaultProvider = name;
        }
    }

    getDefaultProvider(): string | null {
        return this.defaultProvider;
    }
} 