// Multi-provider adapter manager for sessions

import type { BaseAIProvider } from '@robota-sdk/agents';

export interface ProviderManager {
    addProvider(name: string, provider: BaseAIProvider): void;
    getProvider(name: string): BaseAIProvider | null;
    removeProvider(name: string): boolean;
    listProviders(): string[];
    setDefaultProvider(name: string): void;
    getDefaultProvider(): string | null;
}

// Simple facade implementation that wraps core functionality
export class MultiProviderAdapterManager implements ProviderManager {
    private providers: Map<string, BaseAIProvider> = new Map();
    private defaultProvider?: string;

    addProvider(name: string, provider: BaseAIProvider): void {
        this.providers.set(name, provider);
    }

    getProvider(name: string): BaseAIProvider | null {
        return this.providers.get(name) || null;
    }

    removeProvider(name: string): boolean {
        return this.providers.delete(name);
    }

    listProviders(): string[] {
        return Array.from(this.providers.keys());
    }

    setDefaultProvider(name: string): void {
        if (this.providers.has(name)) {
            this.defaultProvider = name;
        }
    }

    getDefaultProvider(): string | null {
        return this.defaultProvider || null;
    }
} 