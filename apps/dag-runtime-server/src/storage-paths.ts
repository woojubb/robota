import path from 'node:path';

export interface IResolveDagStoragePathsOptions {
  /** Selected product state root from the host's resolved product configuration. */
  readonly userStateRoot: string;
  /** Explicit host environment snapshot. */
  readonly environment?: Readonly<Record<string, string | undefined>>;
}

export interface IDagStoragePaths {
  readonly storageRoot: string;
  readonly assetRoot: string;
}

/** Resolve DAG storage beneath the state root selected by the host. */
export function resolveDagStoragePaths(options: IResolveDagStoragePathsOptions): IDagStoragePaths {
  const environment = options.environment ?? {};
  const userStateRoot = options.userStateRoot.trim();
  if (userStateRoot.length === 0) {
    throw new Error('A configured product user state root is required for DAG storage.');
  }
  return Object.freeze({
    storageRoot: environment['DAG_STORAGE_ROOT']
      ? path.resolve(environment['DAG_STORAGE_ROOT'])
      : path.join(userStateRoot, 'dag', 'storage'),
    assetRoot: environment['ASSET_STORAGE_ROOT']
      ? path.resolve(environment['ASSET_STORAGE_ROOT'])
      : path.join(userStateRoot, 'dag', 'assets'),
  });
}
