import type { TUniversalValue } from './types';

/**
 * Provider-agnostic media output reference.
 * Providers must not return raw binary payloads in this contract.
 */
export interface IMediaOutputRef {
  kind: 'asset' | 'uri';
  assetId?: string;
  uri?: string;
  mimeType?: string;
  bytes?: number;
}

export interface IProviderMediaError {
  code:
    | 'PROVIDER_AUTH_ERROR'
    | 'PROVIDER_RATE_LIMITED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_INVALID_REQUEST'
    | 'PROVIDER_UPSTREAM_ERROR'
    | 'PROVIDER_JOB_NOT_FOUND'
    | 'PROVIDER_JOB_NOT_CANCELLABLE';
  message: string;
  details?: Record<string, TUniversalValue>;
}

export type TProviderMediaResult<TValue> =
  | { ok: true; value: TValue }
  | { ok: false; error: IProviderMediaError };

export interface IInlineImageInputSource {
  kind: 'inline';
  mimeType: string;
  data: string;
}

export interface IUriImageInputSource {
  kind: 'uri';
  uri: string;
  mimeType?: string;
}

export type TImageInputSource = IInlineImageInputSource | IUriImageInputSource;

export interface IImageGenerationRequest {
  prompt: string;
  model: string;
}

export interface IImageEditRequest {
  image: TImageInputSource;
  prompt: string;
  model: string;
}

export interface IImageComposeRequest {
  images: TImageInputSource[];
  prompt: string;
  model: string;
}

export interface IImageGenerationResult {
  outputs: IMediaOutputRef[];
  model: string;
}

export interface IImageGenerationProvider {
  generateImage(
    request: IImageGenerationRequest,
  ): Promise<TProviderMediaResult<IImageGenerationResult>>;
  editImage?(request: IImageEditRequest): Promise<TProviderMediaResult<IImageGenerationResult>>;
  composeImage?(
    request: IImageComposeRequest,
  ): Promise<TProviderMediaResult<IImageGenerationResult>>;
}

export interface IVideoGenerationRequest {
  prompt: string;
  model: string;
  durationSeconds?: number;
  aspectRatio?: string;
  seed?: number;
  inputImages?: TImageInputSource[];
}

export interface IVideoJobAccepted {
  jobId: string;
  status: 'queued' | 'running';
  createdAt: string;
}

export interface IVideoJobSnapshot {
  jobId: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  output?: IMediaOutputRef;
  error?: IProviderMediaError;
  updatedAt: string;
}

export interface IVideoGenerationProvider {
  createVideo(request: IVideoGenerationRequest): Promise<TProviderMediaResult<IVideoJobAccepted>>;
  getVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>>;
  cancelVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>>;
}

export function isImageGenerationProvider(provider: object): provider is IImageGenerationProvider {
  return (
    'generateImage' in provider &&
    typeof (
      provider as {
        generateImage?: (...args: never[]) => Promise<TProviderMediaResult<IImageGenerationResult>>;
      }
    ).generateImage === 'function'
  );
}

export function isVideoGenerationProvider(provider: object): provider is IVideoGenerationProvider {
  return (
    'createVideo' in provider &&
    'getVideoJob' in provider &&
    'cancelVideoJob' in provider &&
    typeof (
      provider as {
        createVideo?: (...args: never[]) => Promise<TProviderMediaResult<IVideoJobAccepted>>;
      }
    ).createVideo === 'function' &&
    typeof (
      provider as {
        getVideoJob?: (...args: never[]) => Promise<TProviderMediaResult<IVideoJobSnapshot>>;
      }
    ).getVideoJob === 'function' &&
    typeof (
      provider as {
        cancelVideoJob?: (...args: never[]) => Promise<TProviderMediaResult<IVideoJobSnapshot>>;
      }
    ).cancelVideoJob === 'function'
  );
}
