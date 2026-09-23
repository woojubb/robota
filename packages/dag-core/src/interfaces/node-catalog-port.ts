import type { INodeManifest } from '../types/domain.js';

/** Registered domain node manifests, independent of a transport catalog shape. */
export interface IDagNodeCatalogPort {
  listNodes(): Promise<readonly INodeManifest[]>;
}
