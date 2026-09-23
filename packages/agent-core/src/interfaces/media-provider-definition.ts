import type { IImageGenerationProvider, IVideoGenerationProvider } from './media-provider.js';

/** Values resolved by a media provider factory at execution time. */
export interface IMediaProviderConfig {
  readonly credential?: string;
  readonly baseUrl?: string;
  /** The node's resolved model allowlist, passed to image-capable provider factories. */
  readonly imageCapableModels?: readonly string[];
}

/** Environment-variable names used to resolve a media provider's credential and endpoint. */
export interface IMediaProviderCredentialRequirement {
  readonly credentialEnvVars: readonly string[];
  readonly baseUrlEnvVars?: readonly string[];
  readonly requiresBaseUrl?: boolean;
}

/**
 * A late-bound media provider definition. DAG nodes receive this definition and create a provider
 * during execution, preserving credential-free node discovery and typed missing-credential errors.
 */
export interface IMediaProviderDefinition {
  readonly type: string;
  readonly displayName?: string;
  readonly credentialRequirement?: IMediaProviderCredentialRequirement;
  readonly defaults?: {
    readonly model?: string;
    readonly allowedModels?: readonly string[];
    readonly baseUrl?: string;
  };
  readonly createImageProvider?: (config: IMediaProviderConfig) => IImageGenerationProvider;
  readonly createVideoProvider?: (config: IMediaProviderConfig) => IVideoGenerationProvider;
}

export function isMediaProviderDefinition(value: unknown): value is IMediaProviderDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<IMediaProviderDefinition>;
  return (
    typeof candidate.type === 'string' &&
    candidate.type.length > 0 &&
    (typeof candidate.createImageProvider === 'function' ||
      typeof candidate.createVideoProvider === 'function')
  );
}

export function findMediaProviderDefinition(
  definitions: readonly IMediaProviderDefinition[],
  type: string,
): IMediaProviderDefinition | undefined {
  return definitions.find((definition) => definition.type === type);
}
