import { describe, expect, it } from 'vitest';

const integrationEnabled = process.env.COMFYUI_INTEGRATION === '1';
const describeIntegration = integrationEnabled ? describe : describe.skip;
const timeoutMs = Number.parseInt(process.env.COMFYUI_INTEGRATION_TIMEOUT_MS ?? '5000', 10);

const runtimeBaseUrl = normalizeBaseUrl(
  process.env.COMFYUI_BASE_URL ?? process.env.BACKEND_URL ?? 'http://127.0.0.1:8188',
);
const orchestratorBaseUrl = normalizeBaseUrl(
  process.env.ORCHESTRATOR_BASE_URL ?? 'http://127.0.0.1:3012',
);

const png1x1Base64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

interface IJsonResponse<TBody> {
  readonly status: number;
  readonly body: TBody;
}

interface IHealthBody {
  readonly status?: unknown;
  readonly service?: unknown;
  readonly backend?: unknown;
}

interface IEnvelope<TData> {
  readonly ok?: unknown;
  readonly status?: unknown;
  readonly data?: TData;
}

interface IAssetPayload {
  readonly asset?: {
    readonly assetId?: unknown;
    readonly runtimeAssetId?: unknown;
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  expect(value, `${label} must be a non-null object`).toBeTypeOf('object');
  expect(value, `${label} must not be null`).not.toBeNull();
  return value as Record<string, unknown>;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<TBody>(
  url: string,
  init: RequestInit = {},
): Promise<IJsonResponse<TBody>> {
  const response = await fetchWithTimeout(url, init);
  const contentType = response.headers.get('content-type') ?? '';
  expect(contentType, `${url} must return JSON`).toContain('application/json');
  return { status: response.status, body: (await response.json()) as TBody };
}

async function expectObjectInfo(url: string): Promise<Record<string, unknown>> {
  const { status, body } = await fetchJson<unknown>(url);
  expect(status).toBe(200);
  const objectInfo = expectRecord(body, url);
  expect(Object.keys(objectInfo).length).toBeGreaterThan(0);
  return objectInfo;
}

function toWebSocketUrl(httpBaseUrl: string, path: string): string {
  const protocol = httpBaseUrl.startsWith('https://') ? 'wss://' : 'ws://';
  return `${protocol}${httpBaseUrl.replace(/^https?:\/\//, '')}${path}`;
}

async function expectWebSocketOpen(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out opening WebSocket: ${url}`));
    }, timeoutMs);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      ws.close();
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to open WebSocket: ${url}`));
    });
  });
}

describeIntegration('external ComfyUI integration', () => {
  it('validates the native ComfyUI runtime surface used by the orchestrator', async () => {
    await expectObjectInfo(`${runtimeBaseUrl}/object_info`);

    const queue = await fetchJson<unknown>(`${runtimeBaseUrl}/queue`);
    expect(queue.status).toBe(200);
    const queueBody = expectRecord(queue.body, 'runtime queue body');
    expect(Array.isArray(queueBody.queue_running)).toBe(true);
    expect(Array.isArray(queueBody.queue_pending)).toBe(true);

    await expectWebSocketOpen(toWebSocketUrl(runtimeBaseUrl, `/ws?clientId=robota-${Date.now()}`));
  });

  it('validates orchestrator proxying, node catalog, and runtime asset upload', async () => {
    const health = await fetchJson<IHealthBody>(`${orchestratorBaseUrl}/health`);
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.service).toBe('dag-orchestrator-server');

    await expectObjectInfo(`${orchestratorBaseUrl}/object_info`);

    const nodeCatalog = await fetchJson<IEnvelope<Record<string, unknown>>>(
      `${orchestratorBaseUrl}/v1/dag/nodes`,
    );
    expect(nodeCatalog.status).toBe(200);
    expect(nodeCatalog.body.ok).toBe(true);
    const catalogData = expectRecord(nodeCatalog.body.data, 'node catalog data');
    expect(Object.keys(catalogData).length).toBeGreaterThan(0);

    const formData = new FormData();
    formData.append(
      'image',
      new Blob([Buffer.from(png1x1Base64, 'base64')], { type: 'image/png' }),
      'robota-comfyui-check.png',
    );
    formData.append('type', 'input');
    formData.append('overwrite', 'true');

    const runtimeUpload = await fetchJson<{ name?: unknown }>(
      `${orchestratorBaseUrl}/upload/image`,
      { method: 'POST', body: formData },
    );
    expect(runtimeUpload.status).toBeGreaterThanOrEqual(200);
    expect(runtimeUpload.status).toBeLessThan(300);
    expect(runtimeUpload.body.name).toBeTypeOf('string');

    const assetUpload = await fetchJson<IEnvelope<IAssetPayload>>(
      `${orchestratorBaseUrl}/v1/dag/assets`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: 'robota-comfyui-check.png',
          mediaType: 'image/png',
          base64Data: png1x1Base64,
        }),
      },
    );
    expect(assetUpload.status).toBe(201);
    expect(assetUpload.body.ok).toBe(true);
    expect(assetUpload.body.data?.asset?.assetId).toBeTypeOf('string');
    expect(assetUpload.body.data?.asset?.runtimeAssetId).toBeTypeOf('string');
  });
});
