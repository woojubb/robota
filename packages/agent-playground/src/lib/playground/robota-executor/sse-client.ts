export type TSseEventType =
  | 'tool_call_start'
  | 'tool_call_complete'
  | 'text_delta'
  | 'done'
  | 'error';

export interface ISseToolCallStart {
  type: 'tool_call_start';
  data: { id: string; name: string; input: Record<string, unknown> };
}

export interface ISseToolCallComplete {
  type: 'tool_call_complete';
  data: { id: string; output: unknown };
}

export interface ISseTextDelta {
  type: 'text_delta';
  data: { text: string };
}

export interface ISseDone {
  type: 'done';
  data: { usage: { promptTokens: number; completionTokens: number; totalTokens: number } };
}

export interface ISseError {
  type: 'error';
  data: { message: string };
}

export type TSseEvent =
  | ISseToolCallStart
  | ISseToolCallComplete
  | ISseTextDelta
  | ISseDone
  | ISseError;

export interface ISseExecuteRequest {
  provider: string;
  model: string;
  tools?: string[];
  systemPrompt?: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

function buildBaseUrl(serverUrl: string): string {
  return serverUrl
    .replace(/^wss/, 'https')
    .replace(/^ws/, 'http')
    .replace(/\/ws\/playground$/, '')
    .replace(/\/ws$/, '');
}

export async function* sseExecute(
  serverUrl: string,
  apiKey: string | undefined,
  body: ISseExecuteRequest,
): AsyncGenerator<TSseEvent> {
  const baseUrl = buildBaseUrl(serverUrl);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-Provider-API-Key'] = apiKey;
  }

  const resp = await fetch(`${baseUrl}/api/playground/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => 'Unknown error'); // allow-fallback: http error body read is best-effort
    throw new Error(`SSE request failed (${resp.status}): ${text}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const raw = JSON.parse(trimmed.slice('data: '.length)) as TSseEvent; // allow-any: SSE wire protocol cast
        yield raw;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
