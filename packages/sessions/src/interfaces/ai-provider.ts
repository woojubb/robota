// Provider configuration and management interfaces
export interface ProviderConfig {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    retries?: number;
}

export interface ProviderManager {
    addProvider(name: string, provider: any): void;
    getProvider(name: string): any | null;
    removeProvider(name: string): boolean;
    listProviders(): string[];
    setDefaultProvider(name: string): void;
    getDefaultProvider(): string | null;
} 