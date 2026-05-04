import type { IAssetStore, IPromptRequest, TPromptInputValue } from '@robota-sdk/dag-core';
import { HTTP_BAD_GATEWAY } from './route-utils.js';

type TJsonValue = string | number | boolean | null | TJsonObject | TJsonValue[];
type TJsonObject = {
  [key: string]: TJsonValue | undefined;
};

const BOUNDARY_SEED_LENGTH = 8;

export interface IRuntimeAssetUploadError {
  ok: false;
  status: number;
  code:
    | 'DAG_RUNTIME_ASSET_UPLOAD_FAILED'
    | 'DAG_RUNTIME_ASSET_RESPONSE_INVALID'
    | 'DAG_ASSET_NOT_FOUND';
  detail: string;
  retryable: boolean;
}

export type TRuntimeAssetUploadResult =
  | { ok: true; runtimeAssetId: string }
  | IRuntimeAssetUploadError;

interface IRuntimeAssetUploadInput {
  backendUrl: string;
  content: Uint8Array;
  fileName: string;
  mediaType: string;
  assetId?: string;
}

interface IAssetReferenceInput {
  [key: string]: TJsonValue | undefined;
  referenceType: 'asset';
  assetId: string;
  uri?: string;
}

function isAssetReference(value: TPromptInputValue | TJsonObject): value is IAssetReferenceInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value;
  return (
    candidate.referenceType === 'asset' &&
    typeof candidate.assetId === 'string' &&
    candidate.assetId.trim().length > 0
  );
}

function sanitizeMultipartFileName(fileName: string): string {
  return fileName.replace(/["\r\n\\]/g, '_');
}

function buildMultipartImageBody(input: IRuntimeAssetUploadInput): {
  body: Buffer;
  boundary: string;
} {
  const boundarySeed = input.assetId ?? input.fileName;
  const boundary = `----AssetUpload${Date.now()}${boundarySeed.slice(0, BOUNDARY_SEED_LENGTH).replace(/[^A-Za-z0-9]/g, '')}`;
  const safeFileName = sanitizeMultipartFileName(input.fileName);
  const header = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${safeFileName}"\r\nContent-Type: ${input.mediaType}\r\n\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([header, Buffer.from(input.content), footer]), boundary };
}

function readRuntimeAssetName(payload: TJsonValue): string | undefined {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const name = payload.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
}

async function readRuntimeErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().length > 0
      ? `Runtime asset upload failed with ${response.status}: ${text}`
      : `Runtime asset upload failed with ${response.status}`;
  } catch {
    return `Runtime asset upload failed with ${response.status}`;
  }
}

export async function uploadAssetBufferToRuntime(
  input: IRuntimeAssetUploadInput,
): Promise<TRuntimeAssetUploadResult> {
  const { body, boundary } = buildMultipartImageBody(input);
  try {
    const response = await fetch(`${input.backendUrl}/upload/image`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    if (!response.ok) {
      return {
        ok: false,
        status: HTTP_BAD_GATEWAY,
        code: 'DAG_RUNTIME_ASSET_UPLOAD_FAILED',
        detail: await readRuntimeErrorDetail(response),
        retryable: true,
      };
    }

    const runtimeAssetId = readRuntimeAssetName((await response.json()) as TJsonValue);
    if (typeof runtimeAssetId !== 'string') {
      return {
        ok: false,
        status: HTTP_BAD_GATEWAY,
        code: 'DAG_RUNTIME_ASSET_RESPONSE_INVALID',
        detail: 'Runtime asset upload response must contain a non-empty name',
        retryable: true,
      };
    }

    return { ok: true, runtimeAssetId };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Runtime backend unreachable';
    return {
      ok: false,
      status: HTTP_BAD_GATEWAY,
      code: 'DAG_RUNTIME_ASSET_UPLOAD_FAILED',
      detail: message,
      retryable: true,
    };
  }
}

async function readContentBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function rewriteAssetReference(reference: IAssetReferenceInput, runtimeAssetId: string): void {
  reference.assetId = runtimeAssetId;
  if (typeof reference.uri === 'string') {
    reference.uri = `asset://${runtimeAssetId}`;
  }
}

export async function resolvePromptAssetsForRuntime(
  promptRequest: IPromptRequest,
  assetStore: IAssetStore,
  backendUrl: string,
): Promise<TRuntimeAssetUploadResult> {
  for (const nodeEntry of Object.values(promptRequest.prompt)) {
    const inputs = nodeEntry.inputs as Record<string, TPromptInputValue | TJsonObject>;
    for (const inputValue of Object.values(inputs)) {
      if (!isAssetReference(inputValue)) {
        continue;
      }

      const metadata = await assetStore.getMetadata(inputValue.assetId);
      if (!metadata) {
        return {
          ok: false,
          status: 404,
          code: 'DAG_ASSET_NOT_FOUND',
          detail: `Asset not found: ${inputValue.assetId}`,
          retryable: false,
        };
      }

      if (
        typeof metadata.runtimeAssetId === 'string' &&
        metadata.runtimeAssetId.trim().length > 0
      ) {
        rewriteAssetReference(inputValue, metadata.runtimeAssetId.trim());
        continue;
      }

      const contentResult = await assetStore.getContent(inputValue.assetId);
      if (!contentResult) {
        return {
          ok: false,
          status: 404,
          code: 'DAG_ASSET_NOT_FOUND',
          detail: `Asset content not found: ${inputValue.assetId}`,
          retryable: false,
        };
      }

      const uploadResult = await uploadAssetBufferToRuntime({
        backendUrl,
        assetId: inputValue.assetId,
        fileName: contentResult.metadata.fileName,
        mediaType: contentResult.metadata.mediaType,
        content: await readContentBuffer(contentResult.stream),
      });
      if (!uploadResult.ok) {
        return uploadResult;
      }
      rewriteAssetReference(inputValue, uploadResult.runtimeAssetId);
    }
  }

  return { ok: true, runtimeAssetId: '' };
}
