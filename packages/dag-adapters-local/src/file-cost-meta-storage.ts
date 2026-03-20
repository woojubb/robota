import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ICostMetaStoragePort } from '@robota-sdk/dag-cost';
import type { ICostMeta } from '@robota-sdk/dag-cost';

export class FileCostMetaStorage implements ICostMetaStoragePort {
    private readonly filePath: string;
    private cache: Map<string, ICostMeta>;

    constructor(dataDir: string) {
        this.filePath = join(dataDir, 'cost-meta.json');
        this.cache = this.loadFromFile();
    }

    async get(nodeType: string): Promise<ICostMeta | undefined> {
        return this.cache.get(nodeType);
    }

    async getAll(): Promise<ICostMeta[]> {
        return Array.from(this.cache.values());
    }

    async save(meta: ICostMeta): Promise<void> {
        this.cache.set(meta.nodeType, meta);
        this.writeToFile();
    }

    async delete(nodeType: string): Promise<void> {
        this.cache.delete(nodeType);
        this.writeToFile();
    }

    private loadFromFile(): Map<string, ICostMeta> {
        if (!existsSync(this.filePath)) return new Map();
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8')) as ICostMeta[];
        return new Map(data.map((m) => [m.nodeType, m]));
    }

    private writeToFile(): void {
        const data = Array.from(this.cache.values());
        writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    }
}
