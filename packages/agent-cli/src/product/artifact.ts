import type { IEmbeddedProductIdentity, TConfigEnvironment } from '@robota-sdk/product-config';

/** Fixed, non-secret metadata supplied by the owner of a CLI executable. */
export interface IProductCliArtifact {
  readonly identity: IEmbeddedProductIdentity;
  readonly runtimeDefaults?: TConfigEnvironment;
  readonly version: string;
  readonly sourceVersion?: string;
  readonly buildMetadata?: string | null;
  /** Omit or set false to disable update checks; opt in with an explicit package and registry. */
  readonly update?: { readonly packageName: string; readonly registryUrl: string } | false;
  /** Absolute directory of consumer-owned static web assets. */
  readonly webRoot?: string;
}

export type IProductCliRuntimeArtifact = Pick<
  IProductCliArtifact,
  'version' | 'sourceVersion' | 'buildMetadata' | 'update' | 'webRoot'
>;
