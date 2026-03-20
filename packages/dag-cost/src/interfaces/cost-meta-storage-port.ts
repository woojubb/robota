import type { ICostMeta } from '../types/cost-meta-types.js';

export interface ICostMetaStoragePort {
    get(nodeType: string): Promise<ICostMeta | undefined>;
    getAll(): Promise<ICostMeta[]>;
    save(meta: ICostMeta): Promise<void>;
    delete(nodeType: string): Promise<void>;
}
