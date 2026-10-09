import { isAbsolute } from 'node:path';
import { parseEmbeddedProductIdentity, parseProductRuntimeDefaults } from '@robota-sdk/product-config';

import { startCliEntry } from './cli-entry.js';
import { resolveCliRuntimeContext, withConsumerCliArtifact } from './startup/product-bootstrap.js';

import type { IStartCliOptions } from './startup/cli-options-types.js';
import type { ICliRuntimeContext } from './product/runtime-context.js';
import type { IProductCliArtifact } from './product/artifact.js';

export type { IProductCliArtifact } from './product/artifact.js';

export interface IProductCliHost {
  /** Resolve and validate the exact invocation without launching a session. */
  resolveRuntime(options?: IStartCliOptions): ICliRuntimeContext;
  /** Run the full CLI, including daemon and worker modes when this entry is re-executed. */
  run(options?: IStartCliOptions): Promise<void>;
}

function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Bind one consumer-owned executable to its immutable product identity and build metadata.
 * The ordinary installed CLI entry keeps its separately embedded identity seal.
 */
export function createProductCliHost(input: IProductCliArtifact): IProductCliHost {
  if (!input.identity || !input.version?.trim())
    throw new Error('Consumer CLI artifact requires identity and version.');
  if (input.webRoot !== undefined && !isAbsolute(input.webRoot))
    throw new Error('Consumer web asset root must be absolute.');
  const identity = parseEmbeddedProductIdentity(structuredClone(input.identity));
  const id = identity.identity.id;
  const defaults = parseProductRuntimeDefaults({
    PRODUCT_USER_STATE_DIR: `${id}/state`,
    PRODUCT_CACHE_DIR: `${id}/cache`,
    PRODUCT_LOG_DIR: `${id}/logs`,
    PRODUCT_PROJECT_STATE_DIR: `.${id}`,
    PRODUCT_SHARED_USER_SETTINGS: '[]',
    PRODUCT_SHARED_PROJECT_SETTINGS: '[]',
    ...structuredClone(input.runtimeDefaults ?? {}),
  });
  const artifact = freezeSnapshot({
    ...structuredClone(input),
    identity,
    runtimeDefaults: defaults,
    sourceVersion: input.sourceVersion ?? input.version,
    buildMetadata: input.buildMetadata ?? null,
    update: input.update ?? false,
  });
  const prepare = (options: IStartCliOptions = {}): IStartCliOptions =>
    withConsumerCliArtifact(options, artifact);
  return Object.freeze({
    resolveRuntime: (options: IStartCliOptions = {}) => resolveCliRuntimeContext(prepare(options)),
    run: (options: IStartCliOptions = {}) => startCliEntry(prepare(options)),
  });
}
