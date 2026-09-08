import {
  isImageGenerationProvider,
  isVideoGenerationProvider,
  type IImageGenerationProvider,
  type IVideoGenerationProvider,
} from '../interfaces/media-provider.js';
import { processEnvResolver, type TEnvResolver } from '../utils/env-resolver.js';

import type {
  IMediaProviderConfig,
  IMediaProviderDefinition,
} from '../interfaces/media-provider-definition.js';

export type TMediaCredentialResolution =
  | { readonly ok: true; readonly config: IMediaProviderConfig }
  | { readonly ok: false; readonly missing: readonly string[] };

export interface IMediaProviderOverrides {
  readonly imageCapableModels?: readonly string[];
  readonly baseUrl?: string;
}

function firstResolved(
  names: readonly string[] | undefined,
  resolve: TEnvResolver,
): string | undefined {
  for (const name of names ?? []) {
    const value = resolve(name);
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function resolveMediaProviderConfig(
  definition: IMediaProviderDefinition,
  overrides: IMediaProviderOverrides = {},
  resolve: TEnvResolver = processEnvResolver,
): TMediaCredentialResolution {
  const requirement = definition.credentialRequirement;
  const baseUrl =
    overrides.baseUrl ??
    firstResolved(requirement?.baseUrlEnvVars, resolve) ??
    definition.defaults?.baseUrl;

  if (requirement === undefined) {
    return {
      ok: true,
      config: {
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(overrides.imageCapableModels !== undefined
          ? { imageCapableModels: overrides.imageCapableModels }
          : {}),
      },
    };
  }

  const credential = firstResolved(requirement.credentialEnvVars, resolve);
  const missing: string[] = [];
  if (credential === undefined) missing.push(...requirement.credentialEnvVars);
  if (requirement.requiresBaseUrl === true && baseUrl === undefined) {
    missing.push(...(requirement.baseUrlEnvVars ?? []));
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    config: {
      ...(credential !== undefined ? { credential } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(overrides.imageCapableModels !== undefined
        ? { imageCapableModels: overrides.imageCapableModels }
        : {}),
    },
  };
}

export function createImageProviderFromDefinition(
  definition: IMediaProviderDefinition,
  overrides: IMediaProviderOverrides = {},
  resolve: TEnvResolver = processEnvResolver,
): IImageGenerationProvider | undefined {
  if (definition.createImageProvider === undefined) return undefined;
  const resolved = resolveMediaProviderConfig(definition, overrides, resolve);
  if (!resolved.ok) return undefined;
  try {
    const provider = definition.createImageProvider(resolved.config);
    return isImageGenerationProvider(provider) ? provider : undefined;
  } catch {
    // allow-fallback: an unavailable credential or provider SDK is reported by the owning node's typed validation error
    return undefined;
  }
}

export function createVideoProviderFromDefinition(
  definition: IMediaProviderDefinition,
  overrides: IMediaProviderOverrides = {},
  resolve: TEnvResolver = processEnvResolver,
): IVideoGenerationProvider | undefined {
  if (definition.createVideoProvider === undefined) return undefined;
  const resolved = resolveMediaProviderConfig(definition, overrides, resolve);
  if (!resolved.ok) return undefined;
  try {
    const provider = definition.createVideoProvider(resolved.config);
    return isVideoGenerationProvider(provider) ? provider : undefined;
  } catch {
    // allow-fallback: an unavailable credential or provider SDK is reported by the owning node's typed validation error
    return undefined;
  }
}
