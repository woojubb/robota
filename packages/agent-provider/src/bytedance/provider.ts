import type {
  IInlineImageInputSource,
  IUriImageInputSource,
  TProviderMediaResult,
  IVideoGenerationProvider,
  IVideoGenerationRequest,
  IVideoJobAccepted,
  IVideoJobSnapshot,
} from '@robota-sdk/agent-core';
import type {
  IBytedanceCreateVideoTaskRequest,
  IBytedanceCreateVideoTaskResponse,
  IBytedanceProviderOptions,
  IBytedanceVideoTaskResponse,
  TBytedanceTaskContent,
} from './types';
import { requestJson } from './http-client';
import { mapVideoJobSnapshot, mapInitialStatus, toIsoTimestamp } from './status-mapper';

const DEFAULT_CREATE_VIDEO_PATH = '/contents/generations/tasks';
const DEFAULT_GET_VIDEO_TASK_PATH_TEMPLATE = '/contents/generations/tasks/{taskId}';
const DEFAULT_CANCEL_VIDEO_TASK_PATH_TEMPLATE = '/contents/generations/tasks/{taskId}';

export class BytedanceProvider implements IVideoGenerationProvider {
  private readonly options: IBytedanceProviderOptions;

  public constructor(options: IBytedanceProviderOptions) {
    this.options = options;
  }

  public async createVideo(
    request: IVideoGenerationRequest,
  ): Promise<TProviderMediaResult<IVideoJobAccepted>> {
    if (request.prompt.trim().length === 0) {
      return buildInvalidRequestError('Video generation requires non-empty prompt.');
    }
    if (request.model.trim().length === 0) {
      return buildInvalidRequestError('Video generation requires non-empty model.');
    }
    if (typeof request.seed === 'number') {
      return buildInvalidRequestError(
        'ModelArk Seedance provider does not support seed field in current contract.',
      );
    }

    const contentResult = this.buildContentPayload(request.prompt, request.inputImages);
    if (!contentResult.ok) {
      return contentResult;
    }

    const payload: IBytedanceCreateVideoTaskRequest = {
      model: request.model.trim(),
      content: contentResult.value,
      duration: request.durationSeconds,
      ratio: request.aspectRatio,
    };

    const responseResult = await requestJson<IBytedanceCreateVideoTaskResponse>(this.options, {
      path: this.options.createVideoPath ?? DEFAULT_CREATE_VIDEO_PATH,
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!responseResult.ok) {
      return responseResult;
    }

    if (responseResult.value.id.trim().length === 0) {
      return buildUpstreamError('Bytedance createVideo response is missing task id.');
    }
    const mappedStatus = mapInitialStatus(responseResult.value.status);
    if (!mappedStatus.ok) {
      return mappedStatus;
    }
    return {
      ok: true,
      value: {
        jobId: responseResult.value.id,
        status: mappedStatus.value,
        createdAt: toIsoTimestamp(responseResult.value.created_at),
      },
    };
  }

  public async getVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>> {
    if (jobId.trim().length === 0) {
      return buildInvalidRequestError('Video job lookup requires non-empty jobId.');
    }

    const responseResult = await requestJson<IBytedanceVideoTaskResponse>(this.options, {
      path: buildPath(
        this.options.getVideoTaskPathTemplate ?? DEFAULT_GET_VIDEO_TASK_PATH_TEMPLATE,
        jobId,
      ),
      method: 'GET',
    });
    if (!responseResult.ok) {
      return responseResult;
    }
    return mapVideoJobSnapshot(responseResult.value);
  }

  public async cancelVideoJob(jobId: string): Promise<TProviderMediaResult<IVideoJobSnapshot>> {
    if (jobId.trim().length === 0) {
      return buildInvalidRequestError('Video job cancellation requires non-empty jobId.');
    }

    const cancelMethod = this.options.cancelVideoTaskMethod ?? 'DELETE';
    const responseResult = await requestJson<IBytedanceVideoTaskResponse>(this.options, {
      path: buildPath(
        this.options.cancelVideoTaskPathTemplate ?? DEFAULT_CANCEL_VIDEO_TASK_PATH_TEMPLATE,
        jobId,
      ),
      method: cancelMethod,
    });
    if (!responseResult.ok) {
      return responseResult;
    }
    return mapVideoJobSnapshot(responseResult.value);
  }

  private buildContentPayload(
    prompt: string,
    inputImages: IVideoGenerationRequest['inputImages'],
  ): TProviderMediaResult<TBytedanceTaskContent[]> {
    const normalizedPrompt = prompt.trim();
    if (normalizedPrompt.length === 0) {
      return buildInvalidRequestError('Video generation requires non-empty prompt.');
    }
    const content: TBytedanceTaskContent[] = [{ type: 'text', text: normalizedPrompt }];
    if (Array.isArray(inputImages)) {
      for (const image of inputImages) {
        const imageUrlResult = toContentImageUrl(image);
        if (!imageUrlResult.ok) {
          return imageUrlResult;
        }
        content.push({ type: 'image_url', image_url: { url: imageUrlResult.value } });
      }
    }
    return { ok: true, value: content };
  }
}

function buildPath(template: string, taskId: string): string {
  return template.replace('{taskId}', encodeURIComponent(taskId));
}

function buildInvalidRequestError(message: string): TProviderMediaResult<never> {
  return { ok: false, error: { code: 'PROVIDER_INVALID_REQUEST', message } };
}

function buildUpstreamError(message: string): TProviderMediaResult<never> {
  return { ok: false, error: { code: 'PROVIDER_UPSTREAM_ERROR', message } };
}

function toContentImageUrl(
  image: IInlineImageInputSource | IUriImageInputSource,
): TProviderMediaResult<string> {
  if (image.kind === 'uri') {
    if (image.uri.trim().length === 0) {
      return buildInvalidRequestError('Image uri must be non-empty.');
    }
    return { ok: true, value: image.uri };
  }
  if (image.data.trim().length === 0) {
    return buildInvalidRequestError('Inline image data must be non-empty.');
  }
  if (image.mimeType.trim().length === 0) {
    return buildInvalidRequestError('Inline image mimeType must be non-empty.');
  }
  return { ok: true, value: `data:${image.mimeType};base64,${image.data}` };
}
